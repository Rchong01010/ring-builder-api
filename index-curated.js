const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// API Keys
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STULLER_USERNAME = process.env.STULLER_USERNAME || 'diamondsupplies1234';
const STULLER_PASSWORD = process.env.STULLER_PASSWORD || 'Letsgo2020@@';

const STULLER_API_BASE = 'api.stuller.com';

// ============================================
// YOUR CURATED COLLECTION - Hand-picked rings
// ============================================

const CURATED_SERIES = {
  solitaire: [
    '123213', '122089', '122969', '124171', '140401',
    '140309', '126764', '124305', '123713', '122939',
    '126617', '122099', '126306', '124348', '150508',
    '124852', '140406'
  ],
  halo: [
    '122804', '123243', '122060', '123227', '123333',
    '123767', '123449', '122870', '123267', '124241',
    '124470', '123861', '122892', '124435', '123770',
    '123541', '123336', '121981', '124246'
  ],
  hiddenHalo: [
    '127024', '127098', '123599', '126924', '126214', '127198'
  ],
  threeStone: [
    '122924', '123886', '121986', '69706', '126923',
    '124694', '126029', '120234', '124742', '123960',
    '122119', '122104', '123281', '122977', '122476',
    '122000', '126720', '126342', '127228', '122102',
    '123689', '126223'
  ]
};

