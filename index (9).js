const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// Stuller API credentials
const STULLER_USERNAME = 'diamondsupplies1234';
const STULLER_PASSWORD = 'Letsgo2020@@';

// Curated series lists for each style (79 total)
const CURATED_SERIES = {
  Solitaire: [
    '123823', '123213', '122089', '122969', '124171', '140401', '140309', '126764',
    '124305', '123713', '122939', '126617', '122099', '126306', '124348', '150508',
    '124852', '140406', '124702', '123054', '150309', '122047', '126320', '170401',
    '122705', '124170', '170309', '122118', '123226', '140408', '124797', '124047'
  ],
  Halo: [
    '122804', '123243', '122060', '123227', '123333', '123767', '122870', '123449',
    '123267', '124241', '124470', '122892', '123861', '124435', '123770', '123541',
    '123336', '121981'
  ],
  'Hidden Halo': [
    '127024', '127098', '123599', '126924', '126214', '127198'
  ],
  'Three Stone': [
    '122105', '122924', '123886', '121986', '69706', '126923', '124694', '126029',
    '120234', '124742', '123960', '122119', '122104', '123281', '122977', '122476',
    '122000', '126720', '126342', '127228', '122102', '123689', '126223'
  ]
};

// Product cache
let productCache = {
  products: [],
  lastUpdated: null,
  loading: false
};

// Make request to Stuller API
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
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(postData);
    req.end();
  });
}

// Extract details from product description
function parseDescription(desc = '') {
  const lower = desc.toLowerCase();
  
  // Metal
  let metal = '14K White Gold';
  if (lower.includes('platinum')) metal = 'Platinum';
  else if (lower.includes('rose')) metal = '14K Rose Gold';
  else if (lower.includes('yellow')) metal = '14K Yellow Gold';
  else if (lower.includes('18k')) metal = '18K White Gold';
  
  // Shape
  let shape = 'Round';
  const shapes = ['oval', 'princess', 'cushion', 'emerald', 'pear', 'marquise', 'radiant', 'asscher', 'heart'];
  for (const s of shapes) {
    if (lower.includes(s)) {
      shape = s.charAt(0).toUpperCase() + s.slice(1);
      break;
    }
  }
  
  // Size (look for mm measurements)
  let size = '';
  const sizeMatch = desc.match(/(\d+(?:\.\d+)?)\s*(?:x\s*\d+(?:\.\d+)?)?\s*mm/i);
  if (sizeMatch) size = sizeMatch[0];
  
  return { metal, shape, size };
}

// Transform raw product to clean format
function transformProduct(product, style, index) {
  const desc = product.ShortDescription || '';
  const parsed = parseDescription(desc);
  
  return {
    id: `${style.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
    seriesId: product.SeriesId || '',
    sku: product.SKU || '',
    title: desc || `${style} Engagement Ring`,
    style: style,
    metal: parsed.metal,
    shape: parsed.shape,
    size: parsed.size,
    orderable: product.Orderable || false
  };
}

// Fetch products for a single series
async function fetchSeriesProduct(seriesId, style, index) {
  try {
    const response = await makeStullerRequest({
      SeriesId: seriesId,
      PageSize: 1,
      Include: ['All']
    });

    if (response.Products && response.Products.length > 0) {
      const product = response.Products[0];
      product.SeriesId = seriesId;
      return transformProduct(product, style, index);
    }
    
    // Return basic product if API fails
    return {
      id: `${style.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
      seriesId: seriesId,
      sku: '',
      title: `${style} Engagement Ring`,
      style: style,
      metal: '14K White Gold',
      shape: 'Round',
      size: '',
      orderable: true
    };
  } catch (error) {
    console.error(`Error fetching series ${seriesId}:`, error.message);
    return {
      id: `${style.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
      seriesId: seriesId,
      sku: '',
      title: `${style} Engagement Ring`,
      style: style,
      metal: '14K White Gold',
      shape: 'Round',
      size: '',
      orderable: true
    };
  }
}

// Refresh the product cache
async function refreshCache() {
  if (productCache.loading) {
    console.log('Cache refresh already in progress...');
    return productCache.products;
  }

  productCache.loading = true;
  console.log('Refreshing product cache...');
  
  const allProducts = [];
  
  for (const [style, seriesIds] of Object.entries(CURATED_SERIES)) {
    console.log(`Fetching ${style} (${seriesIds.length} series)...`);
    
    for (let i = 0; i < seriesIds.length; i++) {
      const product = await fetchSeriesProduct(seriesIds[i], style, i);
      allProducts.push(product);
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
  }

  productCache = {
    products: allProducts,
    lastUpdated: new Date().toISOString(),
    loading: false
  };

  console.log(`Cache refreshed: ${allProducts.length} products`);
  return allProducts;
}

// ============ API ROUTES ============

// Health check
app.get('/api/health', (req, res) => {
  const byStyle = {};
  for (const style of Object.keys(CURATED_SERIES)) {
    byStyle[style] = productCache.products.filter(p => p.style === style).length;
  }

  res.json({
    status: 'ok',
    totalProducts: productCache.products.length,
    expectedProducts: Object.values(CURATED_SERIES).flat().length,
    byStyle,
    lastUpdated: productCache.lastUpdated,
    cacheLoading: productCache.loading
  });
});

// Get all products (with optional style filter)
app.get('/api/products', (req, res) => {
  const { style } = req.query;
  
  let products = productCache.products;
  
  if (style && style !== 'all') {
    products = products.filter(p => 
      p.style.toLowerCase() === style.toLowerCase() ||
      p.style.toLowerCase().replace(/\s+/g, '') === style.toLowerCase().replace(/\s+/g, '')
    );
  }

  res.json({
    products,
    total: products.length,
    styles: Object.keys(CURATED_SERIES),
    lastUpdated: productCache.lastUpdated
  });
});

// Get available styles
app.get('/api/styles', (req, res) => {
  const styles = Object.entries(CURATED_SERIES).map(([name, series]) => ({
    name,
    count: series.length
  }));

  res.json({ styles });
});

// Refresh cache endpoint
app.post('/api/refresh-cache', async (req, res) => {
  try {
    const products = await refreshCache();
    res.json({
      success: true,
      count: products.length,
      lastUpdated: productCache.lastUpdated
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single product by series ID
app.get('/api/product/:seriesId', (req, res) => {
  const product = productCache.products.find(p => p.seriesId === req.params.seriesId);
  
  if (product) {
    res.json(product);
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

// Showcase URL for the frontend
app.get('/api/showcase-url', (req, res) => {
  res.json({
    url: 'https://amare-frame-categoryembed.jewelershowcase.com/browse/wedding-and-engagement',
    subdomain: 'amare'
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Ring Builder API running on port ${PORT}`);
  console.log(`Expected products: ${Object.values(CURATED_SERIES).flat().length}`);
  
  // Initial cache load
  await refreshCache();
});
