const express = require('express');
const cors = require('cors');
// Note: Using native fetch (built into Node.js 18+)

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Stuller API credentials
const STULLER_API_KEY = process.env.STULLER_API_KEY;
const STULLER_TOKEN = process.env.STULLER_TOKEN;

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
  
  // Check for specific styles in GroupDescription
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
  
  // Stuller SKU format often ends with metal code
  if (sku.includes(':W') || sku.includes('W:')) return 'white-gold';
  if (sku.includes(':Y') || sku.includes('Y:')) return 'yellow-gold';
  if (sku.includes(':R') || sku.includes('R:') || sku.includes(':P') || sku.includes('P:')) return 'rose-gold';
  if (sku.includes(':PT') || sku.includes('PT:') || sku.includes('PLAT')) return 'platinum';
  
  return 'white-gold';
}

// Transform Stuller product to our format
function transformProduct(product) {
  const series = product.SKU ? product.SKU.split(':')[0] : null;
  
  // PRIMARY: Try to get style from GroupDescription first
  let style = getStyleFromDescription(product.GroupDescription);
  
  // FALLBACK: If no style from description, check series list
  if (!style) {
    style = getStyleFromSeries(series);
  }
  
  // If still no style, skip this product
  if (!style) {
    return null;
  }
  
  const centerShape = getCenterShape(product.Description);
  const metal = getMetalFromSku(product.SKU);
  
  let primaryImage = null;
  if (product.GroupImages && product.GroupImages.length > 0) {
    primaryImage = product.GroupImages[0].ZoomUrl || product.GroupImages[0].FullUrl;
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

// Fetch products for a specific series
async function fetchSeriesProducts(series) {
  try {
    const response = await fetch('https://api.stuller.com/v2/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': STULLER_API_KEY,
        'Authorization': `Bearer ${STULLER_TOKEN}`
      },
      body: JSON.stringify({
        "Include": ["All"],
        "SeriesNumbers": [series],
        "Filter": ["Orderable", "OnPriceList"],
        "PageSize": 100,
        "PageNumber": 1
      })
    });
    
    if (!response.ok) {
      console.log(`Error fetching series ${series}: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.Products || [];
  } catch (error) {
    console.log(`Error fetching series ${series}:`, error.message);
    return [];
  }
}

// Refresh the product cache
async function refreshCache() {
  console.log('Refreshing product cache...');
  
  const newCache = {
    solitaire: [],
    halo: [],
    'hidden-halo': [],
    'three-stone': [],
    lastUpdated: new Date().toISOString()
  };
  
  // Fetch products for all curated series
  for (const [style, seriesList] of Object.entries(CURATED_SERIES)) {
    console.log(`Fetching ${style} products from ${seriesList.length} series...`);
    
    for (const series of seriesList) {
      const products = await fetchSeriesProducts(series);
      
      for (const product of products) {
        const transformed = transformProduct(product);
        if (transformed) {
          // Use the detected style (from description or series)
          newCache[transformed.style].push(transformed);
        }
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Found ${newCache[style].length} ${style} products`);
  }
  
  productCache = newCache;
  console.log('Cache refresh complete!');
  
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

// AI Image Analysis endpoint (placeholder - requires Anthropic API key)
app.post('/api/analyze-ring', async (req, res) => {
  const { image } = req.body;
  
  if (!image) {
    return res.status(400).json({ error: 'No image provided' });
  }
  
  // For now, return a mock response
  // In production, this would call Anthropic's Claude API
  res.json({
    style: 'solitaire',
    shape: 'round',
    metal: 'white-gold',
    confidence: 0.85
  });
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
  console.log('  POST /api/analyze-ring - AI ring image analysis');
  
  // Auto-refresh cache on startup if empty
  if (productCache.solitaire.length === 0) {
    console.log('Cache empty, triggering initial refresh...');
    refreshCache().catch(err => console.log('Initial cache refresh failed:', err.message));
  }
});