// Cache for fetched products
let productCache = {
  products: [],
  lastFetch: null
};

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Make request to Stuller API
async function makeStullerRequest(endpoint, method = 'POST', body = null) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${STULLER_USERNAME}:${STULLER_PASSWORD}`).toString('base64');
    
    const options = {
      hostname: STULLER_API_BASE,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Basic ${auth}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Failed to parse Stuller response'));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Determine style from series number
function getStyleFromSeries(series) {
  if (CURATED_SERIES.solitaire.includes(series)) return 'Solitaire';
  if (CURATED_SERIES.halo.includes(series)) return 'Halo';
  if (CURATED_SERIES.hiddenHalo.includes(series)) return 'Hidden Halo';
  if (CURATED_SERIES.threeStone.includes(series)) return 'Three Stone';
  return null;
}

// Get center shape from description
function getCenterShape(desc) {
  if (!desc) return 'ROUND';
  const d = desc.toLowerCase();
  
  if (d.includes('oval')) return 'OVAL';
  if (d.includes('princess')) return 'PRINCESS';
  if (d.includes('cushion')) return 'CUSHION';
  if (d.includes('emerald')) return 'EMERALD';
  if (d.includes('pear')) return 'PEAR';
  if (d.includes('marquise')) return 'MARQUISE';
  if (d.includes('radiant')) return 'RADIANT';
  if (d.includes('asscher')) return 'ASSCHER';
  if (d.includes('heart')) return 'HEART';
  return 'ROUND';
}

// Get metal info from SKU
function getMetalFromSku(sku) {
  if (!sku) return { karat: '14kt', color: 'White', label: '14K White Gold', code: '14KW' };
  
  const skuUpper = sku.toUpperCase();
  
  // Check for metal codes in SKU
  if (skuUpper.includes(':P:') || skuUpper.endsWith(':P')) {
    // Platinum or need to check further
    if (skuUpper.includes('PLAT') || skuUpper.includes(':P:P')) {
      return { karat: 'Platinum', color: 'White', label: 'Platinum', code: 'PLAT' };
    }
  }
  
  if (skuUpper.includes('18KW')) return { karat: '18kt', color: 'White', label: '18K White Gold', code: '18KW' };
  if (skuUpper.includes('18KY')) return { karat: '18kt', color: 'Yellow', label: '18K Yellow Gold', code: '18KY' };
  if (skuUpper.includes('18KR')) return { karat: '18kt', color: 'Rose', label: '18K Rose Gold', code: '18KR' };
  if (skuUpper.includes('14KW')) return { karat: '14kt', color: 'White', label: '14K White Gold', code: '14KW' };
  if (skuUpper.includes('14KY')) return { karat: '14kt', color: 'Yellow', label: '14K Yellow Gold', code: '14KY' };
  if (skuUpper.includes('14KR')) return { karat: '14kt', color: 'Rose', label: '14K Rose Gold', code: '14KR' };
  if (skuUpper.includes('10KW')) return { karat: '10kt', color: 'White', label: '10K White Gold', code: '10KW' };
  if (skuUpper.includes('10KY')) return { karat: '10kt', color: 'Yellow', label: '10K Yellow Gold', code: '10KY' };
  if (skuUpper.includes('10KR')) return { karat: '10kt', color: 'Rose', label: '10K Rose Gold', code: '10KR' };
  
  return { karat: '14kt', color: 'White', label: '14K White Gold', code: '14KW' };
}

// Transform Stuller product to our format
function transformProduct(product) {
  const series = product.SKU ? product.SKU.split(':')[0] : null;
  const style = getStyleFromSeries(series);
  
  if (!style) return null;
  
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

// Fetch curated products from Stuller
async function fetchCuratedProducts() {
  console.log('Fetching curated products from Stuller...');
  
  // Combine all series numbers
  const allSeries = [
    ...CURATED_SERIES.solitaire,
    ...CURATED_SERIES.halo,
    ...CURATED_SERIES.hiddenHalo,
    ...CURATED_SERIES.threeStone
  ];
  
  console.log(`Fetching ${allSeries.length} curated series...`);
  
  try {
    const requestBody = {
      "Include": ["All"],
      "Series": allSeries,
      "Filter": ["Orderable", "OnPriceList"],
      "PageSize": 500
    };

    const data = await makeStullerRequest('/v2/products', 'POST', requestBody);
    const products = data.Products || [];
    
    console.log(`Received ${products.length} products from Stuller`);
    
    // Transform products
    const transformed = products
      .map(transformProduct)
      .filter(p => p !== null);
    
    // Group by series - keep ONE representative per series (prefer 14K White)
    const seriesMap = new Map();
    transformed.forEach(product => {
      if (!product.series) return;
      
      const key = `${product.series}-${product.centerShape}`;
      const existing = seriesMap.get(key);
      
      if (!existing) {
        seriesMap.set(key, product);
      } else if (product.metal.code === '14KW' && existing.metal.code !== '14KW') {
        seriesMap.set(key, product);
      }
    });
    
    productCache = {
      products: Array.from(seriesMap.values()),
      lastFetch: Date.now()
    };
    
    const styles = {};
    productCache.products.forEach(p => {
      styles[p.style] = (styles[p.style] || 0) + 1;
    });
    
    console.log('Cached products by style:', styles);
    
    return true;
  } catch (error) {
    console.error('Error fetching from Stuller:', error);
    return false;
  }
}

// Ensure cache is valid
async function ensureCacheValid() {
  if (!productCache.lastFetch || Date.now() - productCache.lastFetch > CACHE_DURATION) {
    await fetchCuratedProducts();
  }
}

// Analyze ring image with Claude Vision
async function analyzeRingImage(imageBase64, mimeType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: `Analyze this engagement ring image and identify:

1. **Metal Color**: White Gold, Yellow Gold, Rose Gold, or Platinum
2. **Center Stone Shape**: Round, Oval, Princess, Cushion, Emerald, Pear, Marquise, Radiant, Asscher, or Heart
3. **Setting Style**: Solitaire, Halo, Hidden Halo, or Three Stone

