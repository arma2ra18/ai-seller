import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

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
        maxDuration: 300, // Увеличиваем до 5 минут для Vercel Pro
    },
};

const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Конвертирует base64 в Buffer и загружает в Storage
 */
async function uploadToStorage(base64Data, fileName, mimeType = 'video/mp4') {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 data');
    }
    const base64 = matches[2];
    const buffer = Buffer.from(base64, 'base64');

    const file = bucket.file(`videos/${fileName}`);
    await file.save(buffer, {
        metadata: { contentType: mimeType },
        public: true,
    });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`✅ Uploaded video to Storage: ${publicUrl}`);
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

        // Конвертируем изображение в base64 для отправки в API
        const base64Image = referenceBuffer.toString('base64');
        const mimeType = 'image/jpeg';

        // Промпты для разных типов видео
        const prompts = {
            standard: `Create a professional product showcase video of ${productName}. Smooth rotation, studio lighting, high quality, cinematic.`,
            '360': `Create a 360-degree rotating product video of ${productName}. Smooth rotation showing all angles, premium quality.`,
            slowmotion: `Create a slow-motion elegant product video of ${productName}. Smooth floating movement, soft lighting, luxurious feel.`
        };

        const finalPrompt = customPrompt || prompts[videoType] || prompts.standard;

        console.log('🎬 Starting video generation with Veo 3.1...');

        // ИСПОЛЬЗУЕМ ПРАВИЛЬНУЮ МОДЕЛЬ Veo 3.1 [citation:3][citation:7]
        const operation = await client.models.generate_videos(
            model: 'veo-3.1-generate-preview', // Новая модель для видео
            prompt: finalPrompt,
            image: base64Image,
            mime_type: mimeType,
            config: {
                aspect_ratio: '9:16', // Вертикальный формат для соцсетей
                duration_seconds: 8,   // Максимум 8 секунд [citation:2]
                resolution: '1080p',
                generate_audio: true,   // Включаем звук [citation:3]
            }
        );

        console.log('⏳ Waiting for video generation...');
        
        // Polling для проверки статуса (может занять 1-5 минут) [citation:1][citation:7]
        let attempts = 0;
        const maxAttempts = 60; // 5 минут с интервалом 5 секунд
        let videoData = null;

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Ждём 5 секунд
            const status = await client.operations.get(operation.name);
            
            console.log(`Status: ${status.done ? 'completed' : 'in progress'} (attempt ${attempts + 1})`);
            
            if (status.done) {
                if (status.error) {
                    throw new Error(`Video generation failed: ${status.error.message}`);
                }
                // Получаем сгенерированное видео
                const response = status.response;
                if (response.generated_videos && response.generated_videos.length > 0) {
                    videoData = response.generated_videos[0].video;
                    break;
                }
            }
            attempts++;
        }

        if (!videoData) {
            throw new Error('Video generation timeout after 5 minutes');
        }

        // Сохраняем видео на диск (временный файл)
        const tempVideoPath = `/tmp/video_${Date.now()}.mp4`;
        fs.writeFileSync(tempVideoPath, videoData);

        // Читаем как base64 для загрузки в Storage
        const videoBuffer = fs.readFileSync(tempVideoPath);
        const videoBase64 = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;

        // Загружаем в Firebase Storage
        const fileName = `video_${Date.now()}.mp4`;
        const publicUrl = await uploadToStorage(videoBase64, fileName, 'video/mp4');

        // Удаляем временные файлы
        fs.unlinkSync(tempVideoPath);
        if (files.videoPhoto) {
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Video generated and uploaded successfully');
        res.status(200).json({ videos: [publicUrl] });

    } catch (error) {
        console.error('❌ Error in video generation:', error);
        res.status(500).json({ error: error.message });
    }
}