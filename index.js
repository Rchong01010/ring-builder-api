const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// Overnight Mountings OAuth 1.0 credentials
const OAUTH_CONFIG = {
  consumerKey: 'bbae36baea2ef8dcd1f9a8a88cc59f06',
  consumerSecret: '5edc426ec2965bba17c96e766c47ad73',
  oauthToken: '819dc5826cd08cca9c57d392ba2b305e',
  oauthTokenSecret: '97565ea77d5c8c8f7c63b8f5f3916656',
  baseUrl: 'https://connect.overnightmountings.com'
};

// Category mappings
const CATEGORIES = {
  ENGAGEMENT_RINGS: 134,
  WEDDING_BANDS: 152,
  FASHION_RINGS: 694,
  BRACELETS: 497,
  PENDANTS: 1023,
  NECKLACES: 630,
  EARRINGS: 156
};

// Diamond quality mappings
const DIAMOND_QUALITIES = {
  'B': 'Lab Grown VS-SI1, E/F/G',
  'A': 'SI1, G',
  '1': 'SI1-SI2, H-I',
  '2': 'SI1-SI2, G-H',
  '3': 'I1, H-I',
  '4': 'VS1-VS2, F-G',
  '5': 'SI2, H-I',
  '7': 'I2, H-I',
  '8': 'Champagne',
  '9': 'Black Diamond'
};

// Generate OAuth 1.0 signature
function generateOAuthSignature(method, url, params) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const oauthParams = {
    oauth_consumer_key: OAUTH_CONFIG.consumerKey,
    oauth_token: OAUTH_CONFIG.oauthToken,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0'
  };

  // Combine all parameters
  const allParams = { ...oauthParams, ...params };

  // Sort and encode parameters
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
    .join('&');

  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams)
  ].join('&');

  // Create signing key
  const signingKey = `${encodeURIComponent(OAUTH_CONFIG.consumerSecret)}&${encodeURIComponent(OAUTH_CONFIG.oauthTokenSecret)}`;

  // Generate HMAC-SHA1 signature
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  // Return OAuth header
  return {
    ...oauthParams,
    oauth_signature: signature
  };
}

