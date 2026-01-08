const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ============================================================================
// RING CATALOG - 128 rings from your Stuller product feed
// ============================================================================
const RING_CATALOG = require('./ring_catalog.json');

// Build indexes for quick lookups
const getProductTypeCounts = () => {
  const counts = {};
  RING_CATALOG.forEach(ring => {
    counts[ring.productType] = (counts[ring.productType] || 0) + 1;
  });
  return counts;
};

const getStyleCounts = (productType) => {
  const counts = {};
  RING_CATALOG
    .filter(r => !productType || r.productType === productType)
    .forEach(ring => {
      counts[ring.style] = (counts[ring.style] || 0) + 1;
    });
  return counts;
};

// ============================================================================
// HEALTH CHECK
// ============================================================================
app.get('/api/health', (req, res) => {
  const productTypes = getProductTypeCounts();
  res.json({
    status: 'ok',
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasStullerCredentials: !!(process.env.STULLER_USERNAME && process.env.STULLER_PASSWORD),
    totalRings: RING_CATALOG.length,
    productTypes: productTypes,
    engagementStyles: getStyleCounts('Engagement Ring'),
    weddingStyles: getStyleCounts('Wedding Band')
  });
});

// ============================================================================
// GET ALL RINGS
// ============================================================================
app.get('/api/rings', (req, res) => {
  res.json({
    total: RING_CATALOG.length,
    rings: RING_CATALOG
  });
});

// ============================================================================
// GET RINGS BY PRODUCT TYPE (engagement or wedding)
// ============================================================================
app.get('/api/rings/type/:type', (req, res) => {
  const type = req.params.type.toLowerCase();
  let filtered;
  
  if (type === 'engagement') {
    filtered = RING_CATALOG.filter(r => r.productType === 'Engagement Ring');
  } else if (type === 'wedding' || type === 'band' || type === 'bands') {
    filtered = RING_CATALOG.filter(r => r.productType === 'Wedding Band');
  } else {
    filtered = RING_CATALOG.filter(r => 
      r.productType.toLowerCase().includes(type)
    );
  }
  
  res.json({
    type: req.params.type,
    total: filtered.length,
    styles: getStyleCounts(filtered[0]?.productType),
    rings: filtered
  });
});

// ============================================================================
// GET RINGS BY STYLE
// ============================================================================
app.get('/api/rings/style/:style', (req, res) => {
  const style = req.params.style;
  const filtered = RING_CATALOG.filter(r => 
    r.style.toLowerCase() === style.toLowerCase() ||
    r.style.toLowerCase().includes(style.toLowerCase())
  );
  
  res.json({
    style,
    total: filtered.length,
    rings: filtered
  });
});

// ============================================================================
// GET RINGS BY METAL
// ============================================================================
app.get('/api/rings/metal/:metal', (req, res) => {
  const metal = req.params.metal.toLowerCase();
  const filtered = RING_CATALOG.filter(r => 
    r.metal?.toLowerCase().includes(metal) ||
    r.metalCode?.toLowerCase().includes(metal)
  );
  
  res.json({
    metal: req.params.metal,
    total: filtered.length,
    rings: filtered
  });
});

// ============================================================================
// GET SINGLE RING BY ID
// ============================================================================
app.get('/api/ring/:id', (req, res) => {
  const ring = RING_CATALOG.find(r => r.id === req.params.id);
  
  if (!ring) {
    return res.status(404).json({ error: 'Ring not found' });
  }
  
  res.json(ring);
});

// ============================================================================
// GET RING BY SERIES
// ============================================================================
app.get('/api/rings/series/:series', (req, res) => {
  const filtered = RING_CATALOG.filter(r => r.series === req.params.series);
  
  res.json({
    series: req.params.series,
    total: filtered.length,
    rings: filtered
  });
});

