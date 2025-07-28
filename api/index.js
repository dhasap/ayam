const axios = require('axios');
const cheerio = require('cheerio');

// Cache sederhana untuk Vercel Free (in-memory)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit untuk free tier

// Axios configuration optimized for Vercel
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Referer': 'https://komikcast.li/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  },
  timeout: 8000, // Reduced for Vercel Free
  maxRedirects: 3
};

const KOMIKCAST_URL = 'https://komikcast.li';

// Simple cache functions
const getCached = (key) => {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) {
    return item.data;
  }
  cache.delete(key);
  return null;
};

const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
  return data;
};

// Error handler optimized for Vercel
const handleError = (error, res, operation) => {
  console.error(\`Error in ${operation}:\`, error.message);
  
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      message: 'Layanan komikcast tidak tersedia saat ini.',
      error: 'Service Unavailable',
      suggestion: 'Coba lagi dalam beberapa menit'
    });
  }
  
  if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
    return res.status(408).json({
      success: false,
      message: 'Request timeout. Server membutuhkan waktu terlalu lama.',
      error: 'Timeout',
      suggestion: 'Coba lagi dengan limit yang lebih kecil'
    });
  }
  
  return res.status(500).json({
    success: false,
    message: \`Gagal ${operation}\`,
    error: 'Internal Error',
    suggestion: 'Coba lagi atau gunakan endpoint lain'
  });
};

// URL parser yang lebih robust
const parseURL = (req) => {
  try {
    const url = new URL(req.url, \`https://${req.headers.host}\`);
    return {
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams)
    };
  } catch (error) {
    // Fallback parsing
    const parts = req.url.split('?');
    const pathname = parts[0];
    const query = {};
    
    if (parts[1]) {
      parts [key, value] = param.split('=');
        if (key && value) {
          query[decodeURIComponent(key)] = decodeURIComponent(value);
        }
      });
    }
    
    return { pathname, query };
  }
};

// Main handler function
module.exports = async (req, res) => {
  // CORS headers for mobile browsers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { pathname, query } = parseURL(req);
  
  try {
    // Route: API Documentation
    if (pathname === '/api' || pathname === '/api/') {
      return res.json({
        success: true,
        message: 'Komikcast Scraper API v2.0 - Mobile Optimized',
        endpoints: {
          '/api/latest': 'Daftar komik terbaru (query: page, limit)',
          '/api/detail/[endpoint]': 'Detail komik dan chapter',
          '/api/chapter/[endpoint]': 'Gambar chapter',
          '/api/search': 'Pencarian (query: q, page)',
          '/api/genres': 'Daftar genre',
          '/api/genre/[slug]': 'Komik by genre',
          '/api/health': 'Status API'
        },
        mobile: {
          optimized: true,
          cacheTime: '5 minutes',
          timeout: '8 seconds'
        },
        vercel: {
          region: process.env.VERCEL_REGION || 'unknown',
          deployment: true
        }
      });
    }

    // Route: Health Check
    if (pathname === '/api/health') {
      return res.json({
        success: true,
        message: 'API Running - Mobile Ready',
        timestamp: new Date().toISOString(),
        cache: {
          size: cache.size,
          mobile: true
        },
        vercel: {
          region: process.env.VERCEL_REGION || 'unknown',
          timeout: '8 seconds'
        }
      });
    }

    // Route: Latest Comics
    if (pathname === '/api/latest') {
      const page = parseInt(query.page) || 1;
      const limit = Math.min(parseInt(query.limit) || 10, 20); // Reduced for Vercel
      
      const cacheKey = \`latest_${page}_${limit}\`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      try {
        const url = \`${KOMIKCAST_URL}/?page=${page}\`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        $('div.listupd .utao').each((i, element) => {
          if (comics.length >= limit) return false;
          
          const el = $(element);
          const title = el.find('.luf a h3').text().trim();
          const fullUrl = el.find('.imgu a').attr('href');
          const cover = el.find('.imgu a img').attr('data-src') || el.find('.imgu a img').attr('src');
          const chapter = el.find('.luf ul li:first-child a').text().trim();
          const endpoint = fullUrl ? fullUrl.split('/').filter(Boolean)[4] : null;

          if (title && endpoint) {
            comics.push({ 
              title, 
              chapter, 
              cover, 
              endpoint, 
              source: 'komikcast' 
            });
          }
        });
        
        const result = {
          comics,
          pagination: {
            currentPage: page,
            limit,
            hasNext: comics.length === limit,
            hasPrev: page > 1
          }
        };
        
        setCache(cacheKey, result);
        return res.json({ success: true, data: result, cached: false });
        
      } catch (scrapeError) {
        console.error('Scraping error:', scrapeError.message);
        
        // Return fallback data
        const fallbackData = {
          comics: [],
          pagination: { currentPage: page, limit, hasNext: false, hasPrev: false },
          error: 'Scraping failed, using fallback',
          message: 'Komikcast mungkin sedang maintenance atau mengubah struktur website'
        };
        
        return res.json({ 
          success: true, 
          data: fallbackData, 
          cached: false,
          fallback: true 
        });
      }
    }

    // Route: Comic Detail
    if (pathname.startsWith('/api/detail/')) {
      const endpoint = pathname.split('/api/detail/')[1];
      
      if (!endpoint) {
        return res.status(400).json({
          success: false,
          message: 'Endpoint komik diperlukan'
        });
      }
      
      const cacheKey = \`detail_${endpoint}\`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      try {
        const url = \`${KOMIKCAST_URL}/komik/${endpoint}/\`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);

        const title = $('h1.komik_info-content-body-title').text().trim();
        const cover = $('.komik_info-content-thumbnail img').attr('src');
        const synopsis = $('.komik_info-description-sinopsis p').text().trim();
        
        const genres = [];
        $('.komik_info-content-genre a').each((i, element) => {
          genres.push($(element).text().trim());
        });
        
        const chapters = [];
        $('.komik_info-chapters-item').each((i, element) => {
          const el = $(element);
          const chapterTitle = el.find('a').text().trim();
          const chapterUrl = el.find('a').attr('href');
          const chapterEndpoint = chapterUrl ? chapterUrl.split('/').filter(Boolean).pop() : null;

          if (chapterTitle && chapterEndpoint) {
            chapters.push({ chapterTitle, chapterEndpoint });
          }
        });
        
        if (!title) {
          return res.status(404).json({
            success: false,
            message: 'Komik tidak ditemukan'
          });
        }
        
        const result = { 
          title, 
          cover, 
          synopsis, 
          genres,
          chapters: chapters.reverse().slice(0, 30) // Limit for Vercel
        };
        
        setCache(cacheKey, result);
        return res.json({ success: true, data: result, cached: false });
        
      } catch (scrapeError) {
        return res.status(404).json({
          success: false,
          message: 'Komik tidak ditemukan atau error saat mengambil data',
          error: scrapeError.message
        });
      }
    }

    // Route: Chapter Images
    if (pathname.startsWith('/api/chapter/')) {
      const endpoint = pathname.split('/api/chapter/')[1];
      
      if (!endpoint) {
        return res.status(400).json({
          success: false,
          message: 'Endpoint chapter diperlukan'
        });
      }
      
      const cacheKey = \`chapter_${endpoint}\`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      try {
        const url = \`${KOMIKCAST_URL}/chapter/${endpoint}/\`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const images = [];

        $('.main-reading-area img').each((i, element) => {
          const imageUrl = $(element).attr('src') || $(element).attr('data-src');
          if (imageUrl && !imageUrl.includes('loading') && !imageUrl.includes('placeholder')) {
            images.push(imageUrl.trim());
          }
        });

        if (images.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Chapter tidak ditemukan atau tidak memiliki gambar'
          });
        }
        
        const result = { 
          images,
          totalPages: images.length,
          chapterEndpoint: endpoint
        };
        
        setCache(cacheKey, result);
        return res.json({ success: true, data: result, cached: false });
        
      } catch (scrapeError) {
        return res.status(404).json({
          success: false,
          message: 'Chapter tidak ditemukan atau error saat mengambil data',
          error: scrapeError.message
        });
      }
    }

    // Route: Search
    if (pathname === '/api/search') {
      const q = query.q;
      const page = parseInt(query.page) || 1;
      
      if (!q || q.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Query minimal 2 karakter'
        });
      }
      
      const cacheKey = \`search_${q}_${page}\`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      try {
        const url = \`${KOMIKCAST_URL}/?s=${encodeURIComponent(q)}&page=${page}\`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        $('div.listupd .utao, .bsx').each((i, element) => {
          if (comics.length >= 10) return false; // Limit for Vercel
          
          const el = $(element);
          const title = el.find('.luf a h3, .tt h2 a, .tt h4 a').text().trim();
          const fullUrl = el.find('.imgu a, .ts a').attr('href');
          const cover = el.find('.imgu a img, .ts img').attr('data-src') || el.find('.imgu a img, .ts img').attr('src');
          const endpoint = fullUrl ? fullUrl.split('/').filter(Boolean)[4] : null;

          if (title && endpoint) {
            comics.push({ title, cover, endpoint, source: 'komikcast' });
          }
        });
        
        const result = {
          comics,
          query: q,
          pagination: { currentPage: page, hasNext: comics.length >= 10 }
        };
        
        setCache(cacheKey, result);
        return res.json({ success: true, data: result, cached: false });
        
      } catch (scrapeError) {
        return res.json({
          success: true,
          data: {
            comics: [],
            query: q,
            pagination: { currentPage: page, hasNext: false },
            error: 'Search failed',
            message: 'Pencarian gagal, coba kata kunci lain'
          },
          cached: false,
          fallback: true
        });
      }
    }

    // Route: Genres
    if (pathname === '/api/genres') {
      const cached = getCached('genres');
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      // Fallback genres for Vercel
      const genres = [
        { name: 'Action', slug: 'action' },
        { name: 'Adventure', slug: 'adventure' },
        { name: 'Comedy', slug: 'comedy' },
        { name: 'Drama', slug: 'drama' },
        { name: 'Fantasy', slug: 'fantasy' },
        { name: 'Romance', slug: 'romance' },
        { name: 'Sci-Fi', slug: 'sci-fi' },
        { name: 'Slice of Life', slug: 'slice-of-life' },
        { name: 'Supernatural', slug: 'supernatural' },
        { name: 'Thriller', slug: 'thriller' }
      ];
      
      const result = { genres, total: genres.length };
      setCache('genres', result);
      return res.json({ success: true, data: result, cached: false });
    }

    // Route: Genre Comics
    if (pathname.startsWith('/api/genre/')) {
      const slug = pathname.split('/api/genre/')[1];
      const page = parseInt(query.page) || 1;
      
      if (!slug) {
        return res.status(400).json({
          success: false,
          message: 'Genre slug diperlukan'
        });
      }
      
      const cacheKey = \`genre_${slug}_${page}\`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      try {
        const url = \`${KOMIKCAST_URL}/genres/${slug}/page/${page}/\`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        $('div.listupd .utao, .bsx').each((i, element) => {
          if (comics.length >= 10) return false;
          
          const el = $(element);
          const title = el.find('.luf a h3, .tt h2 a, .tt h4 a').text().trim();
          const fullUrl = el.find('.imgu a, .ts a').attr('href');
          const cover = el.find('.imgu a img, .ts img').attr('data-src') || el.find('.imgu a img, .ts img').attr('src');
          const endpoint = fullUrl ? fullUrl.split('/').filter(Boolean)[4] : null;

          if (title && endpoint) {
            comics.push({ title, cover, endpoint, source: 'komikcast' });
          }
        });
        
        const result = {
          comics,
          genre: slug,
          pagination: { currentPage: page, hasNext: comics.length >= 10 }
        };
        
        setCache(cacheKey, result);
        return res.json({ success: true, data: result, cached: false });
        
      } catch (scrapeError) {
        return res.json({
          success: true,
          data: {
            comics: [],
            genre: slug,
            pagination: { currentPage: page, hasNext: false },
            error: 'Genre scraping failed',
            message: 'Genre tidak ditemukan atau error saat mengambil data'
          },
          cached: false,
          fallback: true
        });
      }
    }

    // 404 handler
    return res.status(404).json({
      success: false,
      message: 'Endpoint tidak ditemukan',
      available: ['/api/latest', '/api/detail/[endpoint]', '/api/chapter/[endpoint]', '/api/search', '/api/genres', '/api/genre/[slug]']
    });

  } catch (error) {
    return handleError(error, res, 'processing request');
  }
};