// Build OAuth Authorization header
function buildAuthHeader(oauthParams) {
  const headerParams = Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${headerParams}`;
}

// Make authenticated request to Overnight API
async function makeOvernightRequest(endpoint, queryParams = {}) {
  const url = `${OAUTH_CONFIG.baseUrl}${endpoint}`;
  const oauthParams = generateOAuthSignature('GET', url, queryParams);
  const authHeader = buildAuthHeader(oauthParams);

  const queryString = Object.keys(queryParams)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
    .join('&');

  const fullUrl = queryString ? `${url}?${queryString}` : url;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(fullUrl);
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          // Try to parse as JSON first
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (e) {
          // If not JSON, might be XML - return raw for now
          resolve(data);
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.end();
  });
}

// Transform API response to cleaner format for frontend
function transformSettingData(item) {
  // Parse prices from the finalprice object
  const prices = {};
  if (item.finalprice) {
    // Map the price codes to readable format
    const priceMap = {
      '4W2B': { karat: '14kt', color: 'White', label: '14K White Gold' },
      '4Y2B': { karat: '14kt', color: 'Yellow', label: '14K Yellow Gold' },
      '4K2B': { karat: '14kt', color: 'Pink', label: '14K Rose Gold' },
      '8W2B': { karat: '18kt', color: 'White', label: '18K White Gold' },
      '8Y2B': { karat: '18kt', color: 'Yellow', label: '18K Yellow Gold' },
      '8K2B': { karat: '18kt', color: 'Pink', label: '18K Rose Gold' },
      'PP2B': { karat: 'Platinum', color: 'White', label: 'Platinum' },
      // Polished versions (no side stones)
      '4W6': { karat: '14kt', color: 'White', label: '14K White Gold' },
      '4Y6': { karat: '14kt', color: 'Yellow', label: '14K Yellow Gold' },
      '4K6': { karat: '14kt', color: 'Pink', label: '14K Rose Gold' },
      '8W6': { karat: '18kt', color: 'White', label: '18K White Gold' },
      '8Y6': { karat: '18kt', color: 'Yellow', label: '18K Yellow Gold' },
      '8K6': { karat: '18kt', color: 'Pink', label: '18K Rose Gold' },
      'PP6': { karat: 'Platinum', color: 'White', label: 'Platinum' }
    };

    Object.entries(item.finalprice).forEach(([code, price]) => {
      if (priceMap[code] && price) {
        prices[code] = {
          ...priceMap[code],
          price: parseFloat(price)
        };
      }
    });
  }

  // Parse center shape compatibility
  let centerShapes = [];
  const centerShape = item.CenterShape || item.centershape || '';
  
  if (centerShape.toUpperCase() === 'TAKE PEG HEAD' || centerShape === '') {
    centerShapes = ['ROUND', 'OVAL', 'PRINCESS', 'CUSHION', 'EMERALD', 'PEAR', 'MARQUISE', 'RADIANT', 'ASSCHER', 'HEART'];
  } else {
    centerShapes = [centerShape.toUpperCase()];
  }

  // Parse images
  let images = [];
  if (item.default_image_url) {
    images.push(item.default_image_url);
  }
  if (item.images) {
    if (Array.isArray(item.images)) {
      images = [...images, ...item.images];
    } else if (typeof item.images === 'object') {
      images = [...images, ...Object.values(item.images)];
    }
  }

  // Parse videos
  let videos = [];
  if (item.video) {
    if (Array.isArray(item.video)) {
      videos = item.video;
    } else if (typeof item.video === 'object') {
      videos = Object.values(item.video);
    }
  }

  // Determine style category from categoryvalue or name
  const categoryValue = item.categoryvalue || '';
  const name = item.name || item.n || '';
  
  let style = 'Classic';
  const styleLower = (categoryValue + ' ' + name).toLowerCase();
  
  if (styleLower.includes('halo') && styleLower.includes('hidden')) {
    style = 'Hidden Halo';
  } else if (styleLower.includes('halo')) {
    style = 'Halo';
  } else if (styleLower.includes('solitaire')) {
    style = 'Solitaire';
  } else if (styleLower.includes('three stone') || styleLower.includes('3 stone')) {
    style = 'Three Stone';
  } else if (styleLower.includes('vintage')) {
    style = 'Vintage';
  } else if (styleLower.includes('pave') || styleLower.includes('pavé')) {
    style = 'Pavé';
  } else if (styleLower.includes('cathedral')) {
    style = 'Cathedral';
  } else if (styleLower.includes('channel')) {
    style = 'Channel Set';
  } else if (styleLower.includes('bezel')) {
    style = 'Bezel';
  } else if (styleLower.includes('twist')) {
    style = 'Twisted';
  }

  return {
    id: item.entity_id,
    sku: item.Sku || item.sku,
    name: item.name || item.n || `Style ${item.Sku || item.sku}`,
    description: item.description || '',
    style,
    prices,
    defaultMetal: item.metalType || '14kt',
    defaultColor: item.metalColor || 'White',
    centerShapes,
    centerCaratSize: item.fractioncenter || null,
    sideDiamondCarat: item.fractionsemimount || null,
    totalDiamondWeight: item.TotalDiamondWeight || null,
    sideDiamondCount: item.SideDiamondNumber || 0,
    metalWeight: item.metalWeight || null,
    fingerSize: item.FingerSize || '7',
    shippingDays: item.shippingDay || 14,
    images: [...new Set(images)], // Remove duplicates
    videos: [...new Set(videos)],
    category: item.ProductClass || 'Engagement Rings'
  };
}

// API Routes

// Get engagement ring settings
app.get('/api/settings', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 30, 
      category = CATEGORIES.ENGAGEMENT_RINGS,
      quality = 'B',
      centerShape,
      style
    } = req.query;

    const data = await makeOvernightRequest('/api/rest/itembom', {
      page_number: page,
      number_of_items: Math.min(parseInt(limit), 100),
      category_id: category,
      diamond_quality: quality
    });

    // Handle different response formats
    let items = [];
    let totalCount = 0;

    if (Array.isArray(data)) {
      items = data;
      totalCount = data.length;
    } else if (data && typeof data === 'object') {
      // Could be wrapped in a root element
      items = data.items || data.products || Object.values(data).filter(v => typeof v === 'object' && v.entity_id);
      totalCount = data.totalcount || items.length;
    }

    // Transform items
    let transformedItems = items.map(transformSettingData);

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
        totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: items.length === parseInt(limit)
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

// Get single setting by SKU
app.get('/api/settings/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    
    // Overnight API doesn't have a single-item endpoint, so we need to search
    // This is a workaround - in production you'd want to cache
    const data = await makeOvernightRequest('/api/rest/itembom', {
      page_number: 1,
      number_of_items: 100,
      category_id: CATEGORIES.ENGAGEMENT_RINGS,
      diamond_quality: 'B'
    });

    let items = Array.isArray(data) ? data : Object.values(data).filter(v => typeof v === 'object' && v.entity_id);
    
    const item = items.find(i => (i.Sku || i.sku) === sku);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Setting not found'
      });
    }

    res.json({
      success: true,
      data: transformSettingData(item)
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

// Get in-stock items
app.get('/api/in-stock', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 30, 
      category = 1201 // In-stock engagement rings (Lab Grown)
    } = req.query;

    const data = await makeOvernightRequest('/api/rest/instockitem', {
      page_number: page,
      number_of_items: Math.min(parseInt(limit), 100),
      category_id: category
    });

    let items = [];
    let totalCount = 0;

    if (Array.isArray(data)) {
      items = data;
      totalCount = data.length;
    } else if (data && typeof data === 'object') {
      items = data.items || data.products || Object.values(data).filter(v => typeof v === 'object' && v.entity_id);
      totalCount = data.totalcount || items.length;
    }

    const transformedItems = items.map(item => ({
      ...transformSettingData(item),
      inStock: true,
      quantityOnHand: item.qoh || 1
    }));

    res.json({
      success: true,
      data: {
        items: transformedItems,
        totalCount,
        page: parseInt(page),
        limit: parseInt(limit),
        hasMore: items.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching in-stock items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch in-stock items',
      details: error.message
    });
  }
});

// Get available styles (for filters)
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
      'Classic'
    ]
  });
});

// Get available shapes (for filters)
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
      { id: '4W', karat: '14kt', color: 'White', label: '14K White Gold', hex: '#E8E8E8' },
      { id: '4Y', karat: '14kt', color: 'Yellow', label: '14K Yellow Gold', hex: '#FFD700' },
      { id: '4K', karat: '14kt', color: 'Pink', label: '14K Rose Gold', hex: '#B76E79' },
      { id: '8W', karat: '18kt', color: 'White', label: '18K White Gold', hex: '#F0F0F0' },
      { id: '8Y', karat: '18kt', color: 'Yellow', label: '18K Yellow Gold', hex: '#FFCC00' },
      { id: '8K', karat: '18kt', color: 'Pink', label: '18K Rose Gold', hex: '#C77B88' },
      { id: 'PP', karat: 'Platinum', color: 'White', label: 'Platinum', hex: '#E5E4E2' }
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
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Ring Builder API server running on port ${PORT}`);
});

module.exports = app;
