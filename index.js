const express = require('express');
const cors = require('cors');
// Note: Using native fetch (built into Node.js 18+)

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Stuller API credentials from environment variables
const STULLER_USERNAME = process.env.STULLER_USERNAME;
const STULLER_PASSWORD = process.env.STULLER_PASSWORD;

// Curated series lists for each style
const CURATED_SERIES = {
  solitaire: ['123213', '122089', '122969', '124171', '140401', '140309', '126764', '124305', '123713', '122939', '126617', '122099', '126306', '124348', '150508', '124852', '140406'],
  halo: ['122804', '123243', '122060', '123227', '123333', '123767', '123449', '122870', '123267', '124241', '124470', '123861', '122892', '124435', '123770', '123541', '123336', '121981', '124246'],
  'hidden-halo': ['127024', '127098', '123599', '126924', '126214', '127198'],
  'three-stone': ['122924', '123886', '121986', '69706', '126923', '124694', '126029', '120234', '124742', '123960', '122119', '122104', '123281', '122977', '122476', '122000', '126720', '126342', '127228', '122102', '123689', '126223']
};

// Cache for products
let productCache = {
  solitaire: [],
  halo: [],
  'hidden-halo': [],
  'three-stone': [],
  lastUpdated: null
};

// Get style from GroupDescription (PRIMARY method)
function getStyleFromDescription(description) {
  if (!description) return null;
  const desc = description.toLowerCase();
  
  // Check for specific styles - order matters! Check "hidden halo" before "halo"
  if (desc.includes('solitaire')) return 'solitaire';
  if (desc.includes('hidden halo') || desc.includes('hidden-halo')) return 'hidden-halo';
  if (desc.includes('halo')) return 'halo';
  if (desc.includes('three stone') || desc.includes('three-stone') || desc.includes('3 stone') || desc.includes('3-stone')) return 'three-stone';
  
  return null;
}

// Get style from series number (FALLBACK method)
function getStyleFromSeries(series) {
  if (!series) return null;
  
  for (const [style, seriesList] of Object.entries(CURATED_SERIES)) {
    if (seriesList.includes(series)) {
      return style;
    }
  }
  return null;
}

// Get center stone shape from description
function getCenterShape(description) {
  if (!description) return 'round';
  const desc = description.toLowerCase();
  
  if (desc.includes('round')) return 'round';
  if (desc.includes('princess')) return 'princess';
  if (desc.includes('cushion')) return 'cushion';
  if (desc.includes('oval')) return 'oval';
  if (desc.includes('emerald')) return 'emerald';
  if (desc.includes('pear')) return 'pear';
  if (desc.includes('marquise')) return 'marquise';
  if (desc.includes('radiant')) return 'radiant';
  if (desc.includes('asscher')) return 'asscher';
  if (desc.includes('heart')) return 'heart';
  
  return 'round';
}

// Get metal type from SKU
function getMetalFromSku(sku) {
  if (!sku) return 'white-gold';
  
  if (sku.includes(':W') || sku.includes('W:') || sku.includes('14KW') || sku.includes('18KW')) return 'white-gold';
  if (sku.includes(':Y') || sku.includes('Y:') || sku.includes('14KY') || sku.includes('18KY')) return 'yellow-gold';
  if (sku.includes(':R') || sku.includes('R:') || sku.includes(':P') || sku.includes('14KR') || sku.includes('18KR')) return 'rose-gold';
  if (sku.includes(':PT') || sku.includes('PT:') || sku.includes('PLAT')) return 'platinum';
  
  return 'white-gold';
}

// Transform Stuller product to our format
function transformProduct(product, fallbackStyle) {
  const series = product.SKU ? product.SKU.split(':')[0] : null;
  
  // PRIMARY: Try to get style from GroupDescription first
  let style = getStyleFromDescription(product.GroupDescription);
  
  // FALLBACK: Use the style we expected from the series query
  if (!style) {
    style = fallbackStyle || getStyleFromSeries(series);
  }
  
  // If still no style, skip this product
  if (!style) {
    console.log(`Skipping product ${product.SKU} - no matching style. GroupDesc: ${product.GroupDescription}`);
    return null;
  }
  
  const centerShape = getCenterShape(product.Description);
  const metal = getMetalFromSku(product.SKU);
  
  let primaryImage = null;
  if (product.GroupImages && product.GroupImages.length > 0) {
    primaryImage = product.GroupImages[0].ZoomUrl || product.GroupImages[0].FullUrl;
  } else if (product.Images && product.Images.length > 0) {
    primaryImage = product.Images[0].ZoomUrl || product.Images[0].FullUrl;
  }
  
  return {
    id: product.Id?.toString() || product.SKU,
    sku: product.SKU,
    series: series,
    name: product.GroupDescription || product.Description,
    description: product.Description,
    style: style,
    centerShape: centerShape,
    metal: metal,
    price: product.Price?.Value || 0,
    image: primaryImage,
    leadTime: product.LeadTime || 4,
    inStock: product.Status === 'In Stock'
  };
}

// Get Stuller auth token
async function getStullerToken() {
  try {
    const response = await fetch('https://api.stuller.com/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `grant_type=password&username=${encodeURIComponent(STULLER_USERNAME)}&password=${encodeURIComponent(STULLER_PASSWORD)}`
    });
    
    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Failed to get Stuller token:', error.message);
    throw error;
  }
}

