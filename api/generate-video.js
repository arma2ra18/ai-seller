import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import GIFEncoder from 'gifencoder';
import { createCanvas, loadImage } from 'canvas';

// Инициализация Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountEnv) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
    }
    const serviceAccount = JSON.parse(serviceAccountEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    console.log('Firebase Admin initialized successfully (generate-video)');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    throw new Error(`Firebase init failed: ${error.message}`);
  }
}
const bucket = admin.storage().bucket();

export const config = {
    api: {
        bodyParser: false,
        maxDuration: 60, // 60 секунд достаточно
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация одного изображения через Gemini
 */
async function generateGeminiImage(prompt, referenceImage) {
    try {
        const base64Image = referenceImage.toString('base64');
        const contents = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            },
            prompt
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: contents,
            config: {
                responseModalities: ['Image'],
                aspectRatio: '1:1',
            }
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const base64Data = part.inlineData.data;
                const buffer = Buffer.from(base64Data, 'base64');
                return buffer;
            }
        }
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini generation error:', error);
        throw error;
    }
}

/**
 * Создание GIF из массива буферов изображений
 */
async function createGIF(imageBuffers, outputPath) {
    const encoder = new GIFEncoder(1024, 1024);
    const stream = encoder.createReadStream().pipe(fs.createWriteStream(outputPath));

    encoder.start();
    encoder.setRepeat(0); // Бесконечное повторение
    encoder.setDelay(200); // 200 мс между кадрами (5 кадров в секунду)
    encoder.setQuality(10); // Качество GIF

    for (const buffer of imageBuffers) {
        const image = await loadImage(buffer);
        const canvas = createCanvas(1024, 1024);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, 1024, 1024);
        encoder.addFrame(ctx);
    }

    encoder.finish();
    
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

/**
 * Загружает видео/GIF в Firebase Storage и возвращает публичный URL
 */
async function uploadToStorage(filePath, fileName, mimeType = 'image/gif') {
    const file = bucket.file(`videos/${fileName}`);
    await bucket.upload(filePath, {
        destination: `videos/${fileName}`,
        metadata: { contentType: mimeType },
    });
    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/videos/${fileName}`;
    console.log(`✅ Uploaded to Storage: ${publicUrl}`);
    return publicUrl;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('❌ GOOGLE_API_KEY not set');
        return res.status(500).json({ error: 'GOOGLE_API_KEY not set' });
    }

    try {
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || 'товар';
        const videoType = fields.videoType?.[0] || 'standard';
        const customPrompt = fields.customPrompt?.[0] || '';

        let referenceBuffer = null;
        if (files.videoPhoto) {
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
                console.log(`📸 Loaded reference image: ${photoArray[0].originalFilename}`);
            }
        }
        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Генерируем 8 кадров с разных ракурсов
        const prompts = [];
        for (let i = 0; i < 8; i++) {
            let angle = i * 45; // Поворот на 45 градусов каждый кадр
            let prompt = `Профессиональное фото товара "${productName}" с угла ${angle} градусов. Студийное освещение, белый фон, высокое качество, 8k. Товар занимает 80% кадра.`;
            
            if (videoType === '360') {
                prompt = `Товар "${productName}", вид с угла ${angle} градусов. Полный оборот, студийная съемка, белый фон, высокая детализация.`;
            } else if (videoType === 'slowmotion') {
                prompt = `Элегантная демонстрация товара "${productName}" с угла ${angle} градусов. Мягкий свет, премиальный стиль, белый фон.`;
            }
            
            prompts.push(prompt);
        }

        console.log('🎬 Генерация кадров анимации...');
        
        // Генерируем все кадры параллельно
        const frameBuffers = [];
        for (let i = 0; i < prompts.length; i++) {
            console.log(`Генерация кадра ${i+1}/${prompts.length}...`);
            try {
                const imageBuffer = await generateGeminiImage(prompts[i], referenceBuffer);
                frameBuffers.push(imageBuffer);
            } catch (err) {
                console.error(`Ошибка генерации кадра ${i+1}:`, err);
                // Если не удалось сгенерировать кадр, используем предыдущий
                if (frameBuffers.length > 0) {
                    frameBuffers.push(frameBuffers[frameBuffers.length - 1]);
                }
            }
        }

        if (frameBuffers.length < 3) {
            throw new Error('Не удалось сгенерировать достаточно кадров');
        }

        // Создаём GIF
        console.log('🎨 Создание GIF анимации...');
        const gifPath = `/tmp/animation_${Date.now()}.gif`;
        await createGIF(frameBuffers, gifPath);

        // Загружаем в Storage
        const fileName = `animation_${Date.now()}.gif`;
        const publicUrl = await uploadToStorage(gifPath, fileName, 'image/gif');

        // Удаляем временные файлы
        fs.unlinkSync(gifPath);
        if (files.videoPhoto) {
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Анимация создана и загружена');
        res.status(200).json({ videos: [publicUrl] });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
}