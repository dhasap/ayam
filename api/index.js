const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const serverless = require('serverless-http');

const app = express();
const KOMIKCAST_URL = 'https://komikcast.li';

const axiosOptions = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
        'Referer': 'https://komikcast.li/'
    }
};

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    next();
});

// RUTE 1: Komik Terbaru
app.get('/latest', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const url = `${KOMIKCAST_URL}/?page=${page}`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const comics = [];

        $('div.listupd .utao').each((i, element) => {
            const el = $(element);
            const title = el.find('.luf a h3').text().trim();
            const fullUrl = el.find('.imgu a').attr('href');
            const cover = el.find('.imgu a img').attr('data-src');
            const chapter = el.find('.luf ul li:first-child a').text().trim();
            const endpoint = fullUrl ? fullUrl.split('/')[4] : null;

            if (title && endpoint) {
                comics.push({ title, chapter, cover, endpoint, source: 'komikcast' });
            }
        });
        res.json({ comics });
    } catch (error) {
        res.status(500).json({ message: 'Gagal scrape latest.', error: error.message });
    }
});

// RUTE 2: Detail Komik
app.get('/detail/:endpoint', async (req, res) => {
    try {
        const { endpoint } = req.params;
        const url = `${KOMIKCAST_URL}/komik/${endpoint}/`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);

        const title = $('h1.komik_info-content-body-title').text().trim();
        const cover = $('.komik_info-content-thumbnail img').attr('src');
        const synopsis = $('.komik_info-description-sinopsis p').text().trim();
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
        res.json({ title, cover, synopsis, chapters: chapters.reverse() });
    } catch (error) {
        res.status(500).json({ message: 'Gagal scrape detail.', error: error.message });
    }
});

// RUTE 3: Gambar Chapter
app.get('/chapter/:endpoint', async (req, res) => {
    try {
        const { endpoint } = req.params;
        const url = `${KOMIKCAST_URL}/chapter/${endpoint}/`;
        const { data } = await axios.get(url, axiosOptions);
        const $ = cheerio.load(data);
        const images = [];

        $('.main-reading-area img').each((i, element) => {
            const imageUrl = $(element).attr('src');
            if (imageUrl) {
                images.push(imageUrl.trim());
            }
        });

        res.json({ images });
    } catch (error) {
        res.status(500).json({ message: 'Gagal scrape chapter.', error: error.message });
    }
});

// EXPORT BUAT VERCEL
module.exports = app;
module.exports.handler = serverless(app);
