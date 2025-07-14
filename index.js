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

// Simple logging function
const log = (level, message, extra = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, extra);
};

const app = express();
const port = process.env.PORT || 5000;
const IMAGE_QUALITY = parseInt(process.env.IMAGE_QUALITY) || 85;
const IMAGE_WIDTH = parseInt(process.env.IMAGE_WIDTH) || 800;
const IMAGE_HEIGHT = parseInt(process.env.IMAGE_HEIGHT) || 500;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;
const upload = multer({ 
    dest: 'uploads/',
    limits: { 
        fileSize: MAX_FILE_SIZE,
        files: 20 
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Дозволені лише зображення (JPEG, JPG, PNG, WebP)'));
        }
    }
});

app.use(express.static('public'));
app.use('/processed', express.static('processed'));
app.use('/archives', express.static('archives'));
app.use(bodyParser.json());

['uploads', 'processed', 'archives'].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

app.post('/upload', (req, res) => {
    upload.array('images', 20)(req, res, async (err) => {
        if (err) {
            log('error', 'Upload error', { error: err.message });
            return res.status(400).json({ error: err.message });
        }
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Будь ласка, оберіть файли' });
        }
        
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
                .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { 
                    fit: 'cover', 
                    position: 'center',
                    withoutEnlargement: true
                })
                .webp({ 
                    quality: IMAGE_QUALITY,
                    effort: 6 
                })
                .toFile(outputPath);

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
            log('error', 'Processing error', { error: error.message, stack: error.stack });
            res.status(500).json({ error: 'Помилка обробки зображень' });
        }
    });
});

app.post('/paraphrase', async (req, res) => {
    const { titles, contents, fileNames } = req.body;

    if (!Array.isArray(titles) || !Array.isArray(contents) || titles.length !== contents.length) {
        return res.status(400).json({ error: 'Невірний формат даних' });
    }
    
    if (!openaiApiKey) {
        log('warning', 'OpenAI API ключ не налаштований, використовуємо fallback режим');
        // Fallback mode - return original content with image paths
        const htmlBlocks = [];
        for (let i = 0; i < titles.length; i++) {
            const imageName = fileNames?.[i] || 'default.webp';
            const htmlTemplate = `
<h2>${titles[i]}</h2>
<p class="ptovar">${contents[i]}</p>
<p style="text-align: center;">
  <img alt="" src="/seo_images/pictures/gadgets//${imageName}" style="width: 800px;" loading="lazy">
</p>`;
            htmlBlocks.push(htmlTemplate);
        }
        return res.json({ htmlBlocks });
    }

    try {
        const htmlBlocks = [];

        for (let i = 0; i < titles.length; i++) {
            const imageName = fileNames?.[i] || 'default.webp';

            const htmlTemplate = `
<h2>${titles[i]}</h2>
<p class="ptovar">${contents[i]}</p>
<p style="text-align: center;">
  <img alt="" src="/seo_images/pictures/gadgets//${imageName}" style="width: 800px;" loading="lazy">
</p>`;

            const prompt = `Ты эксперт по переводу и адаптации текстов для русскоязычной аудитории. 

Твоя задача:
1. Переведи текст на естественный русский язык, избегая буквального перевода
2. Адаптируй текст для российского рынка (например, используй привычные термины и обороты)
3. Сделай текст более живым и продающим, но сохрани фактическую информацию
4. Сохрани всю HTML-разметку и структуру полностью без изменений
5. Ответ верни ТОЛЬКО в виде HTML-кода, без комментариев и объяснений

Исходный текст:
${htmlTemplate}`;

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${openaiApiKey}`,
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: 'Ты — эксперт по переводу и адаптации текстов. Переводи естественно, избегая буквального перевода. Адаптируй под русскоязычную аудиторию. Сохраняй HTML-разметку полностью.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.8,
                }),
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                log('error', `OpenAI API помилка ${response.status}`, { responseText: errorText });
                throw new Error(`OpenAI API помилка: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            if (data.error) {
                log('error', 'OpenAI API error', { error: data.error });
                htmlBlocks.push('❌ Помилка в обробці цього блоку');
                continue;
            }

            const rawHtml = data.choices?.[0]?.message?.content?.trim() || '...';
            htmlBlocks.push(rawHtml);
        }

        res.json({ htmlBlocks });
    } catch (error) {
        log('error', 'Paraphrase error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Помилка при запиті до OpenAI' });
    }
});

// Cleanup function for old files
const cleanupOldFiles = () => {
    const dirs = ['uploads', 'processed', 'archives'];
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) return;
        
        fs.readdir(dir, (err, files) => {
            if (err) return;
            
            files.forEach(file => {
                const filePath = path.join(dir, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) return;
                    
                    if (Date.now() - stats.mtime.getTime() > maxAge) {
                        fs.unlink(filePath, (err) => {
                            if (!err) log('info', `Очищено старий файл: ${filePath}`);
                        });
                    }
                });
            });
        });
    });
};

// Run cleanup every hour
setInterval(cleanupOldFiles, 60 * 60 * 1000);
cleanupOldFiles(); // Initial cleanup

app.listen(port, () => {
    log('info', `Сервер запущено на порту ${port}`);
    console.log(`🚀 Сервер запущено: http://localhost:${port}`);
});
