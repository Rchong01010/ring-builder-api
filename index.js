// ============================================================================
// RING BUILDER API - Backend for Gabriella Amoura Ring Builder
// Updated: January 2026
// ============================================================================

const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================================
// RING CATALOG - 242 rings parsed from Stuller data
// ============================================================================
const RING_CATALOG = require('./ring_catalog.json');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function getStyleCounts() {
  const counts = {};
  RING_CATALOG.forEach(r => {
    counts[r.style] = (counts[r.style] || 0) + 1;
  });
  return counts;
}

function getMetalCounts() {
  const counts = {};
  RING_CATALOG.forEach(r => {
    counts[r.metal] = (counts[r.metal] || 0) + 1;
  });
  return counts;
}

function getShapeCounts() {
  const counts = {};
  RING_CATALOG.forEach(r => {
    counts[r.shape] = (counts[r.shape] || 0) + 1;
  });
  return counts;
}

function filterRings(filters) {
  let results = [...RING_CATALOG];
  
  if (filters.style) {
    results = results.filter(r => 
      r.style.toLowerCase().includes(filters.style.toLowerCase())
    );
  }
  
  if (filters.metal) {
    results = results.filter(r => 
      r.metal.toLowerCase().includes(filters.metal.toLowerCase())
    );
  }
  
  if (filters.shape) {
    results = results.filter(r => 
      r.shape.toLowerCase().includes(filters.shape.toLowerCase())
    );
  }
  
  if (filters.minPrice) {
    results = results.filter(r => r.price >= parseFloat(filters.minPrice));
  }
  
  if (filters.maxPrice) {
    results = results.filter(r => r.price <= parseFloat(filters.maxPrice));
  }
  
  if (filters.q) {
    const query = filters.q.toLowerCase();
    results = results.filter(r => 
      r.name.toLowerCase().includes(query) ||
      r.style.toLowerCase().includes(query) ||
      r.metal.toLowerCase().includes(query) ||
      r.shape.toLowerCase().includes(query) ||
      r.seriesId.includes(query)
    );
  }
  
  return results;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    totalRings: RING_CATALOG.length,
    styles: getStyleCounts(),
    metals: getMetalCounts(),
    shapes: getShapeCounts()
  });
});

// Get all rings (with optional filtering)
app.get('/api/rings', (req, res) => {
  const filters = {
    style: req.query.style,
    metal: req.query.metal,
    shape: req.query.shape,
    minPrice: req.query.minPrice,
    maxPrice: req.query.maxPrice,
    q: req.query.q
  };
  
  const results = filterRings(filters);
  
  res.json({
    success: true,
    count: results.length,
    data: results
  });
});

// Get rings by style
app.get('/api/rings/style/:style', (req, res) => {
  const style = req.params.style;
  const results = RING_CATALOG.filter(r => 
    r.style.toLowerCase().replace(/[^a-z0-9]/g, '') === 
    style.toLowerCase().replace(/[^a-z0-9]/g, '')
  );
  
  res.json({
    success: true,
    style: style,
    count: results.length,
    data: results
  });
});

// Get rings by metal
app.get('/api/rings/metal/:metal', (req, res) => {
  const metal = req.params.metal;
  const results = RING_CATALOG.filter(r => 
    r.metal.toLowerCase().includes(metal.toLowerCase())
  );
  
  res.json({
    success: true,
    metal: metal,
    count: results.length,
    data: results
  });
});

// Get rings by shape
app.get('/api/rings/shape/:shape', (req, res) => {
  const shape = req.params.shape;
  const results = RING_CATALOG.filter(r => 
    r.shape.toLowerCase() === shape.toLowerCase()
  );
  
  res.json({
    success: true,
    shape: shape,
    count: results.length,
    data: results
  });
});

// Get rings by series
app.get('/api/rings/series/:seriesId', (req, res) => {
  const seriesId = req.params.seriesId;
  const results = RING_CATALOG.filter(r => r.seriesId === seriesId);
  
  res.json({
    success: true,
    seriesId: seriesId,
    count: results.length,
    data: results
  });
});

// Get single ring by ID
app.get('/api/ring/:id', (req, res) => {
  const ring = RING_CATALOG.find(r => r.id === req.params.id);
  
  if (!ring) {
    return res.status(404).json({
      success: false,
      error: 'Ring not found'
    });
  }
  
  // Get related rings (same style or series)
  const related = RING_CATALOG.filter(r => 
    r.id !== ring.id && (r.style === ring.style || r.seriesId === ring.seriesId)
  ).slice(0, 6);
  
  res.json({
    success: true,
    data: ring,
    related: related
  });
});

// Search rings
app.get('/api/search', (req, res) => {
  const filters = {
    q: req.query.q,
    style: req.query.style,
    metal: req.query.metal,
    shape: req.query.shape,
    minPrice: req.query.minPrice,
    maxPrice: req.query.maxPrice
  };
  
  const results = filterRings(filters);
  
  // Sort by relevance if search query provided
  if (filters.q) {
    const query = filters.q.toLowerCase();
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase().includes(query) ? 1 : 0;
      const bExact = b.name.toLowerCase().includes(query) ? 1 : 0;
      return bExact - aExact;
    });
  }
  
  res.json({
    success: true,
    query: filters,
    count: results.length,
    data: results
  });
});

