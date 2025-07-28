const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const winston = require('winston');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const KOMIKCAST_URL = 'https://komikcast.li';

// Initialize cache (TTL: 10 minutes)
const cache = new NodeCache({ stdTTL: 600 });

// Configure Winston Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'komikcast-scraper' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Terlalu banyak request dari IP ini, coba lagi setelah 15 menit.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Axios configuration
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Referer': 'https://komikcast.li/'
  },
  timeout: 30000
};

// Middleware
app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(limiter);
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    query: req.query
  });
  next();
});

// Error handling middleware
const handleError = (error, req, res, operation) => {
  logger.error(`Error in ${operation}`, {
    error: error.message,
    stack: error.stack,
    url: req.url,
    ip: req.ip
  });
  
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return res.status(503).json({
      success: false,
      message: 'Layanan sementara tidak tersedia. Silakan coba lagi nanti.',
      error: 'Service Unavailable'
    });
  }
  
  if (error.code === 'ETIMEDOUT') {
    return res.status(408).json({
      success: false,
      message: 'Request timeout. Silakan coba lagi.',
      error: 'Request Timeout'
    });
  }
  
  return res.status(500).json({
    success: false,
    message: `Gagal ${operation}. Silakan coba lagi.`,
    error: error.message
  });
};

// Cache helper functions
const getCacheKey = (endpoint, params = {}) => {
  return `${endpoint}_${JSON.stringify(params)}`;
};

const getFromCache = (key) => {
  return cache.get(key);
};

const setToCache = (key, data) => {
  cache.set(key, data);
  return data;
};

// =============================================================
// Rute 1: Mengambil daftar komik terbaru dengan pagination
// =============================================================
app.get('/latest', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    if (page < 1 || limit < 1 || limit > 50) {
      return res.status(400).json({
        success: false,
        message: 'Parameter tidak valid. Page harus >= 1, limit antara 1-50.'
      });
    }
    
    const cacheKey = getCacheKey('latest', { page, limit });
    const cachedData = getFromCache(cacheKey);
    
    if (cachedData) {
      logger.info('Cache hit for latest comics', { page, limit });
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
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
      const rating = el.find('.numscore').text().trim();
      const type = el.find('.typeflag').text().trim();

      if (title && endpoint) {
        comics.push({ 
          title, 
          chapter, 
          cover, 
          endpoint, 
          rating,
          type,
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
    
    setToCache(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false
    });
    
  } catch (error) {
    handleError(error, req, res, 'mengambil daftar komik terbaru');
  }
});

// =================================================================
// Rute 2: Mengambil detail komik & chapter
// =================================================================
app.get('/detail/:endpoint', async (req, res) => {
  try {
    const { endpoint } = req.params;
    
    if (!endpoint || endpoint.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint komik tidak valid.'
      });
    }
    
    const cacheKey = getCacheKey('detail', { endpoint });
    const cachedData = getFromCache(cacheKey);
    
    if (cachedData) {
      logger.info('Cache hit for comic detail', { endpoint });
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    const url = `${KOMIKCAST_URL}/komik/${endpoint}/`;
    const { data } = await axios.get(url, axiosOptions);
    const $ = cheerio.load(data);

    const title = $('h1.komik_info-content-body-title').text().trim();
    const cover = $('.komik_info-content-thumbnail img').attr('src');
    const synopsis = $('.komik_info-description-sinopsis p').text().trim();
    const status = $('.komik_info-content-meta span:contains("Status")').parent().text().replace('Status', '').trim();
    const author = $('.komik_info-content-meta span:contains("Author")').parent().text().replace('Author', '').trim();
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
      const releaseDate = el.find('.chapter-link-time').text().trim();

      if (chapterTitle && chapterEndpoint) {
        chapters.push({ 
          chapterTitle, 
          chapterEndpoint,
          releaseDate 
        });
      }
    });
    
    if (!title) {
      return res.status(404).json({
        success: false,
        message: 'Komik tidak ditemukan.'
      });
    }
    
    const result = { 
      title, 
      cover, 
      synopsis, 
      status,
      author,
      genres,
      chapters: chapters.reverse() 
    };
    
    setToCache(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false
    });
    
  } catch (error) {
    handleError(error, req, res, 'mengambil detail komik');
  }
});

// =================================================================
// Rute 3: Mengambil gambar chapter
// =================================================================
app.get('/chapter/:endpoint', async (req, res) => {
  try {
    const { endpoint } = req.params;
    
    if (!endpoint || endpoint.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint chapter tidak valid.'
      });
    }
    
    const cacheKey = getCacheKey('chapter', { endpoint });
    const cachedData = getFromCache(cacheKey);
    
    if (cachedData) {
      logger.info('Cache hit for chapter images', { endpoint });
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    const url = `${KOMIKCAST_URL}/chapter/${endpoint}/`;
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
        message: 'Chapter tidak ditemukan atau tidak memiliki gambar.'
      });
    }
    
    const result = { 
      images,
      totalPages: images.length,
      chapterEndpoint: endpoint
    };
    
    setToCache(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false
    });
    
  } catch (error) {
    handleError(error, req, res, 'mengambil gambar chapter');
  }
});

