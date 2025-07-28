const axios = require('axios');
const cheerio = require('cheerio');

// KONSTANTA UTAMA
const BASE_URL = 'https://komikcast.li';
const CACHE_TTL = 5 * 60 * 1000; // Cache 5 menit

// KONFIGURASI AXIOS
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': BASE_URL + '/'
  },
  timeout: 25000 // Timeout 25 detik
};

// SISTEM CACHE SEDERHANA (IN-MEMORY)
const cache = new Map();

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

// FUNGSI PENANGANAN ERROR
const handleError = (res, error, operation) => {
  console.error(`Error during ${operation}:`, error.message);
  if (error.response) {
    return res.status(error.response.status).json({
      success: false,
      message: `Error from external service for ${operation}.`,
      error: error.message
    });
  }
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return res.status(408).json({
      success: false,
      message: 'Request timeout. Please try again.',
      error: 'Timeout'
    });
  }
  return res.status(500).json({
    success: false,
    message: `An internal error occurred during ${operation}.`,
    error: 'Internal Server Error'
  });
};

// HANDLER UTAMA
module.exports = async (req, res) => {
  // SET HEADER CORS UNTUK AKSES BROWSER
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // Cache di sisi CDN Vercel

  // Handle pre-flight request
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { type, endpoint, page = 1, q: query } = req.query;
  const cacheKey = `${type}_${endpoint || query || ''}_${page}`;

  try {
    const cachedData = getCached(cacheKey);
    if (cachedData) {
      return res.status(200).json({ success: true, cached: true, data: cachedData });
    }

    let result;

    // --- Rute: Daftar Komik Terbaru (latest) ---
    if (type === 'latest') {
      const url = `${BASE_URL}/?page=${page}`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const comics = [];

      $('div.listupd .utao').each((i, el) => {
        const title = $(el).find('.luf a h3').text().trim();
        const fullUrl = $(el).find('.imgu a').attr('href');
        const cover = $(el).find('.imgu a img').attr('data-src');
        const chapter = $(el).find('.luf ul li:first-child a').text().trim();
        const slug = fullUrl?.split('/')[4];

        if (title && slug) {
          comics.push({ title, chapter, cover, endpoint: slug });
        }
      });
      result = { comics };
    }

    // --- Rute: Komik Populer/Hot ---
    else if (type === 'popular') {
      const url = BASE_URL; // Komik hot ada di halaman utama
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const comics = [];
      
      $('.list-update_item-wrapper.hot .list-update_item').each((i, el) => {
        const title = $(el).find('.list-update_item-info h3 a').text().trim();
        const fullUrl = $(el).find('a').attr('href');
        const cover = $(el).find('.list-update_item-image img').attr('src');
        const chapter = $(el).find('.list-update_item-info .chapter a').text().trim();
        const slug = fullUrl?.split('/')[4];
        
        if(title && slug) {
            comics.push({ title, chapter, cover, endpoint: slug });
        }
      });
      result = { comics };
    }

    // --- Rute: Detail Komik ---
    else if (type === 'detail' && endpoint) {
      const url = `${BASE_URL}/komik/${endpoint}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);

      const title = $('h1.komik_info-content-body-title').text().trim();
      const cover = $('.komik_info-content-thumbnail img').attr('src');
      const synopsis = $('.komik_info-description-sinopsis p').text().trim();
      const genres = [];
      $('.komik_info-content-genre a').each((i, el) => {
        genres.push($(el).text().trim());
      });
      const chapters = [];

      $('.komik_info-chapters-item').each((i, el) => {
        const chapterTitle = $(el).find('a').text().trim();
        const chapterUrl = $(el).find('a').attr('href');
        const slug = chapterUrl?.split('/').filter(x => x).pop();
        chapters.push({ chapterTitle, chapterEndpoint: slug });
      });
      result = { title, cover, synopsis, genres, chapters: chapters.reverse() };
    }

    // --- Rute: Baca Chapter (Gambar) ---
    else if (type === 'chapter' && endpoint) {
      const url = `${BASE_URL}/chapter/${endpoint}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const images = [];

      $('.main-reading-area img').each((i, el) => {
        const src = $(el).attr('src')?.trim();
        if (src && !src.includes('loading')) images.push(src);
      });
      result = { images };
    }

    // --- Rute: Pencarian Komik ---
    else if (type === 'search' && query) {
        const url = `${BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        $('div.listupd .bsx').each((i, el) => {
            const title = $(el).find('.tt h2').text().trim();
            const fullUrl = $(el).find('a').attr('href');
            const cover = $(el).find('.limit img').attr('data-src') || $(el).find('.limit img').attr('src');
            const slug = fullUrl?.split('/')[4];
            
            if (title && slug) {
                comics.push({ title, cover, endpoint: slug });
            }
        });
        result = { comics, query };
    }

    // --- Rute: Daftar Genre ---
    else if (type === 'genres') {
      const url = `${BASE_URL}/daftar-genre/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const genres = [];

      $('.genre-list li').each((i, el) => {
        const name = $(el).find('a').text().trim();
        const fullUrl = $(el).find('a').attr('href');
        const slug = fullUrl?.split('/')[4];
        if (name && slug) {
            genres.push({ name, endpoint: slug });
        }
      });
      result = { genres };
    }

    // --- Jika tidak ada tipe yang cocok ---
    else {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or missing `type` parameter.',
        availableTypes: ['latest', 'popular', 'detail', 'chapter', 'search', 'genres']
      });
    }
    
    // Simpan ke cache dan kirim respon
    setCache(cacheKey, result);
    return res.status(200).json({ success: true, cached: false, data: result });

  } catch (err) {
    return handleError(res, err, `type: ${type}`);
  }
};