// ============================================================================
// GET AVAILABLE STYLES
// ============================================================================
app.get('/api/styles', (req, res) => {
  const styleCounts = getStyleCounts();
  const styles = Object.entries(styleCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json({ styles });
});

// ============================================================================
// GET AVAILABLE METALS
// ============================================================================
app.get('/api/metals', (req, res) => {
  const metalCounts = {};
  RING_CATALOG.forEach(ring => {
    const metal = ring.metal || ring.metalCode || 'Unknown';
    metalCounts[metal] = (metalCounts[metal] || 0) + 1;
  });
  
  const metals = Object.entries(metalCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  
  res.json({ metals });
});

// ============================================================================
// AI RING ANALYSIS - Uses Claude to analyze uploaded ring image
// ============================================================================
app.post('/api/analyze-ring', async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    // Analyze with Claude
    const response = await anthropic.messages.create({
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
                media_type: 'image/jpeg',
                data: image
              }
            },
            {
              type: 'text',
              text: `Analyze this engagement ring image and identify its characteristics.

Return a JSON object with these fields:
{
  "style": "one of: Solitaire, Halo, Vintage Halo, Double Halo, Hidden Halo, Three Stone, Pavé, Sculptural",
  "shape": "center stone shape: Round, Oval, Princess, Cushion, Emerald, Pear, Marquise, Radiant, Asscher, or Unknown",
  "metal": "white gold, yellow gold, rose gold, platinum, or unknown",
  "features": ["array of notable features like: milgrain, filigree, split shank, cathedral, twisted band, etc."],
  "confidence": 0.0-1.0,
  "description": "brief description of the ring"
}

Respond ONLY with the JSON object, no other text.`
            }
          ]
        }
      ]
    });

    // Parse Claude's response
    let analysis;
    try {
      const content = response.content[0].text;
      // Remove markdown code blocks if present
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', response.content[0].text);
      analysis = {
        style: 'Unknown',
        shape: 'Unknown',
        metal: 'Unknown',
        features: [],
        confidence: 0,
        description: 'Unable to analyze ring'
      };
    }

    // Find matching rings from catalog
    const matches = findMatchingRings(analysis);

    res.json({
      analysis,
      matches,
      totalMatches: matches.length
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message 
    });
  }
});

// ============================================================================
// MATCHING ALGORITHM - Find similar rings from catalog
// ============================================================================
function findMatchingRings(analysis) {
  const { style, shape, metal, features } = analysis;
  
  // Determine if the analyzed ring is likely an engagement ring or wedding band
  const isEngagementRing = style && (
    style.toLowerCase().includes('solitaire') ||
    style.toLowerCase().includes('halo') ||
    style.toLowerCase().includes('three stone') ||
    style.toLowerCase().includes('engagement') ||
    style.toLowerCase().includes('pavé') ||
    style.toLowerCase().includes('pave')
  );
  
  // Filter to same product type first
  const candidateRings = isEngagementRing 
    ? RING_CATALOG.filter(r => r.productType === 'Engagement Ring')
    : RING_CATALOG;
  
  const scored = candidateRings.map(ring => {
    let score = 0;
    
    // Style match (60 points max)
    if (style && ring.style) {
      const analysisStyle = style.toLowerCase();
      const ringStyle = ring.style.toLowerCase();
      
      // Exact style match
      if (ringStyle === analysisStyle) {
        score += 60;
      } else if (analysisStyle.includes('solitaire') && ringStyle.includes('solitaire')) {
        score += 60;
      } else if (analysisStyle.includes('halo') && ringStyle.includes('halo')) {
        score += 50;
      } else if (analysisStyle.includes('three') && ringStyle.includes('three')) {
        score += 55;
      } else if (ringStyle.includes(analysisStyle) || analysisStyle.includes(ringStyle)) {
        score += 40;
      }
    }
    
    // Metal match (20 points max)
    if (metal && metal !== 'unknown') {
      const analysisMetal = metal.toLowerCase();
      const ringMetal = (ring.metal || ring.metalCode || '').toLowerCase();
      
      if (analysisMetal.includes('white') && (ringMetal.includes('white') || ringMetal.includes('w'))) {
        score += 20;
      } else if (analysisMetal.includes('yellow') && (ringMetal.includes('yellow') || ringMetal.includes('y'))) {
        score += 20;
      } else if (analysisMetal.includes('rose') && (ringMetal.includes('rose') || ringMetal.includes('r'))) {
        score += 20;
      } else if (analysisMetal.includes('platinum') && ringMetal.includes('plat')) {
        score += 20;
      }
    }
    
    // Shape match (10 points max)
    if (shape && shape !== 'Unknown') {
      const analysisShape = shape.toLowerCase();
      const ringShape = (ring.stoneShape || '').toLowerCase();
      const ringDesc = (ring.groupDescription || '').toLowerCase();
      
      if (ringShape.includes(analysisShape) || ringDesc.includes(analysisShape)) {
        score += 10;
      }
    }
    
    // Features match (10 points max)
    if (features && features.length > 0 && ring.groupDescription) {
      const desc = ring.groupDescription.toLowerCase();
      let featureScore = 0;
      features.forEach(feature => {
        if (desc.includes(feature.toLowerCase())) {
          featureScore += 3;
        }
      });
      score += Math.min(10, featureScore);
    }

    // Bonus for having good images
    if (ring.image && ring.image.includes('stullercloud')) {
      score += 3;
    }
    
    // Normalize score to percentage (max ~103 points -> 99%)
    const matchScore = Math.min(99, Math.round(score));
    
    return { ...ring, matchScore };
  });
  
  // Sort by score and return top matches
  return scored
    .filter(r => r.matchScore > 20)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 12);
}

