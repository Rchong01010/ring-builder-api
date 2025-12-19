const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// API Keys from environment variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STULLER_USERNAME = process.env.STULLER_USERNAME || 'diamondsupplies1234';
const STULLER_PASSWORD = process.env.STULLER_PASSWORD || 'Letsgo2020@@';

// Stuller API base URL
const STULLER_API_BASE = 'api.stuller.com';

// Cache for Stuller products (refreshes every hour)
let productCache = {
  solitaire: [],
  halo: [],
  threeStone: [],
  vintage: [],
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

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (e) {
          reject(new Error('Failed to parse Stuller response'));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Determine style from GroupDescription
function getStyleFromGroupDescription(groupDesc) {
  if (!groupDesc) return null;
  const desc = groupDesc.toLowerCase();
  
  if (desc.includes('solitaire')) return 'Solitaire';
  if (desc.includes('halo')) return 'Halo';
  if (desc.includes('three stone') || desc.includes('three-stone') || desc.includes('3 stone')) return 'Three Stone';
  if (desc.includes('vintage') || desc.includes('sculptural')) return 'Vintage';
  if (desc.includes('hidden halo')) return 'Hidden Halo';
  if (desc.includes('pave') || desc.includes('pavé')) return 'Pavé';
  
  return null; // Not a style we want
}

// Determine center stone shape from description
function getCenterShape(product) {
  const desc = (product.Description || '').toLowerCase();
  const shapes = ['round', 'oval', 'princess', 'cushion', 'emerald', 'pear', 'marquise', 'radiant', 'asscher', 'heart'];
  
  for (const shape of shapes) {
    if (desc.includes(shape)) {
      return shape.toUpperCase();
    }
  }
  return 'ROUND'; // Default
}

// Parse metal from description
function getMetalFromDescription(desc) {
  if (!desc) return { karat: '14kt', color: 'White', label: '14K White Gold' };
  const d = desc.toLowerCase();
  
  let karat = '14kt';
  let color = 'White';
  
  if (d.includes('10k')) karat = '10kt';
  else if (d.includes('14k')) karat = '14kt';
  else if (d.includes('18k')) karat = '18kt';
  else if (d.includes('platinum')) karat = 'Platinum';
  
  if (d.includes('yellow')) color = 'Yellow';
  else if (d.includes('rose') || d.includes('pink')) color = 'Pink';
  else if (d.includes('white') || d.includes('platinum')) color = 'White';
  
  const label = karat === 'Platinum' ? 'Platinum' : `${karat.replace('kt', 'K')} ${color} Gold`;
  
  return { karat, color, label };
}

// Transform Stuller product to our clean format
function transformProduct(product) {
  const style = getStyleFromGroupDescription(product.GroupDescription);
  if (!style) return null; // Skip products without matching style
  
  const centerShape = getCenterShape(product);
  const metal = getMetalFromDescription(product.Description);
  
  // Get primary image
  let primaryImage = null;
  if (product.GroupImages && product.GroupImages.length > 0) {
    primaryImage = product.GroupImages[0].ZoomUrl || product.GroupImages[0].FullUrl;
  }
  
  // Extract series number from SKU (first part before colon)
  const series = product.SKU ? product.SKU.split(':')[0] : null;
  
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
    leadTime: product.LeadTime || 14,
    inStock: product.Status === 'In Stock',
    stullerUrl: `https://www.stuller.com/products/${series}/`
  };
}

// Fetch and cache products from Stuller
async function fetchAndCacheProducts() {
  console.log('Fetching products from Stuller API...');
  
  try {
    // Pull a large batch to find good variety
    const requestBody = {
      "Include": ["All"],
      "MerchandisingCategory1": ["Engagement"],
      "Filter": ["Orderable", "OnPriceList"],
      "PageSize": 500
    };

    const data = await makeStullerRequest('/v2/products', 'POST', requestBody);
    const products = data.Products || [];
    
    console.log(`Received ${products.length} products from Stuller`);
    
    // Transform and filter products
    const transformed = products
      .map(transformProduct)
      .filter(p => p !== null);
    
    console.log(`Found ${transformed.length} engagement ring styles`);
    
    // Group by series to avoid duplicates (keep one per series, prefer 14K White)
    const seriesMap = new Map();
    transformed.forEach(product => {
      if (!product.series) return;
      
      const existing = seriesMap.get(product.series);
      if (!existing) {
        seriesMap.set(product.series, product);
      } else {
        // Prefer 14K White Gold version
        if (product.metal.karat === '14kt' && product.metal.color === 'White') {
          seriesMap.set(product.series, product);
        }
      }
    });
    
    // Convert back to array and sort into style buckets
    const uniqueProducts = Array.from(seriesMap.values());
    
    productCache = {
      solitaire: uniqueProducts.filter(p => p.style === 'Solitaire').slice(0, 30),
      halo: uniqueProducts.filter(p => p.style === 'Halo' || p.style === 'Hidden Halo').slice(0, 30),
      threeStone: uniqueProducts.filter(p => p.style === 'Three Stone').slice(0, 30),
      vintage: uniqueProducts.filter(p => p.style === 'Vintage' || p.style === 'Pavé').slice(0, 30),
      lastFetch: Date.now()
    };
    
    console.log(`Cached: ${productCache.solitaire.length} solitaires, ${productCache.halo.length} halos, ${productCache.threeStone.length} three-stone, ${productCache.vintage.length} vintage`);
    
    return true;
  } catch (error) {
    console.error('Error fetching from Stuller:', error);
    return false;
  }
}

// Check if cache needs refresh
async function ensureCacheValid() {
  if (!productCache.lastFetch || Date.now() - productCache.lastFetch > CACHE_DURATION) {
    await fetchAndCacheProducts();
  }
}

// Analyze ring image using Claude Vision
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
              text: `Analyze this engagement ring image and identify the following characteristics. Be specific and confident in your analysis.

Please identify:
1. **Metal Color**: What metal color is the ring? Options: White Gold, Yellow Gold, Rose Gold, Platinum
2. **Center Stone Shape**: What is the shape of the center diamond/stone? Options: Round, Oval, Princess, Cushion, Emerald, Pear, Marquise, Radiant, Asscher, Heart
3. **Setting Style**: What style is the ring setting? Options: Solitaire, Halo, Hidden Halo, Three Stone, Pavé, Vintage

Respond ONLY in this exact JSON format, nothing else:
{
  "metalColor": "White Gold",
  "centerShape": "OVAL",
  "style": "Halo",
  "confidence": 0.85
}

Use confidence between 0.5 and 0.95 based on image clarity and how certain you are.`
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

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.error) {
            reject(new Error(response.error.message || 'API error'));
            return;
          }

          const textContent = response.content?.find(c => c.type === 'text');
          if (!textContent) {
            reject(new Error('No text response from API'));
            return;
          }

          const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
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
          reject(new Error('Failed to parse API response: ' + e.message));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(requestBody);
    req.end();
  });
}

