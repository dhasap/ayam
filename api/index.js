const axios = require('axios');
const cheerio = require('cheerio');

// KONSTANTA UTAMA
const BASE_URL = 'https://komikcast.li';
const CACHE_TTL = 5 * 60 * 1000;

// KONFIGURASI AXIOS
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': 'https://komikcast.li' + '/'
  },
  timeout: 25000
};

// SISTEM CACHE
const cache = new Map();
const getCached = (key) => {
  const item = cache.get(key);
  if (item && Date.now() - item.timestamp < CACHE_TTL) return item.data;
  cache.delete(key);
  return null;
};
const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
  return data;
};

// PENANGANAN ERROR
const handleError = (res, error, operation) => {
  console.error(`Error during ${operation}:`, error.message);
  const status = error.response?.status || (error.code === 'ETIMEDOUT' ? 408 : 500);
  const message = status === 408 ? 'Request timeout.' : `An internal error occurred during ${operation}.`;
  return res.status(status).json({ success: false, message, error: error.message });
};

// HANDLER UTAMA
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { type, endpoint, page = 1, q: query, url: imageUrl } = req.query;

  // --- [FITUR BARU] Image Proxy untuk mengatasi gambar kosong ---
  if (type === 'image_proxy' && imageUrl) {
      try {
          const imageResponse = await axios.get(imageUrl, {
              ...axiosOptions,
              responseType: 'arraybuffer' // Ambil sebagai data mentah
          });
          const contentType = imageResponse.headers['content-type'];
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // Cache gambar 1 minggu
          return res.status(200).send(imageResponse.data);
      } catch (err) {
          console.error(`Proxy error for ${imageUrl}:`, err.message);
          return res.status(404).json({ success: false, message: 'Image not found' });
      }
  }
  
  // Sisa kode di bawah ini adalah kode asli milikmu, tidak diubah.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  const cacheKey = JSON.stringify(req.query);

  try {
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.status(200).json({ success: true, cached: true, data: cachedData });

    let result;

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
            const endpoint = fullUrl?.split('/')[4];
            if (title && endpoint) comics.push({ title, chapter, cover, endpoint });
        });
        result = { comics };
    }
    
    else if (type === 'browse') {
        let url;
        if (query) {
            url = `${BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`;
        } else {
            const params = new URLSearchParams(req.query);
            params.delete('type');
            params.delete('q');
            params.delete('page');
            url = `${BASE_URL}/daftar-komik/page/${page}/?${params.toString()}`;
        }
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];
        $('.list-update_item').each((i, el) => {
            const title = $(el).find('h3.title').text().trim();
            const fullUrl = $(el).find('a').attr('href');
            const cover = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');
            const comicType = $(el).find('span.type').text().trim();
            const chapter = $(el).find('.chapter').text().trim();
            const rating = $(el).find('.numscore').text().trim();
            const endpoint = fullUrl?.split('/')[4];
            if (title && endpoint) comics.push({ title, endpoint, cover, type: comicType, chapter, rating });
        });
        const lastPage = $('.pagination a.page-numbers').not('.next').last().text();
        const pagination = { currentPage: parseInt(page, 10), lastPage: lastPage ? parseInt(lastPage, 10) : parseInt(page, 10) };
        result = { comics, pagination };
    }

    else if (type === 'detail' && endpoint) {
        const url = `${BASE_URL}/komik/${endpoint}/`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const title = $('h1.komik_info-content-body-title').text().trim();
        const cover = $('.komik_info-content-thumbnail img').attr('src');
        const synopsis = $('.komik_info-description-sinopsis p').text().trim();
        const genres = $('.komik_info-content-genre a').map((i, el) => ({
            name: $(el).text().trim(),
            endpoint: $(el).attr('href')?.split('/')[4]
        })).get();
        const chapters = $('.komik_info-chapters-item').map((i, el) => ({
            chapterTitle: $(el).find('a').text().trim(),
            chapterEndpoint: $(el).find('a').attr('href')?.split('/').filter(Boolean).pop()
        })).get().reverse();
        result = { title, cover, synopsis, genres, chapters };
    }

    else if (type === 'chapter' && endpoint) {
        const url = `${BASE_URL}/chapter/${endpoint}/`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        
        const images = $('#chapter_body .main-reading-area img').map((i, el) => {
            let src = $(el).attr('data-src') || $(el).attr('src');
            if (src) {
                src = src.trim();
                if (src.startsWith('//')) {
                    src = 'https:' + src;
                }
                src = src.split('?')[0];
                return src;
            }
            return null;
        }).get().filter(src => src && !src.includes('loading'));

        const chapterTitle = $('.chapter_headpost h1').text().trim();
        const prev = $('.nextprev a[rel="prev"]').attr('href')?.split('/').filter(Boolean).pop() || null;
        const next = $('.nextprev a[rel="next"]').attr('href')?.split('/').filter(Boolean).pop() || null;
        result = { title: chapterTitle, images, navigation: { prev, next } };
    }
    
    else if (type === 'genres') {
        const url = `${BASE_URL}/daftar-komik/`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const genres = $('.komiklist_dropdown-menu.genrez li').map((i, el) => ({
            name: $(el).find('label').text().trim(),
            endpoint: $(el).find('input').attr('value')
        })).get();
        result = { genres };
    }

    else {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid or missing parameters.',
            availableTypes: ['latest', 'browse', 'detail', 'chapter', 'genres', 'image_proxy']
        });
    }
    
    setCache(cacheKey, result);
    return res.status(200).json({ success: true, cached: false, data: result });

  } catch (err) {
    return handleError(res, err, `type: ${type}`);
  }
};
      
