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
          reject(new Error('Failed to parse Stuller response: ' + data.substring(0, 500)));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================================
// DEBUG ENDPOINT - SHOWS RAW STULLER API RESPONSE
// ============================================================
app.get('/api/raw/:seriesId', async (req, res) => {
  try {
    const seriesId = req.params.seriesId;
    
    // Make raw API call
    const response = await makeStullerRequest({
      "Include": ["All"],
      "SeriesId": seriesId,
      "PageSize": 3
    });
    
    // Return the ENTIRE raw response
    res.json({
      message: "RAW Stuller API Response",
      seriesId: seriesId,
      rawResponse: response
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// DEBUG ENDPOINT - SHOWS FIRST PRODUCT'S ALL FIELDS
// ============================================================
app.get('/api/fields/:seriesId', async (req, res) => {
  try {
    const seriesId = req.params.seriesId;
    
    const response = await makeStullerRequest({
      "Include": ["All"],
      "SeriesId": seriesId,
      "PageSize": 1
    });
    
    if (response.Products && response.Products.length > 0) {
      const product = response.Products[0];
      
      // List ALL field names
      const allFields = Object.keys(product);
      
      // Find anything that might be image-related
      const imageRelatedFields = allFields.filter(f => 
        f.toLowerCase().includes('image') || 
        f.toLowerCase().includes('photo') || 
        f.toLowerCase().includes('picture') ||
        f.toLowerCase().includes('url') ||
        f.toLowerCase().includes('media') ||
        f.toLowerCase().includes('asset')
      );
      
      res.json({
        seriesId: seriesId,
        totalFields: allFields.length,
        allFieldNames: allFields,
        imageRelatedFields: imageRelatedFields,
        imageRelatedValues: imageRelatedFields.reduce((acc, f) => {
          acc[f] = product[f];
          return acc;
        }, {}),
        // Show a few key fields we might need
        keyFields: {
          Id: product.Id,
          Sku: product.Sku,
          ProductId: product.ProductId,
          SeriesId: product.SeriesId,
          Description: product.Description
        }
      });
    } else {
      res.json({ error: "No products found", rawResponse: response });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Build image URL - PLACEHOLDER until we know the right field
function buildImageUrl(identifier) {
  if (!identifier) return null;
  // We'll update this once we see the actual API response
  return `https://stuller.com/images/${identifier}`;
}

// Transform product data
function transformProduct(product, style) {
  return {
    id: product.Id || product.Sku,
    sku: product.Sku,
    seriesId: product.SeriesId,
    title: product.Description || product.Title || 'Engagement Ring',
    style: style,
    metal: product.MetalType || product.Metal || 'Unknown',
    price: product.MsrpPrice || product.Price || 0,
    wholesalePrice: product.WholesalePrice || product.Price || 0,
    centerStone: {
      shape: product.CenterStoneShape || product.Shape || 'Round',
      size: product.CenterStoneSize || product.Size || 'Various'
    },
    imageUrl: product.ImageUrl || product.PrimaryImageUrl || null,
    stullerUrl: `https://www.stuller.com/products/build/${product.SeriesId}/`
  };
}

// Fetch one series
async function fetchSeries(seriesId) {
  try {
    const response = await makeStullerRequest({
      "Include": ["All"],
      "SeriesId": seriesId,
      "PageSize": 100
    });
    return response.Products || [];
  } catch (error) {
    console.error(`Error fetching series ${seriesId}:`, error.message);
    return [];
  }
}

// Refresh cache
async function refreshCache() {
  console.log('Refreshing product cache...');
  const allProducts = [];
  
  for (const [style, seriesIds] of Object.entries(CURATED_SERIES)) {
    for (const seriesId of seriesIds) {
      const products = await fetchSeries(seriesId);
      if (products.length > 0) {
        // Just take first product per series for now
        const transformed = transformProduct(products[0], style);
        allProducts.push(transformed);
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  productCache = {
    products: allProducts,
    lastUpdated: new Date().toISOString()
  };
  
  console.log(`Cache refreshed: ${allProducts.length} products`);
  return allProducts;
}

// API Routes
app.get('/api/health', (req, res) => {
  const byStyle = {};
  productCache.products.forEach(p => {
    byStyle[p.style] = (byStyle[p.style] || 0) + 1;
  });
  
  res.json({
    status: 'ok',
    totalProducts: productCache.products.length,
    productsWithImages: productCache.products.filter(p => p.imageUrl).length,
    byStyle,
    lastUpdated: productCache.lastUpdated
  });
});

app.get('/api/products', (req, res) => {
  const { style, page = 1, limit = 20 } = req.query;
  
  let filtered = productCache.products;
  if (style && style !== 'all') {
    filtered = filtered.filter(p => p.style.toLowerCase() === style.toLowerCase());
  }
  
  const startIndex = (page - 1) * limit;
  const paginated = filtered.slice(startIndex, startIndex + parseInt(limit));
  
  res.json({
    products: paginated,
    total: filtered.length,
    page: parseInt(page),
    totalPages: Math.ceil(filtered.length / limit)
  });
});

app.get('/api/products/:id', (req, res) => {
  const product = productCache.products.find(p => 
    p.id === req.params.id || p.sku === req.params.id
  );
  
  if (product) {
    res.json(product);
  } else {
    res.status(404).json({ error: 'Product not found' });
  }
});

app.post('/api/refresh-cache', async (req, res) => {
  try {
    const products = await refreshCache();
    res.json({ 
      success: true, 
      count: products.length,
      message: 'Cache refreshed successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Ring Builder API running on port ${PORT}`);
  // Initial cache load
  await refreshCache();
});
