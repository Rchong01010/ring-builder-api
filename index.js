const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Anthropic API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Curated series by style (79 total)
const SERIES_BY_STYLE = {
  'Solitaire': [
    '123823', '123213', '122089', '122969', '124171', '140401', '140309', '126764',
    '124305', '123713', '122939', '126617', '122099', '126306', '124348', '150508',
    '124852', '140406', '124702', '123054', '150309', '122047', '126320', '170401',
    '122705', '124170', '170309', '122118', '123226', '140408', '124797', '124047'
  ],
  'Halo': [
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

// Diamond shapes with compatible series
const SHAPES = ['Round', 'Oval', 'Princess', 'Cushion', 'Emerald', 'Pear', 'Marquise', 'Radiant', 'Asscher'];

// All series with metadata (pre-populated for speed)
// In production, this could come from Stuller API
const RING_DATA = generateRingData();

function generateRingData() {
  const rings = [];
  const metals = ['14K White Gold', '14K Rose Gold', '14K Yellow Gold', 'Platinum', '18K White Gold'];
  
  for (const [style, seriesIds] of Object.entries(SERIES_BY_STYLE)) {
    seriesIds.forEach((seriesId, index) => {
      // Distribute shapes and metals across rings
      const shapes = ['Round', 'Oval', 'Princess', 'Cushion', 'Emerald', 'Pear'];
      const compatibleShapes = shapes.slice(0, 3 + (index % 4)); // Each ring supports 3-6 shapes
      
      rings.push({
        id: seriesId,
        seriesId: seriesId,
        style: style,
        name: `${style} Setting ${seriesId}`,
        metal: metals[index % metals.length],
        compatibleShapes: compatibleShapes,
        description: getStyleDescription(style),
        priceRange: getPriceRange(style)
      });
    });
  }
  
  return rings;
}

function getStyleDescription(style) {
  const descriptions = {
    'Solitaire': 'Classic elegance with a single center stone',
    'Halo': 'Center stone encircled by brilliant smaller diamonds',
    'Hidden Halo': 'Subtle diamonds hidden beneath the center stone',
    'Three Stone': 'Symbolic trilogy representing past, present, and future'
  };
  return descriptions[style] || '';
}

function getPriceRange(style) {
  const ranges = {
    'Solitaire': '$800 - $2,500',
    'Halo': '$1,200 - $3,500',
    'Hidden Halo': '$1,000 - $3,000',
    'Three Stone': '$1,500 - $4,500'
  };
  return ranges[style] || '$1,000 - $3,000';
}

// Style descriptions for AI
const STYLE_DESCRIPTIONS = {
  'Solitaire': 'A single center stone with no additional accent stones. Clean, classic, minimalist design.',
  'Halo': 'Center stone surrounded by a "halo" of smaller diamonds encircling the main stone.',
  'Hidden Halo': 'Looks like solitaire from above, but has small diamonds hidden underneath, visible from the side.',
  'Three Stone': 'Three stones - larger center flanked by two smaller side stones.'
};

// Call Claude API for image analysis
async function analyzeRingImage(base64Image, mediaType) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image }
          },
          {
            type: 'text',
            text: `You are an expert jeweler. Analyze this engagement ring image.

Identify:
1. **Style**: Solitaire, Halo, Hidden Halo, or Three Stone
   - Solitaire: ${STYLE_DESCRIPTIONS['Solitaire']}
   - Halo: ${STYLE_DESCRIPTIONS['Halo']}
   - Hidden Halo: ${STYLE_DESCRIPTIONS['Hidden Halo']}
   - Three Stone: ${STYLE_DESCRIPTIONS['Three Stone']}

2. **Diamond Shape**: Round, Oval, Princess, Cushion, Emerald, Pear, Marquise, Radiant, or Asscher

3. **Metal**: White Gold, Yellow Gold, Rose Gold, or Platinum

Respond ONLY with this JSON:
{
  "style": "STYLE_NAME",
  "shape": "SHAPE_NAME", 
  "metal": "METAL_NAME",
  "confidence": "high/medium/low",
  "description": "Brief 1-sentence description of the ring"
}

If not a ring or unclear, use "Unknown" for fields you can't determine.`
          }
        ]
      }]
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
          if (textContent) {
            const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              resolve(JSON.parse(jsonMatch[0]));
            } else {
              reject(new Error('Could not parse response'));
            }
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(requestBody);
    req.end();
  });
}

// ============ API ROUTES ============

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasApiKey: !!ANTHROPIC_API_KEY,
    totalRings: RING_DATA.length,
    styles: Object.keys(SERIES_BY_STYLE),
    shapes: SHAPES
  });
});

// Get all styles
app.get('/api/styles', (req, res) => {
  const styles = Object.entries(SERIES_BY_STYLE).map(([name, series]) => ({
    name,
    count: series.length,
    description: STYLE_DESCRIPTIONS[name]
  }));
  res.json({ styles });
});

