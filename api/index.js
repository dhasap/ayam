// /api/index.js (FINAL dengan Fitur Popular, Genres, Recommended, Search, dll.)

const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://komikcast.li';
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
    'Referer': BASE + '/'
  }
};

module.exports = async (req, res) => {
  // Handle CORS & Pre-flight Request
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  // Ambil query parameter dari URL
  const { type, endpoint, page = 1, q } = req.query;

  try {
    // --- 🏠 Rute untuk Halaman Utama (Menggabungkan Recommended & Popular) ---
    if (type === 'home') {
        const { data } = await axios.get(BASE, axiosOptions);
        const $ = cheerio.load(data);
  
        // ✨ Recommended (dari "Hot Komik Update" / List Update pertama)
        const recommended = [];
        $('div.listupd').first().find('.utao').each((i, el) => {
          const title = $(el).find('.luf a h3').text().trim();
          const fullUrl = $(el).find('.imgu a').attr('href');
          const cover = $(el).find('.imgu a img').attr('data-src');
          const chapter = $(el).find('.luf ul li:first-child a').text().trim();
          const slug = fullUrl?.split('/')[4];
  
          if (title && slug) {
            recommended.push({ title, chapter, cover, endpoint: slug });
          }
        });
  
        // ⭐ Popular (dari "Popular Series")
        const popular = [];
        $('.bixbox.series-gen .list-series li').each((i, el) => {
          const title = $(el).find('.title a').text().trim();
          const fullUrl = $(el).find('a').attr('href');
          const cover = $(el).find('img').attr('data-src');
          const chapter = $(el).find('.chapter a').text().trim();
          const slug = fullUrl?.split('/')[4];
  
          if(title && slug) {
            popular.push({ title, chapter, cover, endpoint: slug });
          }
        });
  
        return res.status(200).json({ recommended, popular });
    }

    // --- 📚 Rute untuk daftar komik berdasarkan Genre ---
    if (type === 'genre' && endpoint) {
        const url = `${BASE}/genres/${endpoint}/?page=${page}`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        // Mirip dengan search dan latest
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

        return res.status(200).json({ comics });
    }

    // --- 🎯 Rute untuk mendapatkan daftar semua Genre ---
    if (type === 'genres') {
      const url = `${BASE}/genres/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const genres = [];

      $('.genrez li').each((i, el) => {
        const genreName = $(el).find('a').text().trim();
        const fullUrl = $(el).find('a').attr('href');
        const slug = fullUrl?.split('/').filter(Boolean).pop(); // Ambil bagian terakhir dari URL

        if(genreName && slug){
          genres.push({ genreName, endpoint: slug });
        }
      });
      return res.status(200).json({ genres });
    }

    // --- 🔄 Rute untuk daftar komik terbaru (Latest) ---
    if (type === 'latest') {
      const url = `${BASE}/?page=${page}`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const comics = [];
      // Selector ini menargetkan list update kedua dan seterusnya di homepage
      $('div.listupd').slice(1).find('.utao').each((i, el) => {
        const title = $(el).find('.luf a h3').text().trim();
        const fullUrl = $(el).find('.imgu a').attr('href');
        const cover = $(el).find('.imgu a img').attr('data-src');
        const chapter = $(el).find('.luf ul li:first-child a').text().trim();
        const slug = fullUrl?.split('/')[4];
        if (title && slug) {
          comics.push({ title, chapter, cover, endpoint: slug });
        }
      });
      return res.status(200).json({ comics });
    }

    // --- 🔍 Rute untuk Pencarian Komik ---
    if (type === 'search' && q) {
      const url = `${BASE}/?s=${encodeURIComponent(q)}`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const results = [];

      $('div.list-update_item').each((i, el) => {
        const title = $(el).find('h3.title a').text().trim();
        const fullUrl = $(el).find('a').attr('href');
        const cover = $(el).find('a img').attr('src');
        const comicType = $(el).find('.type').text().trim();
        const slug = fullUrl?.split('/')[4];

        if (title && slug) {
            results.push({ title, cover, type: comicType, endpoint: slug });
        }
      });
      return res.status(200).json({ results });
    }

    // --- 📖 Rute untuk Detail Komik ---
    if (type === 'detail' && endpoint) {
      const url = `${BASE}/komik/${endpoint}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const title = $('h1.komik_info-content-body-title').text().trim();
      const cover = $('.komik_info-content-thumbnail img').attr('src');
      const synopsis = $('.komik_info-description-sinopsis p').text().trim();
      const chapters = [];
      $('.komik_info-chapters-item').each((i, el) => {
        const chapterTitle = $(el).find('a').text().trim();
        const chapterUrl = $(el).find('a').attr('href');
        const slug = chapterUrl?.split('/').filter(x => x).pop();
        if (chapterTitle && slug) {
            chapters.push({ chapterTitle, chapterEndpoint: slug });
        }
      });
      return res.status(200).json({ title, cover, synopsis, chapters: chapters.reverse() });
    }

    // --- 🖼️ Rute untuk Gambar Chapter ---
    if (type === 'chapter' && endpoint) {
      const url = `${BASE}/chapter/${endpoint}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const images = [];
      $('.main-reading-area img').each((i, el) => {
        const src = $(el).attr('src');
        if (src) images.push(src.trim());
      });
      return res.status(200).json({ images });
    }

    // Jika parameter tidak valid
    res.status(400).json({ error: "Parameter tidak valid. Pastikan 'type' diisi dan parameter tambahan seperti 'endpoint' atau 'q' tersedia jika diperlukan." });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server scraper.', message: err.message });
  }
};
