const axios = require('axios');
const cheerio = require('cheerio');

// Cache sederhana untuk Vercel Free (in-memory)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 menit untuk free tier

// Axios configuration optimized for mobile
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://komikcast.li/'
  },
  timeout: 25000 // Reduced for Vercel Free
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

// Error handler optimized for mobile
const handleError = (error, res, operation) => {
  console.error(`Error in ${operation}:`, error.message);
  
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      message: 'Layanan tidak tersedia. Coba lagi nanti.',
      error: 'Service Unavailable'
    });
  }
  
  if (error.code === 'ETIMEDOUT') {
    return res.status(408).json({
      success: false,
      message: 'Request timeout. Coba lagi.',
      error: 'Timeout'
    });
  }
  
  return res.status(500).json({
    success: false,
    message: `Gagal ${operation}`,
    error: 'Internal Error'
  });
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

  const { pathname, query } = new URL(req.url, `http://${req.headers.host}`);
  
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
          timeout: '25 seconds'
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
        }
      });
    }

    // Route: Latest Comics
    if (pathname === '/api/latest') {
      const page = parseInt(query.page) || 1;
      const limit = Math.min(parseInt(query.limit) || 15, 30); // Reduced for mobile
      
      const cacheKey = `latest_${page}_${limit}`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      const url = `${KOMIKCAST_URL}/?page=${page}`;
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
        const endpoint = fullUrl ? fullUrl.split('/')[4] : null;

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
      
      const cacheKey = `detail_${endpoint}`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      const url = `${KOMIKCAST_URL}/komik/${endpoint}/`;
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
        const chapterEndpoint = chapterUrl ? chapterUrl.split('/').filter(part => part).pop() : null;

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
        chapters: chapters.reverse().slice(0, 50) // Limit for mobile
      };
      
      setCache(cacheKey, result);
      return res.json({ success: true, data: result, cached: false });
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
      
      const cacheKey = `chapter_${endpoint}`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      const url = `${KOMIKCAST_URL}/chapter/${endpoint}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const images = [];

      $('.main-reading-area img').each((i, element) => {
        const imageUrl = $(element).attr('src') || $(element).attr('data-src');
        if (imageUrl && !imageUrl.includes('loading')) {
          images.push(imageUrl.trim());
        }
      });

      if (images.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Chapter tidak ditemukan'
        });
      }
      
      const result = { 
        images,
        totalPages: images.length,
        chapterEndpoint: endpoint
      };
      
      setCache(cacheKey, result);
      return res.json({ success: true, data: result, cached: false });
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
      
      const cacheKey = `search_${q}_${page}`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      const url = `${KOMIKCAST_URL}/?s=${encodeURIComponent(q)}&page=${page}`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const comics = [];

      $('div.listupd .utao, .bsx').each((i, element) => {
        if (comics.length >= 15) return false; // Limit for mobile
        
        const el = $(element);
        const title = el.find('.luf a h3, .tt h2 a, .tt h4 a').text().trim();
        const fullUrl = el.find('.imgu a, .ts a').attr('href');
        const cover = el.find('.imgu a img, .ts img').attr('data-src') || el.find('.imgu a img, .ts img').attr('src');
        const endpoint = fullUrl ? fullUrl.split('/')[4] : null;

        if (title && endpoint) {
          comics.push({ title, cover, endpoint, source: 'komikcast' });
        }
      });
      
      const result = {
        comics,
        query: q,
        pagination: { currentPage: page, hasNext: comics.length >= 15 }
      };
      
      setCache(cacheKey, result);
      return res.json({ success: true, data: result, cached: false });
    }

    // Route: Genres
    if (pathname === '/api/genres') {
      const cached = getCached('genres');
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      // Fallback genres for mobile
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
      
      const cacheKey = `genre_${slug}_${page}`;
      const cached = getCached(cacheKey);
      
      if (cached) {
        return res.json({ success: true, data: cached, cached: true });
      }
      
      const url = `${KOMIKCAST_URL}/genres/${slug}/page/${page}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const comics = [];

      $('div.listupd .utao, .bsx').each((i, element) => {
        if (comics.length >= 15) return false;
        
        const el = $(element);
        const title = el.find('.luf a h3, .tt h2 a, .tt h4 a').text().trim();
        const fullUrl = el.find('.imgu a, .ts a').attr('href');
        const cover = el.find('.imgu a img, .ts img').attr('data-src') || el.find('.imgu a img, .ts img').attr('src');
        const endpoint = fullUrl ? fullUrl.split('/')[4] : null;

        if (title && endpoint) {
          comics.push({ title, cover, endpoint, source: 'komikcast' });
        }
      });
      
      const result = {
        comics,
        genre: slug,
        pagination: { currentPage: page, hasNext: comics.length >= 15 }
      };
      
      setCache(cacheKey, result);
      return res.json({ success: true, data: result, cached: false });
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
