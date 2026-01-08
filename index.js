const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// =============================================================================
// API CREDENTIALS (use environment variables in production)
// =============================================================================
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STULLER_USERNAME = process.env.STULLER_USERNAME || 'diamondsupplies1234';
const STULLER_PASSWORD = process.env.STULLER_PASSWORD || 'Letsgo2020@@';

// Basic auth header for Stuller
const STULLER_AUTH = 'Basic ' + Buffer.from(`${STULLER_USERNAME}:${STULLER_PASSWORD}`).toString('base64');

// =============================================================================
// IMAGE CACHE - Store fetched Stuller images to avoid repeated API calls
// =============================================================================
const imageCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// RING CATALOG - 79 Curated Stuller Settings
// =============================================================================
const RING_CATALOG = [
  // ===================== SOLITAIRE (32 rings) =====================
  { seriesId: '123823', style: 'Solitaire', name: 'Classic Cathedral Solitaire', metal: '14K White Gold', shapes: ['Round', 'Oval', 'Cushion'], features: ['Cathedral', '4-Prong', 'Comfort Fit'], priceRange: '$850 - $1,200' },
  { seriesId: '123213', style: 'Solitaire', name: 'Petite Knife Edge', metal: '14K White Gold', shapes: ['Round', 'Princess'], features: ['Knife Edge', '4-Prong', 'Low Profile'], priceRange: '$750 - $1,100' },
  { seriesId: '122089', style: 'Solitaire', name: 'Tapered Band Solitaire', metal: '14K Yellow Gold', shapes: ['Round', 'Oval'], features: ['Tapered Band', '6-Prong', 'Polished'], priceRange: '$800 - $1,150' },
  { seriesId: '122969', style: 'Solitaire', name: 'Modern Comfort Fit', metal: '14K Rose Gold', shapes: ['Round', 'Cushion', 'Oval'], features: ['Comfort Fit', '4-Prong', 'Modern'], priceRange: '$900 - $1,300' },
  { seriesId: '124171', style: 'Solitaire', name: 'Elegant Six Prong', metal: 'Platinum', shapes: ['Round'], features: ['6-Prong', 'Tiffany Style', 'Classic'], priceRange: '$1,200 - $1,800' },
  { seriesId: '140401', style: 'Solitaire', name: 'Tulip Head Solitaire', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Tulip Head', '4-Prong', 'Delicate'], priceRange: '$850 - $1,200' },
  { seriesId: '140309', style: 'Solitaire', name: 'Euro Shank Classic', metal: '14K Yellow Gold', shapes: ['Round', 'Princess', 'Cushion'], features: ['Euro Shank', '4-Prong', 'Sturdy'], priceRange: '$950 - $1,400' },
  { seriesId: '126764', style: 'Solitaire', name: 'Bypass Solitaire', metal: '14K Rose Gold', shapes: ['Round', 'Oval', 'Pear'], features: ['Bypass Design', '4-Prong', 'Unique'], priceRange: '$1,000 - $1,500' },
  { seriesId: '124305', style: 'Solitaire', name: 'Minimalist Band', metal: '14K White Gold', shapes: ['Round', 'Emerald', 'Asscher'], features: ['Thin Band', '4-Prong', 'Minimalist'], priceRange: '$700 - $1,000' },
  { seriesId: '123713', style: 'Solitaire', name: 'Wide Band Solitaire', metal: 'Platinum', shapes: ['Round', 'Cushion'], features: ['Wide Band', '4-Prong', 'Statement'], priceRange: '$1,300 - $1,900' },
  { seriesId: '122939', style: 'Solitaire', name: 'Floating Solitaire', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Floating Setting', '4-Prong', 'Airy'], priceRange: '$850 - $1,250' },
  { seriesId: '126617', style: 'Solitaire', name: 'Split Prong Classic', metal: '14K Yellow Gold', shapes: ['Round', 'Princess'], features: ['Split Prong', 'Secure', 'Traditional'], priceRange: '$800 - $1,150' },
  { seriesId: '122099', style: 'Solitaire', name: 'Basket Setting', metal: '14K Rose Gold', shapes: ['Round', 'Oval', 'Cushion'], features: ['Basket Setting', '4-Prong', 'Open Gallery'], priceRange: '$750 - $1,100' },
  { seriesId: '126306', style: 'Solitaire', name: 'Vintage Inspired', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Milgrain', 'Vintage', '4-Prong'], priceRange: '$950 - $1,400' },
  { seriesId: '124348', style: 'Solitaire', name: 'Compass Point Setting', metal: 'Platinum', shapes: ['Princess', 'Asscher'], features: ['Compass Prongs', '4-Prong', 'Geometric'], priceRange: '$1,100 - $1,600' },
  { seriesId: '150508', style: 'Solitaire', name: 'Peg Head Solitaire', metal: '14K Yellow Gold', shapes: ['Round'], features: ['Peg Head', '4-Prong', 'Classic'], priceRange: '$700 - $1,000' },
  { seriesId: '124852', style: 'Solitaire', name: 'Crown Setting', metal: '14K White Gold', shapes: ['Round', 'Oval', 'Cushion'], features: ['Crown Setting', '6-Prong', 'Regal'], priceRange: '$900 - $1,300' },
  { seriesId: '140406', style: 'Solitaire', name: 'Bezel Accent Solitaire', metal: '14K Rose Gold', shapes: ['Round'], features: ['Bezel Accents', '4-Prong', 'Secure'], priceRange: '$950 - $1,400' },
  { seriesId: '124702', style: 'Solitaire', name: 'Twisted Band Solitaire', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Twisted Band', '4-Prong', 'Romantic'], priceRange: '$850 - $1,250' },
  { seriesId: '123054', style: 'Solitaire', name: 'Channel Set Band', metal: 'Platinum', shapes: ['Round', 'Princess'], features: ['Channel Shoulders', '4-Prong', 'Accent Diamonds'], priceRange: '$1,400 - $2,000' },
  { seriesId: '150309', style: 'Solitaire', name: 'Scroll Design', metal: '14K Yellow Gold', shapes: ['Round', 'Oval'], features: ['Scroll Gallery', 'Vintage', '4-Prong'], priceRange: '$900 - $1,300' },
  { seriesId: '122047', style: 'Solitaire', name: 'Filigree Solitaire', metal: '14K White Gold', shapes: ['Round', 'Cushion'], features: ['Filigree', 'Vintage', 'Ornate'], priceRange: '$1,000 - $1,500' },
  { seriesId: '126320', style: 'Solitaire', name: 'Plain Jane Classic', metal: '14K Rose Gold', shapes: ['Round', 'Oval', 'Pear'], features: ['Plain Band', 'Simple', '4-Prong'], priceRange: '$650 - $950' },
  { seriesId: '170401', style: 'Solitaire', name: 'High Polish Round', metal: '14K White Gold', shapes: ['Round'], features: ['High Polish', '4-Prong', 'Reflective'], priceRange: '$750 - $1,100' },
  { seriesId: '122705', style: 'Solitaire', name: 'Engraved Band', metal: '14K Yellow Gold', shapes: ['Round', 'Oval'], features: ['Hand Engraved', 'Vintage', '4-Prong'], priceRange: '$1,100 - $1,600' },
  { seriesId: '124170', style: 'Solitaire', name: 'Petite Four Prong', metal: 'Platinum', shapes: ['Round', 'Princess'], features: ['Petite', '4-Prong', 'Delicate'], priceRange: '$1,000 - $1,500' },
  { seriesId: '170309', style: 'Solitaire', name: 'Satin Finish', metal: '14K White Gold', shapes: ['Round', 'Cushion'], features: ['Satin Finish', '4-Prong', 'Matte'], priceRange: '$800 - $1,200' },
  { seriesId: '122118', style: 'Solitaire', name: 'Claw Prong Setting', metal: '14K Rose Gold', shapes: ['Round', 'Oval'], features: ['Claw Prongs', 'Secure', 'Modern'], priceRange: '$850 - $1,250' },
  { seriesId: '123226', style: 'Solitaire', name: 'Raised Gallery', metal: '14K Yellow Gold', shapes: ['Round', 'Pear'], features: ['Raised Gallery', '6-Prong', 'Elevated'], priceRange: '$900 - $1,350' },
  { seriesId: '140408', style: 'Solitaire', name: 'Flat Edge Band', metal: '14K White Gold', shapes: ['Princess', 'Emerald', 'Asscher'], features: ['Flat Edge', '4-Prong', 'Contemporary'], priceRange: '$800 - $1,150' },
  { seriesId: '124797', style: 'Solitaire', name: 'Round Wire Band', metal: 'Platinum', shapes: ['Round', 'Oval'], features: ['Round Wire', '4-Prong', 'Classic'], priceRange: '$1,100 - $1,650' },
  { seriesId: '124047', style: 'Solitaire', name: 'Half Round Band', metal: '14K Rose Gold', shapes: ['Round', 'Cushion', 'Oval'], features: ['Half Round', 'Comfort', '4-Prong'], priceRange: '$750 - $1,100' },

  // ===================== HALO (18 rings) =====================
  { seriesId: '122804', style: 'Halo', name: 'Classic Round Halo', metal: '14K White Gold', shapes: ['Round'], features: ['Full Halo', 'Pavé Band', 'Brilliant'], priceRange: '$1,200 - $1,800' },
  { seriesId: '123243', style: 'Halo', name: 'Cushion Halo', metal: '14K Rose Gold', shapes: ['Cushion', 'Round'], features: ['Cushion Halo', 'Split Shank', 'Vintage'], priceRange: '$1,400 - $2,100' },
  { seriesId: '122060', style: 'Halo', name: 'Oval Halo Elegance', metal: '14K White Gold', shapes: ['Oval'], features: ['Oval Halo', 'Pavé Band', 'Elongating'], priceRange: '$1,350 - $2,000' },
  { seriesId: '123227', style: 'Halo', name: 'French Pavé Halo', metal: 'Platinum', shapes: ['Round', 'Cushion'], features: ['French Pavé', 'Full Halo', 'Elegant'], priceRange: '$1,800 - $2,600' },
  { seriesId: '123333', style: 'Halo', name: 'Double Halo', metal: '14K White Gold', shapes: ['Round', 'Cushion'], features: ['Double Halo', 'Maximum Sparkle', 'Statement'], priceRange: '$1,600 - $2,400' },
  { seriesId: '123767', style: 'Halo', name: 'Pear Halo', metal: '14K Rose Gold', shapes: ['Pear'], features: ['Pear Halo', 'Pavé Band', 'Romantic'], priceRange: '$1,400 - $2,100' },
  { seriesId: '122870', style: 'Halo', name: 'Princess Halo', metal: '14K Yellow Gold', shapes: ['Princess'], features: ['Square Halo', 'Geometric', 'Modern'], priceRange: '$1,300 - $1,950' },
  { seriesId: '123449', style: 'Halo', name: 'Marquise Halo', metal: '14K White Gold', shapes: ['Marquise'], features: ['Marquise Halo', 'Elongating', 'Unique'], priceRange: '$1,350 - $2,000' },
  { seriesId: '123267', style: 'Halo', name: 'Vintage Halo', metal: '14K Rose Gold', shapes: ['Round', 'Oval'], features: ['Milgrain Halo', 'Vintage', 'Art Deco'], priceRange: '$1,500 - $2,200' },
  { seriesId: '124241', style: 'Halo', name: 'Twisted Halo', metal: '14K White Gold', shapes: ['Round', 'Cushion'], features: ['Twisted Band', 'Halo', 'Romantic'], priceRange: '$1,400 - $2,100' },
  { seriesId: '124470', style: 'Halo', name: 'Emerald Halo', metal: 'Platinum', shapes: ['Emerald', 'Radiant'], features: ['Rectangular Halo', 'Step Cut', 'Sophisticated'], priceRange: '$1,700 - $2,500' },
  { seriesId: '122892', style: 'Halo', name: 'Delicate Halo', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Thin Halo', 'Delicate', 'Petite'], priceRange: '$1,100 - $1,650' },
  { seriesId: '123861', style: 'Halo', name: 'Bold Halo', metal: '14K Yellow Gold', shapes: ['Round', 'Cushion'], features: ['Wide Halo', 'Statement', 'Glamorous'], priceRange: '$1,600 - $2,400' },
  { seriesId: '124435', style: 'Halo', name: 'Floral Halo', metal: '14K Rose Gold', shapes: ['Round'], features: ['Floral Design', 'Halo', 'Feminine'], priceRange: '$1,450 - $2,150' },
  { seriesId: '123770', style: 'Halo', name: 'Cathedral Halo', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Cathedral', 'Halo', 'Elevated'], priceRange: '$1,350 - $2,000' },
  { seriesId: '123541', style: 'Halo', name: 'Split Shank Halo', metal: 'Platinum', shapes: ['Round', 'Cushion', 'Oval'], features: ['Split Shank', 'Halo', 'Dramatic'], priceRange: '$1,900 - $2,800' },
  { seriesId: '123336', style: 'Halo', name: 'Scalloped Halo', metal: '14K White Gold', shapes: ['Round'], features: ['Scalloped', 'Halo', 'Detailed'], priceRange: '$1,400 - $2,100' },
  { seriesId: '121981', style: 'Halo', name: 'Asscher Halo', metal: '14K Rose Gold', shapes: ['Asscher'], features: ['Art Deco', 'Square Halo', 'Vintage'], priceRange: '$1,500 - $2,250' },

  // ===================== HIDDEN HALO (6 rings) =====================
  { seriesId: '127024', style: 'Hidden Halo', name: 'Classic Hidden Halo', metal: '14K White Gold', shapes: ['Round', 'Oval', 'Cushion'], features: ['Hidden Halo', 'Surprise Sparkle', 'Modern'], priceRange: '$1,100 - $1,650' },
  { seriesId: '127098', style: 'Hidden Halo', name: 'Oval Hidden Halo', metal: '14K Rose Gold', shapes: ['Oval'], features: ['Hidden Halo', 'Elongating', 'Elegant'], priceRange: '$1,200 - $1,800' },
  { seriesId: '123599', style: 'Hidden Halo', name: 'Cushion Hidden Halo', metal: 'Platinum', shapes: ['Cushion', 'Round'], features: ['Hidden Halo', 'Pillow Cut', 'Romantic'], priceRange: '$1,500 - $2,200' },
  { seriesId: '126924', style: 'Hidden Halo', name: 'Pear Hidden Halo', metal: '14K White Gold', shapes: ['Pear', 'Oval'], features: ['Hidden Halo', 'Teardrop', 'Unique'], priceRange: '$1,250 - $1,850' },
  { seriesId: '126214', style: 'Hidden Halo', name: 'Princess Hidden Halo', metal: '14K Yellow Gold', shapes: ['Princess'], features: ['Hidden Halo', 'Square', 'Contemporary'], priceRange: '$1,150 - $1,700' },
  { seriesId: '127198', style: 'Hidden Halo', name: 'Cathedral Hidden Halo', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Cathedral', 'Hidden Halo', 'Elevated'], priceRange: '$1,300 - $1,950' },

  // ===================== THREE STONE (23 rings) =====================
  { seriesId: '122105', style: 'Three Stone', name: 'Classic Trilogy', metal: '14K White Gold', shapes: ['Round'], features: ['Three Stone', 'Past Present Future', 'Timeless'], priceRange: '$1,500 - $2,200' },
  { seriesId: '122924', style: 'Three Stone', name: 'Oval Trilogy', metal: '14K Rose Gold', shapes: ['Oval'], features: ['Three Stone', 'Elongating', 'Elegant'], priceRange: '$1,600 - $2,400' },
  { seriesId: '123886', style: 'Three Stone', name: 'Princess Trilogy', metal: '14K White Gold', shapes: ['Princess'], features: ['Three Stone', 'Geometric', 'Modern'], priceRange: '$1,550 - $2,300' },
  { seriesId: '121986', style: 'Three Stone', name: 'Pear Side Stones', metal: 'Platinum', shapes: ['Round', 'Oval'], features: ['Pear Sides', 'Three Stone', 'Unique'], priceRange: '$2,000 - $3,000' },
  { seriesId: '69706', style: 'Three Stone', name: 'Tapered Baguettes', metal: '14K White Gold', shapes: ['Round', 'Oval', 'Cushion'], features: ['Baguette Sides', 'Art Deco', 'Sophisticated'], priceRange: '$1,700 - $2,500' },
  { seriesId: '126923', style: 'Three Stone', name: 'Trillion Accents', metal: '14K Yellow Gold', shapes: ['Round', 'Cushion'], features: ['Trillion Sides', 'Geometric', 'Bold'], priceRange: '$1,600 - $2,400' },
  { seriesId: '124694', style: 'Three Stone', name: 'Half Moon Sides', metal: '14K White Gold', shapes: ['Emerald', 'Radiant'], features: ['Half Moon Sides', 'Step Cut', 'Art Deco'], priceRange: '$1,800 - $2,700' },
  { seriesId: '126029', style: 'Three Stone', name: 'Graduated Trilogy', metal: '14K Rose Gold', shapes: ['Round', 'Oval'], features: ['Graduated Sizes', 'Three Stone', 'Classic'], priceRange: '$1,550 - $2,300' },
  { seriesId: '120234', style: 'Three Stone', name: 'Shared Prong Trilogy', metal: 'Platinum', shapes: ['Round'], features: ['Shared Prong', 'Seamless', 'Brilliant'], priceRange: '$2,100 - $3,100' },
  { seriesId: '124742', style: 'Three Stone', name: 'Basket Trilogy', metal: '14K White Gold', shapes: ['Round', 'Cushion'], features: ['Basket Setting', 'Open Gallery', 'Airy'], priceRange: '$1,450 - $2,150' },
  { seriesId: '123960', style: 'Three Stone', name: 'Vintage Trilogy', metal: '14K Rose Gold', shapes: ['Round', 'Oval'], features: ['Milgrain', 'Vintage', 'Romantic'], priceRange: '$1,700 - $2,500' },
  { seriesId: '122119', style: 'Three Stone', name: 'Channel Set Trilogy', metal: '14K Yellow Gold', shapes: ['Princess'], features: ['Channel Set', 'Protected', 'Modern'], priceRange: '$1,600 - $2,400' },
  { seriesId: '122104', style: 'Three Stone', name: 'Bezel Trilogy', metal: '14K White Gold', shapes: ['Round'], features: ['Bezel Set', 'Secure', 'Contemporary'], priceRange: '$1,550 - $2,300' },
  { seriesId: '123281', style: 'Three Stone', name: 'Emerald Trilogy', metal: 'Platinum', shapes: ['Emerald', 'Asscher'], features: ['Step Cut', 'Art Deco', 'Sophisticated'], priceRange: '$2,200 - $3,300' },
  { seriesId: '122977', style: 'Three Stone', name: 'Twisted Trilogy', metal: '14K Rose Gold', shapes: ['Round', 'Oval'], features: ['Twisted Band', 'Three Stone', 'Romantic'], priceRange: '$1,650 - $2,450' },
  { seriesId: '122476', style: 'Three Stone', name: 'Cathedral Trilogy', metal: '14K White Gold', shapes: ['Round', 'Cushion'], features: ['Cathedral', 'Three Stone', 'Elevated'], priceRange: '$1,600 - $2,400' },
  { seriesId: '122000', style: 'Three Stone', name: 'Petite Trilogy', metal: '14K Yellow Gold', shapes: ['Round', 'Oval'], features: ['Petite', 'Delicate', 'Understated'], priceRange: '$1,300 - $1,950' },
  { seriesId: '126720', style: 'Three Stone', name: 'Bold Trilogy', metal: 'Platinum', shapes: ['Cushion', 'Round'], features: ['Large Side Stones', 'Statement', 'Glamorous'], priceRange: '$2,400 - $3,600' },
  { seriesId: '126342', style: 'Three Stone', name: 'Marquise Sides', metal: '14K White Gold', shapes: ['Round', 'Oval'], features: ['Marquise Sides', 'Elongating', 'Unique'], priceRange: '$1,700 - $2,500' },
  { seriesId: '127228', style: 'Three Stone', name: 'Kite Set Trilogy', metal: '14K Rose Gold', shapes: ['Princess'], features: ['Kite Set', 'Geometric', 'Modern'], priceRange: '$1,550 - $2,300' },
  { seriesId: '122102', style: 'Three Stone', name: 'Filigree Trilogy', metal: '14K White Gold', shapes: ['Round'], features: ['Filigree', 'Vintage', 'Ornate'], priceRange: '$1,800 - $2,700' },
  { seriesId: '123689', style: 'Three Stone', name: 'Euro Shank Trilogy', metal: '14K Yellow Gold', shapes: ['Round', 'Oval', 'Cushion'], features: ['Euro Shank', 'Sturdy', 'Classic'], priceRange: '$1,650 - $2,450' },
  { seriesId: '126223', style: 'Three Stone', name: 'Halo Trilogy', metal: 'Platinum', shapes: ['Round', 'Cushion'], features: ['Halo Accents', 'Three Stone', 'Maximum Sparkle'], priceRange: '$2,500 - $3,800' }
];

// =============================================================================
// STULLER API FUNCTIONS
// =============================================================================

/**
 * Fetch product data from Stuller API by Series ID
 */
function fetchStullerProduct(seriesId) {
  return new Promise((resolve, reject) => {
    // Check cache first
    const cached = imageCache.get(seriesId);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
      return resolve(cached.data);
    }

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
        'Authorization': STULLER_AUTH,
        'Content-Length': Buffer.byteLength(searchBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          
          // Extract image URL from response
          let imageUrl = null;
          let productData = null;
          
          if (parsed.Products && parsed.Products.length > 0) {
            productData = parsed.Products[0];
            
            // Try different image fields Stuller might use
            if (productData.PrimaryImage) {
              imageUrl = productData.PrimaryImage;
            } else if (productData.ImageUrl) {
              imageUrl = productData.ImageUrl;
            } else if (productData.Images && productData.Images.length > 0) {
              imageUrl = productData.Images[0].Url || productData.Images[0];
            } else if (productData.Assets && productData.Assets.length > 0) {
              const imageAsset = productData.Assets.find(a => 
                a.Type === 'Image' || a.AssetType === 'Image' || a.Url?.includes('.jpg') || a.Url?.includes('.png')
              );
              if (imageAsset) {
                imageUrl = imageAsset.Url || imageAsset.Uri;
              }
            }
            
            // Stuller cloud fallback pattern
            if (!imageUrl && productData.ItemNumber) {
              imageUrl = `https://quodiuswpplxfhbqcdud.stullercloud.com/das/73702355?$?"?"itemNumber=%27${productData.ItemNumber}%27"&fmt=webp&wid=400&hei=400`;
            }
          }
          
          // Cache the result
          const result = {
            imageUrl: imageUrl,
            product: productData,
            seriesId: seriesId
          };
          
          imageCache.set(seriesId, {
            data: result,
            timestamp: Date.now()
          });
          
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Stuller API timeout')); });
    req.write(searchBody);
    req.end();
  });
}

/**
 * Fetch images for multiple series IDs (batch)
 */
async function fetchStullerImages(seriesIds) {
  const results = {};
  
  // Process in parallel with limit
  const batchSize = 5;
  for (let i = 0; i < seriesIds.length; i += batchSize) {
    const batch = seriesIds.slice(i, i + batchSize);
    const promises = batch.map(async (seriesId) => {
      try {
        const data = await fetchStullerProduct(seriesId);
        results[seriesId] = data.imageUrl;
      } catch (error) {
        console.error(`Failed to fetch image for series ${seriesId}:`, error.message);
        results[seriesId] = null;
      }
    });
    await Promise.all(promises);
  }
  
  return results;
}

/**
 * Build image URL - tries Stuller CDN patterns
 */
function buildImageUrl(seriesId, size = 400) {
  // Primary Stuller cloud URL pattern
  return `https://quodiuswpplxfhbqcdud.stullercloud.com/das/73702355?$?"seriesid=%27${seriesId}%27"&fmt=webp&wid=${size}&hei=${size}`;
}

/**
 * Alternative image URL pattern
 */
function buildAltImageUrl(seriesId, size = 400) {
  return `https://quodiuswpplxfhbqcdud.stullercloud.com/das/118717213?$?"seriesid=%27${seriesId}%27%20itemsperpage%3D%271%27"&fmt=webp&wid=${size}&hei=${size}`;
}

// =============================================================================
// AI ANALYSIS - ANTHROPIC API
// =============================================================================

const STYLE_DESCRIPTIONS = {
  'Solitaire': 'A single center stone with no additional accent stones on the setting. Clean, classic, minimalist design. The band may be plain or have subtle details but the focus is entirely on one diamond.',
  'Halo': 'Center stone VISIBLY surrounded by a "halo" ring of smaller diamonds that encircle the main stone. The halo is clearly visible from the top view.',
  'Hidden Halo': 'Looks like a solitaire from above, but has small diamonds hidden UNDERNEATH the center stone basket, only visible from the side profile. The top view shows no halo.',
  'Three Stone': 'Three distinct stones in a row - a larger center stone flanked by two smaller side stones. The side stones are substantial, not just small accents.'
};

async function analyzeRingImage(base64Image, mediaType) {
  return new Promise((resolve, reject) => {
    const catalogSummary = RING_CATALOG.map(ring => 
      `ID:${ring.seriesId} | ${ring.style} | ${ring.name} | ${ring.metal} | Shapes: ${ring.shapes.join(', ')} | Features: ${ring.features.join(', ')}`
    ).join('\n');

    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image }
          },
          {
            type: 'text',
            text: `You are an expert jeweler for Gabriella Amoura, a luxury engagement ring retailer. Analyze this ring image carefully.

**STYLE DEFINITIONS** (choose ONE):
- Solitaire: ${STYLE_DESCRIPTIONS['Solitaire']}
- Halo: ${STYLE_DESCRIPTIONS['Halo']}
- Hidden Halo: ${STYLE_DESCRIPTIONS['Hidden Halo']}
- Three Stone: ${STYLE_DESCRIPTIONS['Three Stone']}

**DIAMOND SHAPES**: Round, Oval, Princess (square), Cushion (rounded square), Emerald (rectangular step-cut), Pear (teardrop), Marquise (pointed oval), Radiant (rectangular brilliant), Asscher (square step-cut)

**METALS**: White Gold (silver color), Yellow Gold (warm gold), Rose Gold (pink gold), Platinum (bright silver)

**OUR CATALOG** (79 rings):
${catalogSummary}

Analyze the ring and respond with ONLY this JSON:
{
  "style": "Solitaire|Halo|Hidden Halo|Three Stone",
  "shape": "Round|Oval|Princess|Cushion|Emerald|Pear|Marquise|Radiant|Asscher",
  "metal": "White Gold|Yellow Gold|Rose Gold|Platinum",
  "confidence": "high|medium|low",
  "description": "2-3 sentence description of the ring's key design elements",
  "detectedFeatures": ["feature1", "feature2", "feature3"],
  "recommendedSeriesIds": ["id1", "id2", "id3", "id4", "id5"]
}

For recommendedSeriesIds, select the 5 BEST matching rings from our catalog based on:
1. MUST match the detected style
2. SHOULD be compatible with the detected shape
3. BONUS if features match (prong style, band type, etc.)

If not a ring or image unclear, use "Unknown" for fields you can't determine.`
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
              reject(new Error('Could not parse AI response'));
            }
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(requestBody);
    req.end();
  });
}

// =============================================================================
// MATCHING ALGORITHM
// =============================================================================

function findMatchingRings(analysis, limit = 12) {
  let matches = [];
  
  // If AI provided specific recommendations, prioritize those
  if (analysis.recommendedSeriesIds && analysis.recommendedSeriesIds.length > 0) {
    analysis.recommendedSeriesIds.forEach(id => {
      const ring = RING_CATALOG.find(r => r.seriesId === id);
      if (ring) {
        matches.push({
          ...ring,
          matchScore: 95,
          matchReason: 'AI Recommended'
        });
      }
    });
  }

  // Score remaining rings
  const scoredRings = RING_CATALOG
    .filter(ring => !matches.find(m => m.seriesId === ring.seriesId))
    .map(ring => {
      let score = 0;
      let reasons = [];

      // Style match (50 points)
      if (analysis.style && ring.style.toLowerCase() === analysis.style.toLowerCase()) {
        score += 50;
        reasons.push('Style Match');
      }

      // Shape compatibility (30 points)
      if (analysis.shape && ring.shapes.some(s => s.toLowerCase() === analysis.shape.toLowerCase())) {
        score += 30;
        reasons.push('Shape Compatible');
      }

      // Metal match (15 points)
      if (analysis.metal) {
        const metalLower = analysis.metal.toLowerCase();
        const ringMetalLower = ring.metal.toLowerCase();
        if (ringMetalLower.includes(metalLower.split(' ')[0]) || 
            (metalLower.includes('white') && ringMetalLower.includes('white')) ||
            (metalLower.includes('yellow') && ringMetalLower.includes('yellow')) ||
            (metalLower.includes('rose') && ringMetalLower.includes('rose')) ||
            (metalLower.includes('platinum') && ringMetalLower.includes('platinum'))) {
          score += 15;
          reasons.push('Metal Match');
        }
      }

      // Feature matches (5 points each, max 15)
      if (analysis.detectedFeatures && analysis.detectedFeatures.length > 0) {
        let featureMatches = 0;
        analysis.detectedFeatures.forEach(feature => {
          if (ring.features.some(f => 
            f.toLowerCase().includes(feature.toLowerCase()) || 
            feature.toLowerCase().includes(f.toLowerCase())
          )) {
            featureMatches++;
          }
        });
        const featureScore = Math.min(featureMatches * 5, 15);
        if (featureScore > 0) {
          score += featureScore;
          reasons.push(`${featureMatches} Feature Match${featureMatches > 1 ? 'es' : ''}`);
        }
      }

      return {
        ...ring,
        matchScore: score,
        matchReason: reasons.join(', ') || 'Catalog Item'
      };
    })
    .filter(ring => ring.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore);

  matches = [...matches, ...scoredRings];

  // Fallback if no matches
  if (matches.length === 0) {
    const styleMatches = RING_CATALOG.filter(r => 
      analysis.style && r.style.toLowerCase() === analysis.style.toLowerCase()
    );
    
    if (styleMatches.length > 0) {
      matches = styleMatches.slice(0, limit).map(ring => ({
        ...ring,
        matchScore: 50,
        matchReason: 'Style Match'
      }));
    } else {
      matches = RING_CATALOG.slice(0, limit).map(ring => ({
        ...ring,
        matchScore: 25,
        matchReason: 'Catalog Item'
      }));
    }
  }

  // Add image URLs
  return matches.slice(0, limit).map(ring => ({
    ...ring,
    imageUrl: buildImageUrl(ring.seriesId),
    imageUrlFallback: buildAltImageUrl(ring.seriesId)
  }));
}

// =============================================================================
// API ROUTES
// =============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasAnthropicKey: !!ANTHROPIC_API_KEY,
    hasStullerCredentials: !!(STULLER_USERNAME && STULLER_PASSWORD),
    totalRings: RING_CATALOG.length,
    cacheSize: imageCache.size,
    styles: {
      Solitaire: RING_CATALOG.filter(r => r.style === 'Solitaire').length,
      Halo: RING_CATALOG.filter(r => r.style === 'Halo').length,
      'Hidden Halo': RING_CATALOG.filter(r => r.style === 'Hidden Halo').length,
      'Three Stone': RING_CATALOG.filter(r => r.style === 'Three Stone').length
    }
  });
});

// Get all rings with images
app.get('/api/rings', async (req, res) => {
  const rings = RING_CATALOG.map(ring => ({
    ...ring,
    imageUrl: buildImageUrl(ring.seriesId),
    imageUrlFallback: buildAltImageUrl(ring.seriesId)
  }));
  res.json({ rings, total: rings.length });
});

// Get rings by style
app.get('/api/rings/style/:style', (req, res) => {
  const style = req.params.style;
  const rings = RING_CATALOG
    .filter(r => r.style.toLowerCase() === style.toLowerCase())
    .map(ring => ({
      ...ring,
      imageUrl: buildImageUrl(ring.seriesId),
      imageUrlFallback: buildAltImageUrl(ring.seriesId)
    }));
  res.json({ rings, total: rings.length });
});

// Get rings by shape
app.get('/api/rings/shape/:shape', (req, res) => {
  const shape = req.params.shape;
  const rings = RING_CATALOG
    .filter(r => r.shapes.some(s => s.toLowerCase() === shape.toLowerCase()))
    .map(ring => ({
      ...ring,
      imageUrl: buildImageUrl(ring.seriesId),
      imageUrlFallback: buildAltImageUrl(ring.seriesId)
    }));
  res.json({ rings, total: rings.length });
});

// Get single ring with Stuller API data
app.get('/api/ring/:seriesId', async (req, res) => {
  const ring = RING_CATALOG.find(r => r.seriesId === req.params.seriesId);
  if (!ring) {
    return res.status(404).json({ error: 'Ring not found' });
  }

  try {
    // Try to fetch real Stuller data
    const stullerData = await fetchStullerProduct(ring.seriesId);
    res.json({
      ...ring,
      imageUrl: stullerData.imageUrl || buildImageUrl(ring.seriesId),
      imageUrlFallback: buildAltImageUrl(ring.seriesId),
      stullerProduct: stullerData.product
    });
  } catch (error) {
    // Fallback to CDN URL
    res.json({
      ...ring,
      imageUrl: buildImageUrl(ring.seriesId),
      imageUrlFallback: buildAltImageUrl(ring.seriesId)
    });
  }
});

// Debug endpoint - fetch raw Stuller data
app.get('/api/debug/stuller/:seriesId', async (req, res) => {
  try {
    const data = await fetchStullerProduct(req.params.seriesId);
    res.json({
      seriesId: req.params.seriesId,
      ...data,
      cdnUrl: buildImageUrl(req.params.seriesId),
      altCdnUrl: buildAltImageUrl(req.params.seriesId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Preload images for all rings (call on startup or periodically)
app.post('/api/preload-images', async (req, res) => {
  const seriesIds = RING_CATALOG.map(r => r.seriesId);
  
  try {
    const images = await fetchStullerImages(seriesIds);
    const successful = Object.values(images).filter(url => url !== null).length;
    res.json({ 
      success: true, 
      total: seriesIds.length,
      cached: successful,
      failed: seriesIds.length - successful
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Main AI analysis endpoint
app.post('/api/analyze-ring', async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }
    
    // Extract base64 data
    let base64Data = image;
    if (image.includes('base64,')) {
      base64Data = image.split('base64,')[1];
    }
    
    // Detect media type
    let mediaType = 'image/jpeg';
    if (image.includes('data:image/png')) mediaType = 'image/png';
    else if (image.includes('data:image/webp')) mediaType = 'image/webp';
    else if (image.includes('data:image/gif')) mediaType = 'image/gif';
    
    // Analyze with AI
    const analysis = await analyzeRingImage(base64Data, mediaType);
    
    // Find matching rings
    const matchingRings = findMatchingRings(analysis);
    
    res.json({
      success: true,
      analysis: {
        style: analysis.style,
        shape: analysis.shape,
        metal: analysis.metal,
        confidence: analysis.confidence,
        description: analysis.description,
        detectedFeatures: analysis.detectedFeatures || []
      },
      matchingRings,
      totalMatches: matchingRings.length
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to analyze ring',
      success: false 
    });
  }
});

// =============================================================================
// START SERVER
// =============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Ring Builder API running on port ${PORT}`);
  console.log(`📦 Loaded ${RING_CATALOG.length} rings`);
  console.log(`   ├─ Solitaire: ${RING_CATALOG.filter(r => r.style === 'Solitaire').length}`);
  console.log(`   ├─ Halo: ${RING_CATALOG.filter(r => r.style === 'Halo').length}`);
  console.log(`   ├─ Hidden Halo: ${RING_CATALOG.filter(r => r.style === 'Hidden Halo').length}`);
  console.log(`   └─ Three Stone: ${RING_CATALOG.filter(r => r.style === 'Three Stone').length}`);
  console.log(`\n🔑 API Keys:`);
  console.log(`   ├─ Anthropic: ${ANTHROPIC_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  console.log(`   └─ Stuller: ${STULLER_USERNAME ? '✓ Configured' : '✗ Missing'}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   ├─ GET  /api/health`);
  console.log(`   ├─ GET  /api/rings`);
  console.log(`   ├─ GET  /api/rings/style/:style`);
  console.log(`   ├─ GET  /api/rings/shape/:shape`);
  console.log(`   ├─ GET  /api/ring/:seriesId`);
  console.log(`   ├─ POST /api/analyze-ring`);
  console.log(`   ├─ POST /api/preload-images`);
  console.log(`   └─ GET  /api/debug/stuller/:seriesId\n`);
});