// ============================================================================
// SEARCH RINGS
// ============================================================================
app.get('/api/search', (req, res) => {
  const { q, style, metal, minPrice, maxPrice } = req.query;
  
  let results = [...RING_CATALOG];
  
  // Text search
  if (q) {
    const query = q.toLowerCase();
    results = results.filter(r => 
      r.name?.toLowerCase().includes(query) ||
      r.shortDescription?.toLowerCase().includes(query) ||
      r.groupDescription?.toLowerCase().includes(query) ||
      r.style?.toLowerCase().includes(query)
    );
  }
  
  // Style filter
  if (style) {
    results = results.filter(r => 
      r.style?.toLowerCase() === style.toLowerCase()
    );
  }
  
  // Metal filter
  if (metal) {
    results = results.filter(r => 
      r.metal?.toLowerCase().includes(metal.toLowerCase()) ||
      r.metalCode?.toLowerCase().includes(metal.toLowerCase())
    );
  }
  
  // Price filters
  if (minPrice) {
    results = results.filter(r => r.price >= parseFloat(minPrice));
  }
  if (maxPrice) {
    results = results.filter(r => r.price <= parseFloat(maxPrice));
  }
  
  res.json({
    query: { q, style, metal, minPrice, maxPrice },
    total: results.length,
    rings: results
  });
});

// ============================================================================
// STATIC FILES (for ring-collection.html if hosted here)
// ============================================================================
app.use(express.static('public'));

// Serve the main app
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'ring-collection.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.json({
      message: 'Ring Builder API',
      version: '2.0',
      totalRings: RING_CATALOG.length,
      endpoints: [
        'GET /api/health',
        'GET /api/rings',
        'GET /api/rings/style/:style',
        'GET /api/rings/metal/:metal',
        'GET /api/rings/series/:series',
        'GET /api/ring/:id',
        'GET /api/styles',
        'GET /api/metals',
        'GET /api/search?q=&style=&metal=&minPrice=&maxPrice=',
        'POST /api/analyze-ring'
      ]
    });
  }
});

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log(`Ring Builder API running on port ${PORT}`);
  console.log(`Total rings in catalog: ${RING_CATALOG.length}`);
  console.log(`Styles: ${Object.keys(getStyleCounts()).join(', ')}`);
});