// Get available styles
app.get('/api/styles', (req, res) => {
  const styles = [...new Set(RING_CATALOG.map(r => r.style))].sort();
  res.json({
    success: true,
    data: styles,
    counts: getStyleCounts()
  });
});

// Get available metals
app.get('/api/metals', (req, res) => {
  const metals = [...new Set(RING_CATALOG.map(r => r.metal))].sort();
  res.json({
    success: true,
    data: metals,
    counts: getMetalCounts()
  });
});

// Get available shapes
app.get('/api/shapes', (req, res) => {
  const shapes = [...new Set(RING_CATALOG.map(r => r.shape))].sort();
  res.json({
    success: true,
    data: shapes,
    counts: getShapeCounts()
  });
});

// Get price range
app.get('/api/price-range', (req, res) => {
  const prices = RING_CATALOG.map(r => r.price);
  res.json({
    success: true,
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((a, b) => a + b, 0) / prices.length
  });
});

// ============================================================================
// AI RING ANALYSIS ENDPOINT
// ============================================================================
app.post('/api/analyze-ring', async (req, res) => {
  const { image } = req.body;
  
  if (!image) {
    return res.status(400).json({
      success: false,
      error: 'No image provided'
    });
  }
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: 'Anthropic API key not configured'
    });
  }
  
  try {
    // Call Claude API to analyze the ring image
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
                data: image.replace(/^data:image\/\w+;base64,/, '')
              }
            },
            {
              type: 'text',
              text: `Analyze this engagement ring image and identify:
1. Ring Style (choose from: Bezel-Set, 6-Prong Solitaire, 4-Prong Solitaire, Three Stone, Halo, Hidden Halo, Sculptural, Accented Shank, Band, Eternity Band, Solitaire)
2. Metal Type (14K White Gold, 14K Yellow Gold, 14K Rose Gold, Platinum)
3. Stone Shape (Round, Square, Oval, Cushion, Princess, Emerald, Pear, Marquise)
4. Estimated center stone size in mm
5. Any distinctive features

Respond in JSON format:
{
  "style": "...",
  "metal": "...",
  "shape": "...",
  "stoneSize": "...",
  "features": ["feature1", "feature2"],
  "confidence": 0.0-1.0,
  "description": "Brief description of the ring"
}`
            }
          ]
        }]
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }
    
    // Parse AI response
    let analysis;
    try {
      const content = data.content[0].text;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: content };
    } catch (e) {
      analysis = { raw: data.content[0].text };
    }
    
    // Find matching rings from catalog
    let matches = [...RING_CATALOG];
    
    // Filter by style if identified
    if (analysis.style) {
      const styleMatches = matches.filter(r => 
        r.style.toLowerCase().includes(analysis.style.toLowerCase()) ||
        analysis.style.toLowerCase().includes(r.style.toLowerCase())
      );
      if (styleMatches.length > 0) matches = styleMatches;
    }
    
    // Filter by metal if identified
    if (analysis.metal) {
      const metalMatches = matches.filter(r => 
        r.metal.toLowerCase().includes(analysis.metal.toLowerCase().replace('gold', '').trim())
      );
      if (metalMatches.length > 0) matches = metalMatches;
    }
    
    // Filter by shape if identified
    if (analysis.shape) {
      const shapeMatches = matches.filter(r => 
        r.shape.toLowerCase() === analysis.shape.toLowerCase()
      );
      if (shapeMatches.length > 0) matches = shapeMatches;
    }
    
    // Return top matches
    const recommendations = matches.slice(0, 10);
    
    res.json({
      success: true,
      analysis: analysis,
      matchCount: matches.length,
      recommendations: recommendations
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// ROOT ENDPOINT
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    name: 'Ring Builder API',
    version: '2.0',
    totalRings: RING_CATALOG.length,
    endpoints: [
      'GET /api/health',
      'GET /api/rings',
      'GET /api/rings?style=&metal=&shape=&minPrice=&maxPrice=&q=',
      'GET /api/rings/style/:style',
      'GET /api/rings/metal/:metal',
      'GET /api/rings/shape/:shape',
      'GET /api/rings/series/:seriesId',
      'GET /api/ring/:id',
      'GET /api/search?q=&style=&metal=&shape=&minPrice=&maxPrice=',
      'GET /api/styles',
      'GET /api/metals',
      'GET /api/shapes',
      'GET /api/price-range',
      'POST /api/analyze-ring'
    ]
  });
});

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log(`Ring Builder API running on port ${PORT}`);
  console.log(`Total rings in catalog: ${RING_CATALOG.length}`);
  console.log(`Styles: ${Object.keys(getStyleCounts()).join(', ')}`);
  console.log(`Metals: ${Object.keys(getMetalCounts()).join(', ')}`);
});
