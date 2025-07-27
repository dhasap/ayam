const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://komikcast.li';
const axiosOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Referer': BASE + '/'
  }
};

module.exports = async (req, res) => {
  const { type, endpoint, page = 1 } = req.query;

  try {
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

        if (title && slug) {
          comics.push({ title, chapter, cover, endpoint: slug });
        }
      });

      return res.status(200).json({ comics });
    }

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
        chapters.push({ chapterTitle, chapterEndpoint: slug });
      });

      return res.status(200).json({ title, cover, synopsis, chapters: chapters.reverse() });
    }

    if (type === 'chapter' && endpoint) {
      const url = `${BASE}/chapter/${endpoint}/`;
      const { data } = await axios.get(url, axiosOptions);
      const $ = cheerio.load(data);
      const images = [];

      $('.main-reading-area img').each((i, el) => {
        const src = $(el).attr('src');
        if (src) images.push(src);
      });

      return res.status(200).json({ images });
    }

    res.status(400).json({ error: 'Invalid type or missing endpoint.' });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong.', message: err.message });
  }
};
