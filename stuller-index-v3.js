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

// Parse metal info from SKU (e.g., "10138:44061:P:10KR" -> 10K Rose)
function parseMetalFromSku(sku) {
  const parts = sku.split(':');
  const metalCode = parts[parts.length - 1] || '';
  
  const metalMap = {
    '10KW': { karat: '10kt', color: 'White', label: '10K White Gold' },
    '10KY': { karat: '10kt', color: 'Yellow', label: '10K Yellow Gold' },
    '10KR': { karat: '10kt', color: 'Pink', label: '10K Rose Gold' },
    '14KW': { karat: '14kt', color: 'White', label: '14K White Gold' },
    '14KY': { karat: '14kt', color: 'Yellow', label: '14K Yellow Gold' },
    '14KR': { karat: '14kt', color: 'Pink', label: '14K Rose Gold' },
    '18KW': { karat: '18kt', color: 'White', label: '18K White Gold' },
    '18KY': { karat: '18kt', color: 'Yellow', label: '18K Yellow Gold' },
    '18KR': { karat: '18kt', color: 'Pink', label: '18K Rose Gold' },
    'PLAT': { karat: 'Platinum', color: 'White', label: 'Platinum' },
    'P': { karat: 'Platinum', color: 'White', label: 'Platinum' },
    'SS': { karat: 'Silver', color: 'White', label: 'Sterling Silver' }
  };

  return metalMap[metalCode] || { karat: '14kt', color: 'White', label: '14K White Gold' };
}

// Determine style from description/categories
function determineStyle(product) {
  const desc = (product.Description || '').toLowerCase();
  const groupDesc = (product.GroupDescription || '').toLowerCase();
  const combined = desc + ' ' + groupDesc;
  
  if (combined.includes('halo') && combined.includes('hidden')) return 'Hidden Halo';
  if (combined.includes('halo')) return 'Halo';
  if (combined.includes('solitaire')) return 'Solitaire';
  if (combined.includes('three stone') || combined.includes('3 stone')) return 'Three Stone';
  if (combined.includes('vintage')) return 'Vintage';
  if (combined.includes('pave') || combined.includes('pavé')) return 'Pavé';
  if (combined.includes('cathedral')) return 'Cathedral';
  if (combined.includes('channel')) return 'Channel Set';
  if (combined.includes('bezel')) return 'Bezel';
  if (combined.includes('twist')) return 'Twisted';
  if (combined.includes('accented')) return 'Accented';
  
  return 'Classic';
}

// Determine center stone shape from description
function determineCenterShape(product) {
  const desc = (product.Description || '').toLowerCase();
  const groupDesc = (product.GroupDescription || '').toLowerCase();
  const combined = desc + ' ' + groupDesc;
  
  const shapes = ['round', 'oval', 'princess', 'cushion', 'emerald', 'pear', 'marquise', 'radiant', 'asscher', 'heart'];
  
  for (const shape of shapes) {
    if (combined.includes(shape)) {
      return shape.toUpperCase();
    }
  }
  
  // Default to multiple shapes if not specified (peg head mountings)
  return 'UNIVERSAL';
}