// Fetch products for a batch of series (FIXED: using "Series" not "SeriesNumbers")
async function fetchSeriesProducts(seriesList, token) {
  try {
    const response = await fetch('https://api.stuller.com/v2/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        "Include": ["All"],
        "Series": seriesList,  // FIXED: was "SeriesNumbers"
        "Filter": ["Orderable", "OnPriceList"],
        "PageSize": 500,
        "PageNumber": 1
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Error fetching series: ${response.status} - ${errorText}`);
      return [];
    }
    
    const data = await response.json();
    console.log(`Fetched ${data.Products?.length || 0} products for series batch`);
    return data.Products || [];
  } catch (error) {
    console.log(`Error fetching series:`, error.message);
    return [];
  }
}

// Refresh the product cache
async function refreshCache() {
  console.log('Refreshing product cache...');
  console.log('Getting Stuller auth token...');
  
  const token = await getStullerToken();
  console.log('Token obtained successfully');
  
  const newCache = {
    solitaire: [],
    halo: [],
    'hidden-halo': [],
    'three-stone': [],
    lastUpdated: new Date().toISOString()
  };
  
  // Track unique series to avoid duplicates
  const seenSeries = new Set();
  
  // Fetch products for each style's curated series
  for (const [style, seriesList] of Object.entries(CURATED_SERIES)) {
    console.log(`\nFetching ${style} products (${seriesList.length} series)...`);
    
    // Fetch in batches of 10 series at a time
    for (let i = 0; i < seriesList.length; i += 10) {
      const batch = seriesList.slice(i, i + 10);
      const products = await fetchSeriesProducts(batch, token);
      
      for (const product of products) {
        const transformed = transformProduct(product, style);
        if (transformed && !seenSeries.has(transformed.series)) {
          seenSeries.add(transformed.series);
          newCache[transformed.style].push(transformed);
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`Found ${newCache[style].length} unique ${style} products`);
  }
  
  productCache = newCache;
  console.log('\nCache refresh complete!');
  console.log(`Totals: Solitaire=${newCache.solitaire.length}, Halo=${newCache.halo.length}, Hidden Halo=${newCache['hidden-halo'].length}, Three Stone=${newCache['three-stone'].length}`);
  
  return {
    solitaire: newCache.solitaire.length,
    halo: newCache.halo.length,
    'hidden-halo': newCache['hidden-halo'].length,
    'three-stone': newCache['three-stone'].length,
    lastUpdated: newCache.lastUpdated
  };
}

// API Routes

// Health check with cache stats
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    cache: {
      solitaire: productCache.solitaire.length,
      halo: productCache.halo.length,
      'hidden-halo': productCache['hidden-halo'].length,
      'three-stone': productCache['three-stone'].length,
      lastUpdated: productCache.lastUpdated
    }
  });
});

// Refresh cache endpoint
app.get('/api/refresh-cache', async (req, res) => {
  try {
    const stats = await refreshCache();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Cache refresh error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get rings by style
app.get('/api/rings', (req, res) => {
  const { style, shape, metal, page = 1, limit = 20 } = req.query;
  
  let rings = [];
  
  // Get rings by style
  if (style && productCache[style]) {
    rings = [...productCache[style]];
  } else {
    // Return all rings if no style specified
    rings = [
      ...productCache.solitaire,
      ...productCache.halo,
      ...productCache['hidden-halo'],
      ...productCache['three-stone']
    ];
  }
  
  // Filter by shape if specified
  if (shape) {
    rings = rings.filter(r => r.centerShape === shape);
  }
  
  // Filter by metal if specified
  if (metal) {
    rings = rings.filter(r => r.metal === metal);
  }
  
  // Paginate
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedRings = rings.slice(startIndex, endIndex);
  
  res.json({
    rings: paginatedRings,
    total: rings.length,
    page: parseInt(page),
    totalPages: Math.ceil(rings.length / parseInt(limit))
  });
});

// Get single ring by ID
app.get('/api/rings/:id', (req, res) => {
  const { id } = req.params;
  
  const allRings = [
    ...productCache.solitaire,
    ...productCache.halo,
    ...productCache['hidden-halo'],
    ...productCache['three-stone']
  ];
  
  const ring = allRings.find(r => r.id === id || r.sku === id);
  
  if (ring) {
    res.json(ring);
  } else {
    res.status(404).json({ error: 'Ring not found' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ring Builder API running on port ${PORT}`);
  console.log('API endpoints:');
  console.log('  GET  /api/health - Health check with cache stats');
  console.log('  GET  /api/refresh-cache - Refresh product cache from Stuller');
  console.log('  GET  /api/rings - Get rings (query params: style, shape, metal, page, limit)');
  console.log('  GET  /api/rings/:id - Get single ring by ID');
  
  // Auto-refresh cache on startup if empty
  if (productCache.solitaire.length === 0) {
    console.log('\nCache empty, triggering initial refresh in 5 seconds...');
    setTimeout(() => {
      refreshCache().catch(err => console.log('Initial cache refresh failed:', err.message));
    }, 5000);
  }
});
