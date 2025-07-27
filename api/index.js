// /api/index.js (FINAL dengan Perbaikan CORS, Pre-flight Request & Fitur Tambahan)

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { type, endpoint, query, page = 1 } = req.query;

  try {
    // --- Daftar komik terbaru ---
    if (type === 'latest') {
      const url = `${BASE}/?page=${page}`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const comics = [];

      $('div.listupd .utao').each((i, el) => {
        const title = $(el).find('.luf a h3').text().trim();
        const fullUrl = $(el).find('.imgu a').attr('href');
        const cover = $(el).find('.imgu a img').attr('data-src');
        const chapter = $(el).find('.luf ul li:first-child a').text().trim();
        const slug = fullUrl?.split('/')[4];
        if (title && slug) comics.push({ title, chapter, cover, endpoint: slug });
      });
      return res.status(200).json({ comics });
    }

    // --- Detail komik ---
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
        if (chapterTitle && slug) chapters.push({ chapterTitle, chapterEndpoint: slug });
      });

      return res.status(200).json({ title, cover, synopsis, chapters: chapters.reverse() });
    }

    // --- Gambar chapter ---
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

// … sebelumnya tetap sama
if (type === 'search' && Q) {
  const { data } = await axios.get(`${BASE}/?s=${encodeURIComponent(Q)}`);
  const $ = cheerio.load(data);
  const results = [];
  $('.listupd .utao').each((i, el) => {
    const title = $(el).find('.luf a h3').text().trim();
    const slug = $(el).find('.imgu a').attr('href')?.split('/')[4];
    const cover = $(el).find('.imgu a img').attr('data-src');
    const chapter = $(el).find('.luf ul li:first-child a').text().trim();
    if (title && slug) results.push({ title, chapter, cover, endpoint: slug });
  });
  return res.json({ results });
}

if (type === 'recommend') {
  const { data } = await axios.get(BASE);
  const $ = cheerio.load(data);
  const recommendations = [];
  $('.listupd .utao').slice(0, 5).each((i, el) => {
    const title = $(el).find('.luf a h3').text().trim();
    const slug = $(el).find('.imgu a').attr('href')?.split('/')[4];
    const cover = $(el).find('.imgu a img').attr('data-src');
    const chapter = $(el).find('.luf ul li:first-child a').text().trim();
    if (title && slug) recommendations.push({ title, chapter, cover, endpoint: slug });
  });
  return res.json({ recommendations });
}

if (type === 'popular') {
  const { data } = await axios.get(BASE);
  const $ = cheerio.load(data);
  const popular = [];
  $('#slider .item').each((i, el) => {
    const title = $(el).find('img').attr('alt');
    const slug = $(el).find('a').attr('href')?.split('/')[4];
    const cover = $(el).find('img').attr('src');
    if (title && slug) popular.push({ title, cover, endpoint: slug });
  });
  return res.json({ popular });
}

if (type === 'genre') {
  const { data } = await axios.get(`${BASE}/genres/`);
  const $ = cheerio.load(data);
  const genres = [];
  $('.genrez li a').each((i, el) => {
    const name = $(el).text().trim();
    const href = $(el).attr('href');
    const slug = href?.split('/genres/')[1]?.split('/')[0];
    if (name && slug) genres.push({ name, slug });
  });
  return res.json({ genres });
}