// =================================================================
// Rute 4: Search komik
// =================================================================
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const page = parseInt(req.query.page) || 1;
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Query pencarian harus minimal 2 karakter.'
      });
    }
    
    const cacheKey = getCacheKey('search', { query, page });
    const cachedData = getFromCache(cacheKey);
    
    if (cachedData) {
      logger.info('Cache hit for search', { query, page });
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    const url = `${KOMIKCAST_URL}/?s=${encodeURIComponent(query)}&page=${page}`;
    const { data } = await axios.get(url, axiosOptions);
    const $ = cheerio.load(data);
    const comics = [];

    $('div.listupd .utao, .bsx').each((i, element) => {
      const el = $(element);
      const title = el.find('.luf a h3, .tt h2 a, .tt h4 a').text().trim();
      const fullUrl = el.find('.imgu a, .ts a').attr('href');
      const cover = el.find('.imgu a img, .ts img').attr('data-src') || el.find('.imgu a img, .ts img').attr('src');
      const chapter = el.find('.luf ul li:first-child a, .epxs').text().trim();
      const endpoint = fullUrl ? fullUrl.split('/')[4] : null;
      const rating = el.find('.numscore, .rating .rtg').text().trim();

      if (title && endpoint) {
        comics.push({ 
          title, 
          chapter, 
          cover, 
          endpoint, 
          rating,
          source: 'komikcast' 
        });
      }
    });
    
    const result = {
      comics,
      query,
      pagination: {
        currentPage: page,
        hasNext: comics.length >= 20,
        hasPrev: page > 1
      }
    };
    
    setToCache(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false
    });
    
  } catch (error) {
    handleError(error, req, res, 'pencarian komik');
  }
});

// =================================================================
// Rute 5: Daftar genre
// =================================================================
app.get('/genres', async (req, res) => {
  try {
    const cacheKey = getCacheKey('genres');
    const cachedData = getFromCache(cacheKey);
    
    if (cachedData) {
      logger.info('Cache hit for genres');
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    const url = `${KOMIKCAST_URL}/daftar-komik/`;
    const { data } = await axios.get(url, axiosOptions);
    const $ = cheerio.load(data);
    const genres = [];

    $('.genre-list a, .tagcloud a, .wp-tag-cloud a').each((i, element) => {
      const el = $(element);
      const name = el.text().trim();
      const slug = el.attr('href') ? el.attr('href').split('/').filter(part => part).pop() : null;
      
      if (name && slug && name.length > 1) {
        genres.push({ 
          name, 
          slug,
          url: el.attr('href')
        });
      }
    });
    
    // Fallback manual genres if scraping fails
    if (genres.length === 0) {
      const manualGenres = [
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
      genres.push(...manualGenres);
    }
    
    const result = {
      genres: genres.slice(0, 50), // Limit to 50 genres
      total: genres.length
    };
    
    setToCache(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false
    });
    
  } catch (error) {
    handleError(error, req, res, 'mengambil daftar genre');
  }
});

// =================================================================
// Rute 6: Komik berdasarkan genre
// =================================================================
app.get('/genre/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const page = parseInt(req.query.page) || 1;
    
    if (!slug || slug.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Slug genre tidak valid.'
      });
    }
    
    const cacheKey = getCacheKey('genre', { slug, page });
    const cachedData = getFromCache(cacheKey);
    
    if (cachedData) {
      logger.info('Cache hit for genre comics', { slug, page });
      return res.json({
        success: true,
        data: cachedData,
        cached: true
      });
    }
    
    const url = `${KOMIKCAST_URL}/genres/${slug}/page/${page}/`;
    const { data } = await axios.get(url, axiosOptions);
    const $ = cheerio.load(data);
    const comics = [];

    $('div.listupd .utao, .bsx').each((i, element) => {
      const el = $(element);
      const title = el.find('.luf a h3, .tt h2 a, .tt h4 a').text().trim();
      const fullUrl = el.find('.imgu a, .ts a').attr('href');
      const cover = el.find('.imgu a img, .ts img').attr('data-src') || el.find('.imgu a img, .ts img').attr('src');
      const chapter = el.find('.luf ul li:first-child a, .epxs').text().trim();
      const endpoint = fullUrl ? fullUrl.split('/')[4] : null;
      const rating = el.find('.numscore, .rating .rtg').text().trim();

      if (title && endpoint) {
        comics.push({ 
          title, 
          chapter, 
          cover, 
          endpoint, 
          rating,
          source: 'komikcast' 
        });
      }
    });
    
    const result = {
      comics,
      genre: slug,
      pagination: {
        currentPage: page,
        hasNext: comics.length >= 20,
        hasPrev: page > 1
      }
    };
    
    setToCache(cacheKey, result);
    
    res.json({
      success: true,
      data: result,
      cached: false
    });
    
  } catch (error) {
    handleError(error, req, res, 'mengambil komik berdasarkan genre');
  }
});

// =================================================================
// Health check endpoint
// =================================================================
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Komikcast Scraper API is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cache: {
      keys: cache.keys().length,
      stats: cache.getStats()
    }
  });
});

// =================================================================
// API Documentation endpoint
// =================================================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Komikcast Scraper API v2.0',
    endpoints: {
      '/latest': 'Daftar komik terbaru (query: page, limit)',
      '/detail/:endpoint': 'Detail komik dan daftar chapter',
      '/chapter/:endpoint': 'Gambar-gambar dalam chapter',
      '/search': 'Pencarian komik (query: q, page)',
      '/genres': 'Daftar semua genre',
      '/genre/:slug': 'Komik berdasarkan genre (query: page)',
      '/health': 'Status kesehatan API'
    },
    features: [
      'Rate limiting (100 req/15min)',
      'Caching (10 minutes TTL)',
      'Comprehensive logging',
      'Error handling',
      'CORS enabled',
      'Security headers'
    ]
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint tidak ditemukan.',
    availableEndpoints: ['/latest', '/detail/:endpoint', '/chapter/:endpoint', '/search', '/genres', '/genre/:slug', '/health']
  });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan internal server.',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal Server Error'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Komikcast Scraper API v2.0 running on port ${PORT}`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    features: ['rate-limiting', 'caching', 'logging', 'cors', 'security']
  });
});

module.exports = app;
