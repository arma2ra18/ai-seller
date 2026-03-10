import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

// Используем ту же инициализацию Firebase Admin, что и в generate-card.js
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
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация видео через Veo 3.1
 */
async function generateVideo(prompt, referenceImage) {
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

        // Используем модель Veo 3.1 для генерации видео
        const response = await ai.models.generateContent({
            model: 'veo-3.1-generate-preview', // Специальная модель для видео
            contents: contents,
            config: {
                responseModalities: ['Video'],
                aspectRatio: '9:16', // Вертикальный формат для соцсетей
                durationSeconds: 8,   // Максимальная длительность
            }
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
        throw new Error('Ответ не содержит видео');
    } catch (error) {
        console.error('Veo generation error:', error);
        throw error;
    }
}

/**
 * Загружает видео в Firebase Storage и возвращает публичный URL.
 */
async function uploadToStorage(base64Data, fileName) {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 data');
    }
    const mimeType = matches[1];
    const base64 = matches[2];
    const buffer = Buffer.from(base64, 'base64');

    const file = bucket.file(`videos/${fileName}`);
    await file.save(buffer, {
        metadata: { contentType: mimeType },
        public: true,
    });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`Uploaded video to Storage: ${publicUrl}`);
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
        if (files.videoPhoto) { // В форме video.html у нас id="videoPhoto"
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
                console.log(`Loaded reference image: ${photoArray[0].originalFilename}`);
            }
        }
        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Базовый промпт для видео, используем тип видео
        const basePrompt = customPrompt || 
            `Create a dynamic product video for ${productName}. Show the product rotating smoothly, with soft studio lighting, highlighting its best features. Cinematic style, high quality, 8 seconds.`;

        const variations = [
            basePrompt,
            `${basePrompt} (Slow motion, elegant reveal)`,
            `${basePrompt} (360-degree view with subtle glow)`
        ];

        const videos = [];
        // Генерируем видео (Veo работает медленнее, поэтому только 1 вариант)
        try {
            console.log('Generating video...');
            const videoDataUrl = await generateVideo(variations[0], referenceBuffer);
            
            // Загружаем в Storage
            const fileName = `video_${Date.now()}.mp4`;
            const publicUrl = await uploadToStorage(videoDataUrl, fileName);
            videos.push(publicUrl);
            
            console.log('Video generated and uploaded');
        } catch (err) {
            console.error('❌ Ошибка при генерации видео:', err);
        }

        if (videos.length === 0) {
            throw new Error('Не удалось сгенерировать видео');
        }

        // Удаляем временные файлы
        if (files.videoPhoto) {
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Успешно сгенерировано видео');
        res.status(200).json({ videos });
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}