// Get all shapes
app.get('/api/shapes', (req, res) => {
  res.json({ shapes: SHAPES });
});

// Get rings by style
app.get('/api/rings/by-style/:style', (req, res) => {
  const style = req.params.style;
  const rings = RING_DATA.filter(r => r.style.toLowerCase() === style.toLowerCase());
  res.json({ rings, total: rings.length });
});

// Get rings by shape
app.get('/api/rings/by-shape/:shape', (req, res) => {
  const shape = req.params.shape;
  const rings = RING_DATA.filter(r => 
    r.compatibleShapes.some(s => s.toLowerCase() === shape.toLowerCase())
  );
  res.json({ rings, total: rings.length });
});

// Get rings by style AND shape
app.get('/api/rings/filter', (req, res) => {
  const { style, shape } = req.query;
  let rings = RING_DATA;
  
  if (style && style !== 'all') {
    rings = rings.filter(r => r.style.toLowerCase() === style.toLowerCase());
  }
  
  if (shape && shape !== 'all') {
    rings = rings.filter(r => 
      r.compatibleShapes.some(s => s.toLowerCase() === shape.toLowerCase())
    );
  }
  
  res.json({ rings, total: rings.length });
});

// Get all rings
app.get('/api/rings', (req, res) => {
  res.json({ rings: RING_DATA, total: RING_DATA.length });
});

// Analyze ring image
app.post('/api/analyze-ring', async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }
    
    let base64Data = image;
    if (image.includes('base64,')) {
      base64Data = image.split('base64,')[1];
    }
    
    let mediaType = 'image/jpeg';
    if (image.includes('data:image/png')) mediaType = 'image/png';
    else if (image.includes('data:image/webp')) mediaType = 'image/webp';
    
    const analysis = await analyzeRingImage(base64Data, mediaType);
    
    // Find matching rings
    let matchingRings = RING_DATA;
    
    if (analysis.style && analysis.style !== 'Unknown') {
      matchingRings = matchingRings.filter(r => 
        r.style.toLowerCase() === analysis.style.toLowerCase()
      );
    }
    
    if (analysis.shape && analysis.shape !== 'Unknown') {
      matchingRings = matchingRings.filter(r =>
        r.compatibleShapes.some(s => s.toLowerCase() === analysis.shape.toLowerCase())
      );
    }
    
    res.json({
      success: true,
      analysis,
      matchingRings: matchingRings.slice(0, 12), // Return top 12 matches
      totalMatches: matchingRings.length
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint - get raw Stuller API response to find image fields
app.get('/api/debug/stuller/:seriesId', async (req, res) => {
  const { seriesId } = req.params;
  
  // Stuller credentials from environment
  const STULLER_USER = process.env.STULLER_USERNAME || 'diamondsupplies1234';
  const STULLER_PASS = process.env.STULLER_PASSWORD || 'Letsgo2020@@';
  
  const searchBody = JSON.stringify({
    "SeriesId": seriesId,
    "PageSize": 1
  });

  const options = {
    hostname: 'api.stuller.com',
    path: '/v2/products/search',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${STULLER_USER}:${STULLER_PASS}`).toString('base64'),
      'Content-Length': Buffer.byteLength(searchBody)
    }
  };

  const request = require('https').request(options, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        // Return the FULL response so we can find image fields
        res.json({
          seriesId,
          rawResponse: parsed,
          // Also try to find any field containing 'image', 'asset', 'media', 'photo', 'das'
          possibleImageFields: findImageFields(parsed)
        });
      } catch (e) {
        res.json({ error: e.message, raw: data });
      }
    });
  });

  request.on('error', (e) => {
    res.status(500).json({ error: e.message });
  });

  request.write(searchBody);
  request.end();
});

// Helper to recursively find fields that might contain image info
function findImageFields(obj, path = '') {
  const results = [];
  const imageKeywords = ['image', 'asset', 'media', 'photo', 'das', 'url', 'src', 'picture', 'thumbnail'];
  
  for (const key in obj) {
    const currentPath = path ? `${path}.${key}` : key;
    const value = obj[key];
    
    // Check if key name suggests image
    if (imageKeywords.some(kw => key.toLowerCase().includes(kw))) {
      results.push({ path: currentPath, value });
    }
    
    // Check if value is a URL containing image-related domains
    if (typeof value === 'string' && (value.includes('stullercloud') || value.includes('meteor') || value.includes('.jpg') || value.includes('.png'))) {
      results.push({ path: currentPath, value });
    }
    
    // Recurse into objects and arrays
    if (value && typeof value === 'object') {
      results.push(...findImageFields(value, currentPath));
    }
  }
  
  return results;
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ring Builder API on port ${PORT}`);
  console.log(`Loaded ${RING_DATA.length} rings`);
});
