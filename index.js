import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ESModule fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
dotenv.config();
const openaiApiKey = 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;

const app = express();
const port = 5000;

const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use('/processed', express.static('processed'));
app.use('/archives', express.static('archives'));
app.use(bodyParser.json());

// Створення папок при запуску
['uploads', 'processed', 'archives'].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.array('images', 20), async (req, res) => {
    try {
        const processedFiles = [];
        const archiveName = `archives/${Date.now()}.zip`;

        await Promise.all(req.files.map(async (file) => {
            const inputPath = file.path;
            const outputPath = `processed/${Date.now()}-${file.originalname}.webp`;

            await sharp(inputPath)
                .resize(800, 500, { fit: 'cover', position: 'center' })
                .toFormat('webp')
                .toFile(outputPath);

            fs.unlinkSync(inputPath);
            processedFiles.push(outputPath);
        }));

        const output = fs.createWriteStream(archiveName);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.pipe(output);
        processedFiles.forEach(file =>
            archive.file(file, { name: path.basename(file) })
        );
        await archive.finalize();

        res.json({ archive: `/${archiveName}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Помилка обробки зображень' });
    }
});

app.post('/paraphrase', async (req, res) => {
    const { title, content } = req.body;

    const prompt = `Перефразируй этот текст на русском языке, сохраняя смысл:\n\nЗаголовок: ${title}\nТекст: ${content}`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "Ты - перефразировщик текста." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
            }),
        });

        const data = await response.json();

        if (data.error) {
            console.error('OpenAI error:', data.error);
            return res.status(500).json({ error: 'Помилка від OpenAI' });
        }

        const paraphrasedText = data.choices[0].message.content.trim();

        const resultHtml = `
            <h2>${title}</h2>
            <p class="ptovar">${paraphrasedText}</p>
            <p style="text-align: center;">
                <img alt="" src="/seo_images/pictures/gadgets/.webp" style="width: 800px;" loading="lazy">
            </p>
            *информация о товаре может изменяться или дополняться производителем без уведомления.
        `;

        res.json({ html: resultHtml });
    } catch (error) {
        console.error('Помилка перефразування:', error);
        res.status(500).json({ error: 'Помилка при запиті до OpenAI' });
    }
});

app.listen(port, () => {
    console.log(`🚀 Сервер запущено: http://localhost:${port}`);
});
