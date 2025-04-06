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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
const openaiApiKey = process.env.OPENAI_API_KEY;

const app = express();
const port = 5000;
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use('/processed', express.static('processed'));
app.use('/archives', express.static('archives'));
app.use(bodyParser.json());

['uploads', 'processed', 'archives'].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

app.post('/upload', upload.array('images', 20), async (req, res) => {
    try {
        const processedFiles = [];
        const fileNames = [];
        const archiveName = `archives/${Date.now()}.zip`;

        const baseRawName = req.body.baseName || 'Image';
        const safeBaseName = baseRawName.trim().replace(/\s+/g, '_');

        await Promise.all(req.files.map(async (file, index) => {
            const outputFile = `${safeBaseName}_${index + 1}.webp`;
            const outputPath = `processed/${outputFile}`;

            await sharp(file.path)
                .resize(800, 500, { fit: 'cover', position: 'center' })
                .toFormat('webp')
                .toFile(outputPath);

            // ⏳ Додаємо затримку перед видаленням
            await new Promise(resolve => setTimeout(resolve, 200));

            // 🧯 Безпечне видалення з try/catch
            try {
                await fs.promises.unlink(file.path);
            } catch (err) {
                console.warn(`⚠️ Не вдалося видалити ${file.path}:`, err.message);
            }

            processedFiles.push(outputPath);
            fileNames.push(outputFile);
        }));

        const output = fs.createWriteStream(archiveName);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.pipe(output);
        processedFiles.forEach(file => archive.file(file, { name: path.basename(file) }));
        await archive.finalize();

        res.json({ archive: `/${archiveName}`, fileNames });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Помилка обробки зображень' });
    }
});

app.post('/paraphrase', async (req, res) => {
    const { titles, contents, fileNames } = req.body;

    if (!Array.isArray(titles) || !Array.isArray(contents) || titles.length !== contents.length) {
        return res.status(400).json({ error: 'Невірний формат даних' });
    }

    try {
        const htmlBlocks = [];

        for (let i = 0; i < titles.length; i++) {
            const imageName = fileNames?.[i] || 'default.webp';

            const htmlTemplate = `
<h2>${titles[i]}</h2>
<p class="ptovar">${contents[i]}</p>
<p style="text-align: center;">
  <img alt="" src="/seo_images/pictures/gadgets/${imageName}" style="width: 800px;" loading="lazy">
</p>`;

            const prompt = `Перефразируй текст внутри HTML-тегов. Сохрани всю разметку и структуру. Ответ верни как HTML. Пиши только на русском языке.\n\n${htmlTemplate}`;

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: 'Ты — помощник по перефразированию HTML-контента. Сохраняй структуру и пиши только на русском языке.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                }),
            });

            const data = await response.json();

            if (data.error) {
                console.error(`OpenAI error:`, data.error);
                htmlBlocks.push('❌ Помилка в обробці цього блоку');
                continue;
            }

            const rawHtml = data.choices?.[0]?.message?.content?.trim() || '...';
            htmlBlocks.push(rawHtml);
        }

        res.json({ htmlBlocks });
    } catch (error) {
        console.error('Помилка перефразування:', error);
        res.status(500).json({ error: 'Помилка при запиті до OpenAI' });
    }
});

app.listen(port, () => {
    console.log(`🚀 Сервер запущено: http://localhost:${port}`);
});