// ============================================
// API Routes
// ============================================

// Analyze ring image endpoint
app.post('/api/analyze-image', async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    
    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    let imageBase64 = image;
    if (image.includes('base64,')) {
      imageBase64 = image.split('base64,')[1];
    }

    let detectedMimeType = mimeType || 'image/jpeg';
    if (image.startsWith('data:')) {
      const match = image.match(/data:([^;]+);/);
      if (match) {
        detectedMimeType = match[1];
      }
    }

    console.log('Analyzing image with Claude Vision...');
    const analysis = await analyzeRingImage(imageBase64, detectedMimeType);
    
    console.log('Analysis result:', analysis);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze image',
      details: error.message
    });
  }
});

// Get engagement ring settings - STREAMLINED
app.get('/api/settings', async (req, res) => {
  try {
    const { style, centerShape } = req.query;
    
    // Ensure cache is valid
    await ensureCacheValid();
    
    // Combine all cached products
    let allProducts = [
      ...productCache.solitaire,
      ...productCache.halo,
      ...productCache.threeStone,
      ...productCache.vintage
    ];
    
    // Filter by style if specified
    if (style && style !== 'All') {
      allProducts = allProducts.filter(p => 
        p.style.toLowerCase() === style.toLowerCase()
      );
    }
    
    // Filter by center shape if specified
    if (centerShape && centerShape !== 'All') {
      allProducts = allProducts.filter(p => 
        p.centerShape === centerShape.toUpperCase()
      );
    }
    
    // Transform to frontend format
    const items = allProducts.map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      description: p.description,
      style: p.style,
      prices: {
        [p.metal.karat + p.metal.color.charAt(0)]: {
          ...p.metal,
          price: p.price
        }
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
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings',
      details: error.message
    });
  }
});

// Get available styles
app.get('/api/styles', (req, res) => {
  res.json({
    success: true,
    data: [
      'Solitaire',
      'Halo',
      'Three Stone',
      'Vintage'
    ]
  });
});

// Get available shapes
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

// Get metal options
app.get('/api/metals', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: '14KW', karat: '14kt', color: 'White', label: '14K White Gold', hex: '#E8E8E8' },
      { id: '14KY', karat: '14kt', color: 'Yellow', label: '14K Yellow Gold', hex: '#FFD700' },
      { id: '14KR', karat: '14kt', color: 'Pink', label: '14K Rose Gold', hex: '#B76E79' },
      { id: '18KW', karat: '18kt', color: 'White', label: '18K White Gold', hex: '#F0F0F0' },
      { id: 'PLAT', karat: 'Platinum', color: 'White', label: 'Platinum', hex: '#E5E4E2' }
    ]
  });
});

// Ring sizes
app.get('/api/sizes', (req, res) => {
  res.json({
    success: true,
    data: ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9']
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cacheAge: productCache.lastFetch ? Math.round((Date.now() - productCache.lastFetch) / 1000) + 's' : 'not cached',
    products: {
      solitaire: productCache.solitaire.length,
      halo: productCache.halo.length,
      threeStone: productCache.threeStone.length,
      vintage: productCache.vintage.length
    }
  });
});

// Force cache refresh
app.post('/api/refresh-cache', async (req, res) => {
  await fetchAndCacheProducts();
  res.json({ 
    success: true, 
    message: 'Cache refreshed',
    products: {
      solitaire: productCache.solitaire.length,
      halo: productCache.halo.length,
      threeStone: productCache.threeStone.length,
      vintage: productCache.vintage.length
    }
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Ring Builder API server running on port ${PORT}`);
  console.log('Streamlined Stuller integration - curated engagement rings');
  
  // Pre-fetch products on startup
  fetchAndCacheProducts();
});

module.exports = app;