// Transform Stuller product to our format
function transformStullerProduct(product) {
  const metal = parseMetalFromSku(product.SKU || '');
  const style = determineStyle(product);
  const centerShape = determineCenterShape(product);
  
  // Get primary image
  let primaryImage = null;
  if (product.GroupImages && product.GroupImages.length > 0) {
    primaryImage = product.GroupImages[0].ZoomUrl || product.GroupImages[0].FullUrl;
  }
  
  // Get all images
  const images = (product.GroupImages || []).map(img => img.ZoomUrl || img.FullUrl).filter(Boolean);
  
  // Build price object
  const prices = {};
  const priceValue = product.Price?.Value || 0;
  const metalCode = metal.karat.replace('kt', 'K') + metal.color.charAt(0);
  prices[metalCode] = {
    ...metal,
    price: priceValue
  };

  return {
    id: product.Id?.toString() || product.SKU,
    sku: product.SKU,
    name: product.GroupDescription || product.Description || `Style ${product.SKU}`,
    description: product.Description || '',
    style,
    prices,
    defaultMetal: metal.karat,
    defaultColor: metal.color,
    centerShapes: centerShape === 'UNIVERSAL' 
      ? ['ROUND', 'OVAL', 'PRINCESS', 'CUSHION', 'EMERALD', 'PEAR', 'MARQUISE', 'RADIANT', 'ASSCHER', 'HEART']
      : [centerShape],
    sideDiamondCount: product.DescriptiveElementGroup?.SideStoneCount || 0,
    metalWeight: product.GramWeight || null,
    fingerSize: product.RingSize?.toString() || '7',
    shippingDays: product.LeadTime || 14,
    images: images.length > 0 ? images : [primaryImage].filter(Boolean),
    category: product.MerchandisingCategory3 || 'Engagement Rings',
    stullerUrl: `https://www.stuller.com/products/${product.SKU?.split(':')[0]}/`
  };
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
1. **Metal Color**: What metal color is the ring? Options: White Gold, Yellow Gold, Rose Gold, Platinum, Two-Tone
2. **Center Stone Shape**: What is the shape of the center diamond/stone? Options: Round, Oval, Princess, Cushion, Emerald, Pear, Marquise, Radiant, Asscher, Heart
3. **Setting Style**: What style is the ring setting? Options: Solitaire, Halo, Hidden Halo, Three Stone, Pavé, Vintage, Cathedral, Bezel, Channel Set, Twisted

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

// Get engagement ring settings from Stuller
app.get('/api/settings', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20,
      centerShape,
      style
    } = req.query;

    console.log('Fetching engagement rings from Stuller...');
    
    // Request engagement ring mountings from Stuller
    // This returns 5M+ products across all styles (solitaire, halo, three stone, etc.)
    const requestBody = {
      "Include": ["All"],
      "MerchandisingCategory1": ["Mountings"],
      "MerchandisingCategory2": ["Rings"],
      "MerchandisingCategory3": ["Engagement Rings"],
      "MerchandisingCategory4": ["Solitaire", "Halo", "Three Stone"],
      "Filter": ["Orderable", "OnPriceList"],
      "PageSize": parseInt(limit),
      "PageNumber": parseInt(page)
    };

    const data = await makeStullerRequest('/v2/products', 'POST', requestBody);
    
    let products = data.Products || [];
    console.log(`Received ${products.length} products from Stuller`);

    // Transform products to our format
    let transformedItems = products.map(transformStullerProduct);

    // Apply filters
    if (centerShape) {
      const shapeUpper = centerShape.toUpperCase();
      transformedItems = transformedItems.filter(item => 
        item.centerShapes.includes(shapeUpper) || item.centerShapes.length === 10
      );
    }

    if (style) {
      transformedItems = transformedItems.filter(item => 
        item.style.toLowerCase() === style.toLowerCase()
      );
    }

    res.json({
      success: true,
      data: {
        items: transformedItems,
        totalCount: data.TotalCount || transformedItems.length,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: products.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching settings from Stuller:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings',
      details: error.message
    });
  }
});

// Get single setting by SKU
app.get('/api/settings/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    
    // Fetch single product from Stuller
    const data = await makeStullerRequest(`/v2/products?SKU=${encodeURIComponent(sku)}`, 'GET');
    
    const products = data.Products || [];
    
    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }

    res.json({
      success: true,
      data: transformStullerProduct(products[0])
    });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch setting',
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
      'Hidden Halo',
      'Three Stone',
      'Pavé',
      'Channel Set',
      'Bezel',
      'Vintage',
      'Cathedral',
      'Twisted',
      'Accented',
      'Classic'
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
      { id: 'PEAR', name: 'Pear', icon: '◊' },
      { id: 'MARQUISE', name: 'Marquise', icon: '◇' },
      { id: 'RADIANT', name: 'Radiant', icon: '▣' },
      { id: 'ASSCHER', name: 'Asscher', icon: '□' },
      { id: 'HEART', name: 'Heart', icon: '♡' }
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
      { id: '18KY', karat: '18kt', color: 'Yellow', label: '18K Yellow Gold', hex: '#FFCC00' },
      { id: '18KR', karat: '18kt', color: 'Pink', label: '18K Rose Gold', hex: '#C77B88' },
      { id: 'PLAT', karat: 'Platinum', color: 'White', label: 'Platinum', hex: '#E5E4E2' }
    ]
  });
});

// Ring sizes
app.get('/api/sizes', (req, res) => {
  res.json({
    success: true,
    data: ['4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12']
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    stuller: 'connected'
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Ring Builder API server running on port ${PORT}`);
  console.log('Stuller API integration enabled');
});

module.exports = app;