Respond ONLY in this exact JSON format:
{
  "metalColor": "White Gold",
  "centerShape": "OVAL",
  "style": "Halo",
  "confidence": 0.85
}`
            }
          ]
        }
      ]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(response.error.message));
            return;
          }
          const textContent = response.content?.find(c => c.type === 'text');
          const jsonMatch = textContent?.text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            reject(new Error('Could not parse response'));
            return;
          }
          const analysis = JSON.parse(jsonMatch[0]);
          resolve({
            metalColor: analysis.metalColor || 'White Gold',
            centerShape: (analysis.centerShape || 'ROUND').toUpperCase(),
            style: analysis.style || 'Solitaire',
            confidence: analysis.confidence || 0.7
          });
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

// ============================================
// API Routes
// ============================================

// Analyze ring image
app.post('/api/analyze-image', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    
    if (!image) {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    let imageBase64 = image;
    if (image.includes('base64,')) {
      imageBase64 = image.split('base64,')[1];
    }

    let detectedMimeType = mimeType || 'image/jpeg';
    if (image.startsWith('data:')) {
      const match = image.match(/data:([^;]+);/);
      if (match) detectedMimeType = match[1];
    }

    console.log('Analyzing image...');
    const analysis = await analyzeRingImage(imageBase64, detectedMimeType);
    console.log('Analysis:', analysis);
    
    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get curated settings
app.get('/api/settings', async (req, res) => {
  try {
    const { style, centerShape } = req.query;
    
    await ensureCacheValid();
    
    let results = [...productCache.products];
    
    // Filter by style
    if (style && style !== 'All') {
      results = results.filter(p => 
        p.style.toLowerCase() === style.toLowerCase()
      );
    }
    
    // Filter by center shape
    if (centerShape && centerShape !== 'All') {
      results = results.filter(p => 
        p.centerShape === centerShape.toUpperCase()
      );
    }
    
    // Format for frontend
    const items = results.map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      style: p.style,
      prices: {
        [p.metal.code]: { ...p.metal, price: p.price }
      },
      defaultMetal: p.metal.karat,
      defaultColor: p.metal.color,
      centerShapes: [p.centerShape],
      shippingDays: p.leadTime,
      images: p.image ? [p.image] : [],
      category: 'Engagement Rings'
    }));

    res.json({
      success: true,
      data: {
        items: items,
        totalCount: items.length,
        page: 1,
        limit: items.length,
        hasMore: false
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get styles (only the ones we have)
app.get('/api/styles', (req, res) => {
  res.json({
    success: true,
    data: ['Solitaire', 'Halo', 'Hidden Halo', 'Three Stone']
  });
});

// Get shapes
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

// Get metals
app.get('/api/metals', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: '14KW', karat: '14kt', color: 'White', label: '14K White Gold', hex: '#E8E8E8' },
      { id: '14KY', karat: '14kt', color: 'Yellow', label: '14K Yellow Gold', hex: '#FFD700' },
      { id: '14KR', karat: '14kt', color: 'Rose', label: '14K Rose Gold', hex: '#B76E79' },
      { id: '18KW', karat: '18kt', color: 'White', label: '18K White Gold', hex: '#F0F0F0' },
      { id: 'PLAT', karat: 'Platinum', color: 'White', label: 'Platinum', hex: '#E5E4E2' }
    ]
  });
});

// Get sizes
app.get('/api/sizes', (req, res) => {
  res.json({
    success: true,
    data: ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10']
  });
});

// Health check
app.get('/api/health', (req, res) => {
  const styles = {};
  productCache.products.forEach(p => {
    styles[p.style] = (styles[p.style] || 0) + 1;
  });
  
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    cacheAge: productCache.lastFetch ? Math.round((Date.now() - productCache.lastFetch) / 1000) + 's' : 'not cached',
    totalProducts: productCache.products.length,
    byStyle: styles
  });
});

// Force refresh
app.post('/api/refresh-cache', async (req, res) => {
  await fetchCuratedProducts();
  res.json({ success: true, message: 'Cache refreshed', total: productCache.products.length });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Curated Ring Builder API running on port ${PORT}`);
  console.log('Fetching your hand-picked collection...');
  fetchCuratedProducts();
});

module.exports = app;
