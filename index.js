const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Stuller API credentials
const STULLER_USERNAME = 'diamondsupplies1234';
const STULLER_PASSWORD = 'Letsgo2020@@';

// Curated series lists for each style
const CURATED_SERIES = {
  solitaire: ['123823', '123213', '122089', '122969', '124171', '140401', '140309', '126764', '124305', '123713', '122939', '126617', '122099', '126306', '124348', '150508', '124852', '140406', '124702', '123054', '150309', '122047', '126320', '170401', '122705', '124170', '170309', '122118', '123226', '140408', '124797', '124047'],
  halo: ['122804', '123243', '122060', '123227', '123333', '123767', '122870', '123449', '123267', '124241', '124470', '122892', '123861', '124435', '123770', '123541', '123336', '121981'],
  hiddenHalo: ['127024', '127098', '123599', '126924', '126214', '127198'],
  threeStone: ['122105', '122924', '123886', '121986', '69706', '126923', '124694', '126029', '120234', '124742', '123960', '122119', '122104', '123281', '122977', '122476', '122000', '126720', '126342', '127228', '122102', '123689', '126223']
};

// Cache for products
let productCache = {
  products: [],
  lastUpdated: null
};

// Make request to Stuller API using BASIC AUTH
function makeStullerRequest(body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${STULLER_USERNAME}:${STULLER_PASSWORD}`).toString('base64');
    
    const postData = JSON.stringify(body);
    
    const options = {
      hostname: 'api.stuller.com',
      path: '/v2/products',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse Stuller response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Fetch one series from Stuller using SeriesId
async function fetchSeries(seriesId) {
  try {
    const response = await makeStullerRequest({
      "Include": ["All"],
      "SeriesId": seriesId,
      "PageSize": 50
    });
    return response.Products || [];
  } catch (error) {
    console.log(`Error fetching series ${seriesId}: ${error.message}`);
    return [];
  }
}

// Get style from series number
function getStyleFromSeries(series) {
  if (!series) return null;
  if (CURATED_SERIES.solitaire.includes(series)) return 'Solitaire';
  if (CURATED_SERIES.halo.includes(series)) return 'Halo';
  if (CURATED_SERIES.hiddenHalo.includes(series)) return 'Hidden Halo';
  if (CURATED_SERIES.threeStone.includes(series)) return 'Three Stone';
  return null;
}

// Get center stone shape from description
function getCenterShape(description) {
  if (!description) return 'ROUND';
  const desc = description.toLowerCase();
  
  if (desc.includes('oval')) return 'OVAL';
  if (desc.includes('princess')) return 'PRINCESS';
  if (desc.includes('cushion')) return 'CUSHION';
  if (desc.includes('emerald')) return 'EMERALD';
  if (desc.includes('pear')) return 'PEAR';
  if (desc.includes('marquise')) return 'MARQUISE';
  if (desc.includes('radiant')) return 'RADIANT';
  if (desc.includes('asscher')) return 'ASSCHER';
  if (desc.includes('heart')) return 'HEART';
  return 'ROUND';
}

// Build Stuller image URL from series number
function buildImageUrl(seriesId) {
  return `https://meteor.stullercloud.com/das/${seriesId}?$xlarge$`;
}

// Transform Stuller product to our format
function transformProduct(product, forcedStyle = null, seriesId = null) {
  const series = seriesId || (product.SKU ? product.SKU.split(':')[0] : null);
  
  const style = forcedStyle || getStyleFromSeries(series);
  if (!style) return null;
  
  // Build image URL directly from series number
  const primaryImage = buildImageUrl(series);
  
  return {
    id: product.Id?.toString() || product.SKU || series,
    sku: product.SKU || series,
    series: series,
    name: product.GroupDescription || product.Description || `${style} Ring ${series}`,
    description: product.Description || `${style} Engagement Ring`,
    style: style,
    centerShape: getCenterShape(product.Description),
    price: product.Price?.Value || 0,
    image: primaryImage,
    leadTime: product.LeadTime || 4
  };
}

