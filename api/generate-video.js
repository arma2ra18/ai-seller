import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

// Используем ту же инициализацию Firebase Admin
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
 * Генерация анимированного изображения (GIF) через Gemini
 */
async function generateAnimatedImage(prompt, referenceImage) {
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
            model: 'gemini-2.0-flash-exp-image-generation',
            contents: contents,
            config: {
                responseModalities: ['Image'],
                aspectRatio: '9:16',
            }
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini animation error:', error);
        throw error;
    }
}

/**
 * Загружает файл в Firebase Storage и возвращает публичный URL.
 */
async function uploadToStorage(base64Data, fileName, mimeType = 'image/gif') {
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
    console.log(`Uploaded to Storage: ${publicUrl}`);
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
                console.log(`Loaded reference image: ${photoArray[0].originalFilename}`);
            }
        }
        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Промпты для разных типов видео
        const prompts = {
            standard: `Create a smooth rotating animation of ${productName}. 360-degree view, studio lighting, product showcase, cinematic quality, animated GIF.`,
            '360': `Create a 360-degree rotating animation of ${productName}. The product rotates smoothly, showing all angles, professional product photography style, animated GIF.`,
            slowmotion: `Create a slow-motion style animation of ${productName}. Elegant reveal, soft lighting, premium feel, floating effect, animated GIF.`
        };

        const selectedPrompt = customPrompt || prompts[videoType] || prompts.standard;
        
        // Добавляем указание на создание анимации
        const finalPrompt = `${selectedPrompt} The result should be an animated image (GIF) with 8 frames, smooth transition.`;

        let videoUrl;
        try {
            console.log('Generating animation...');
            const imageDataUrl = await generateAnimatedImage(finalPrompt, referenceBuffer);
            
            // Загружаем в Storage как GIF
            const fileName = `video_${Date.now()}.gif`;
            videoUrl = await uploadToStorage(imageDataUrl, fileName, 'image/gif');
            
            console.log('Animation generated and uploaded');
        } catch (err) {
            console.error('❌ Ошибка при генерации анимации:', err);
            throw new Error('Не удалось сгенерировать анимацию');
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
        res.status(200).json({ videos: [videoUrl] });
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}