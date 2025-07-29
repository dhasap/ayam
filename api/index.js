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
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { type, endpoint, page = 1 } = req.query;
  const cacheKey = JSON.stringify(req.query);

  try {
    const cachedData = getCached(cacheKey);
    if (cachedData) {
      return res.status(200).json({ success: true, cached: true, data: cachedData });
    }

    let result;

    // --- Rute: Daftar Komik Terbaru (latest) dari Halaman Utama ---
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

    // --- Rute: Browse/Filter Komik ---
    else if (type === 'browse') {
        const { status, orderby = 'popular', comic_type, genre, q } = req.query;
        
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (orderby) params.append('orderby', orderby);
        if (comic_type) params.append('type', comic_type);
        if (q) params.append('s', q);
        
        let genreQuery = '';
        if (genre) {
            const genreArr = genre.split(',');
            genreArr.forEach(g => {
                genreQuery += `&genre[]=${g.trim()}`;
            });
        }

        const url = `${BASE_URL}/daftar-komik/page/${page}/?${params.toString()}${genreQuery}`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        $('.list-update_item').each((i, el) => {
            const title = $(el).find('h3.title').text().trim();
            const fullUrl = $(el).find('a').attr('href');
            const cover = $(el).find('img').attr('src');
            const comicType = $(el).find('span.type').text().trim();
            const chapter = $(el).find('.chapter').text().trim();
            const rating = $(el).find('.numscore').text().trim();
            const endpoint = fullUrl?.split('/')[4];

            if (title && endpoint) {
                comics.push({ title, endpoint, cover, type: comicType, chapter, rating });
            }
        });
        
        const lastPage = $('.pagination a.page-numbers').not('.next').last().text();
        const pagination = {
            currentPage: parseInt(page, 10),
            lastPage: lastPage ? parseInt(lastPage, 10) : parseInt(page, 10)
        };

        result = { comics, pagination };
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
        genres.push({
            name: $(el).text().trim(),
            endpoint: $(el).attr('href')?.split('/')[4]
        });
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

    // --- [ENDPOINT DIPERBAIKI] Rute: Baca Chapter (Gambar) ---
    else if (type === 'chapter' && endpoint) {
        const url = `${BASE_URL}/chapter/${endpoint}/`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const images = [];

        // Mengambil gambar dari area baca utama
        $('#chapter_body .main-reading-area img').each((i, el) => {
            const element = $(el);
            // Prioritaskan 'data-src' untuk lazy loading, fallback ke 'src'
            let src = element.attr('data-src') || element.attr('src');
            
            if (src) {
                src = src.trim();
                // Memastikan URL valid dan bukan placeholder
                if (src && !src.includes('loading') && !src.includes('placeholder')) {
                    images.push(src);
                }
            }
        });

        // Mengambil informasi navigasi dan judul chapter
        const chapterTitle = $('.chapter_headpost h1').text().trim();
        const prevChapterEndpoint = $('.nextprev a[rel="prev"]').attr('href')?.split('/').filter(Boolean).pop() || null;
        const nextChapterEndpoint = $('.nextprev a[rel="next"]').attr('href')?.split('/').filter(Boolean).pop() || null;

        result = { 
            title: chapterTitle,
            images, 
            navigation: {
                prev: prevChapterEndpoint,
                next: nextChapterEndpoint
            }
        };
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
        availableTypes: ['latest', 'browse', 'detail', 'chapter', 'genres']
      });
    }
    
    setCache(cacheKey, result);
    return res.status(200).json({ success: true, cached: false, data: result });

  } catch (err) {
    return handleError(res, err, `type: ${type}`);
  }
};
  
