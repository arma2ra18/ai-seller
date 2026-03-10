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
        maxDuration: 300, // 5 минут для Vercel Pro
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Загружает видео в Firebase Storage и возвращает публичный URL
 */
async function uploadToStorage(videoBuffer, fileName, mimeType = 'video/mp4') {
    const file = bucket.file(`videos/${fileName}`);
    await file.save(videoBuffer, {
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

        // Конвертируем изображение в base64
        const base64Image = referenceBuffer.toString('base64');

        // Промпты для разных типов видео
        const prompts = {
            standard: `Create a professional product showcase video of ${productName}. Smooth rotation, studio lighting, high quality, cinematic.`,
            '360': `Create a 360-degree rotating product video of ${productName}. Smooth rotation showing all angles, premium quality.`,
            slowmotion: `Create a slow-motion elegant product video of ${productName}. Smooth floating movement, soft lighting, luxurious feel.`
        };

        const finalPrompt = customPrompt || prompts[videoType] || prompts.standard;

        console.log('🎬 Starting video generation with Veo 3.1...');

        // ===== ИСПРАВЛЕННЫЙ КОД =====
        // Правильный синтаксис согласно документации Google [citation:4][citation:8]
        const operation = await ai.models.generateVideos({
            model: "veo-3.1-generate-preview",
            prompt: finalPrompt,
            config: {
                // Передаём изображение как reference_images
                referenceImages: [{
                    bytes: base64Image,
                    mimeType: 'image/jpeg'
                }],
                aspectRatio: "9:16", // Вертикальный формат для соцсетей
                durationSeconds: 8,
                resolution: "1080p",
                generateAudio: true,
            }
        });

        console.log('⏳ Waiting for video generation to complete...');

        // Polling для проверки статуса [citation:4]
        let attempts = 0;
        const maxAttempts = 30; // 5 минут с интервалом 10 секунд
        let videoData = null;

        while (!operation.done && attempts < maxAttempts) {
            console.log(`Waiting for video generation... (${attempts + 1}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 10000)); // Ждём 10 секунд [citation:4]
            
            // Обновляем статус операции
            const updatedOperation = await ai.operations.getVideosOperation({
                operation: operation,
            });
            operation.done = updatedOperation.done;
            
            if (updatedOperation.done) {
                if (updatedOperation.error) {
                    throw new Error(`Video generation failed: ${updatedOperation.error.message}`);
                }
                // Получаем сгенерированное видео
                if (updatedOperation.response?.generatedVideos?.length > 0) {
                    const videoFile = updatedOperation.response.generatedVideos[0].video;
                    
                    // Скачиваем видео [citation:4]
                    const downloadPath = `/tmp/video_${Date.now()}.mp4`;
                    await ai.files.download({
                        file: videoFile,
                        downloadPath: downloadPath,
                    });
                    
                    // Читаем скачанный файл
                    videoData = fs.readFileSync(downloadPath);
                    
                    // Удаляем временный файл
                    fs.unlinkSync(downloadPath);
                    break;
                }
            }
            attempts++;
        }

        if (!videoData) {
            throw new Error('Video generation timeout after 5 minutes');
        }

        // Загружаем в Firebase Storage
        const fileName = `video_${Date.now()}.mp4`;
        const publicUrl = await uploadToStorage(videoData, fileName, 'video/mp4');

        // Удаляем временные файлы
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