// Refresh the product cache
async function refreshCache() {
  console.log('Refreshing product cache from Stuller...');
  
  const allProducts = [];
  const seenSeries = new Set();
  
  // Process each style category
  const styleMap = {
    solitaire: 'Solitaire',
    halo: 'Halo',
    hiddenHalo: 'Hidden Halo',
    threeStone: 'Three Stone'
  };
  
  for (const [key, styleName] of Object.entries(styleMap)) {
    const seriesList = CURATED_SERIES[key];
    console.log(`Fetching ${seriesList.length} ${styleName} series...`);
    
    for (const seriesId of seriesList) {
      if (seenSeries.has(seriesId)) continue;
      
      const products = await fetchSeries(seriesId);
      
      if (products.length > 0) {
        const product = products[0];
        const transformed = transformProduct(product, styleName, seriesId);
        
        if (transformed) {
          seenSeries.add(seriesId);
          allProducts.push(transformed);
          console.log(`  ✓ ${seriesId}: ${transformed.name}`);
        }
      } else {
        // Even if API returns nothing, create entry with image URL
        const fallbackProduct = {
          id: seriesId,
          sku: seriesId,
          series: seriesId,
          name: `${styleName} Ring ${seriesId}`,
          description: `${styleName} Engagement Ring`,
          style: styleName,
          centerShape: 'ROUND',
          price: 0,
          image: buildImageUrl(seriesId),
          leadTime: 4
        };
        seenSeries.add(seriesId);
        allProducts.push(fallbackProduct);
        console.log(`  ~ ${seriesId}: ${fallbackProduct.name} (fallback)`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  productCache = {
    products: allProducts,
    lastUpdated: new Date().toISOString()
  };
  
  // Count by style
  const counts = {};
  const withImages = allProducts.filter(p => p.image).length;
  allProducts.forEach(p => {
    counts[p.style] = (counts[p.style] || 0) + 1;
  });
  
  console.log('Cache updated:', counts);
  console.log(`Total: ${allProducts.length}, with images: ${withImages}`);
  
  return counts;
}

// API Routes

app.get('/api/health', (req, res) => {
  const counts = {};
  const withImages = productCache.products.filter(p => p.image).length;
  productCache.products.forEach(p => {
    counts[p.style] = (counts[p.style] || 0) + 1;
  });
  
  res.json({
    status: 'ok',
    totalProducts: productCache.products.length,
    productsWithImages: withImages,
    byStyle: counts,
    lastUpdated: productCache.lastUpdated
  });
});

app.get('/api/refresh-cache', async (req, res) => {
  try {
    const counts = await refreshCache();
    res.json({ success: true, counts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings', (req, res) => {
  const { style, centerShape } = req.query;
  
  let results = [...productCache.products];
  
  if (style && style !== 'All') {
    results = results.filter(p => p.style === style);
  }
  
  if (centerShape && centerShape !== 'All') {
    results = results.filter(p => p.centerShape === centerShape.toUpperCase());
  }
  
  const items = results.map(p => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    style: p.style,
    centerShapes: [p.centerShape],
    shippingDays: p.leadTime,
    images: p.image ? [p.image] : [],
    category: 'Engagement Rings'
  }));

  res.json({
    success: true,
    data: {
      items: items,
      totalCount: items.length
    }
  });
});

app.get('/api/styles', (req, res) => {
  res.json({
    success: true,
    data: ['Solitaire', 'Halo', 'Hidden Halo', 'Three Stone']
  });
});

app.get('/api/shapes', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: 'ROUND', name: 'Round', icon: '○' },
      { id: 'OVAL', name: 'Oval', icon: '⬭' },
      { id: 'PRINCESS', name: 'Princess', icon: '◇' },
      { id: 'CUSHION', name: 'Cushion', icon: '▢' },
      { id: 'EMERALD', name: 'Emerald', icon: '▭' },
      { id: 'PEAR', name: 'Pear', icon: '◊' }
    ]
  });
});

app.get('/api/metals', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: '14KW', label: '14K White Gold', hex: '#E8E8E8' },
      { id: '14KY', label: '14K Yellow Gold', hex: '#FFD700' },
      { id: '14KR', label: '14K Rose Gold', hex: '#B76E79' },
      { id: '18KW', label: '18K White Gold', hex: '#F0F0F0' },
      { id: 'PLAT', label: 'Platinum', hex: '#E5E4E2' }
    ]
  });
});

app.get('/api/sizes', (req, res) => {
  res.json({
    success: true,
    data: ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10']
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ring Builder API running on port ${PORT}`);
  
  // Auto-refresh cache on startup
  console.log('Starting initial cache refresh...');
  refreshCache().catch(err => console.error('Initial refresh failed:', err.message));
});
