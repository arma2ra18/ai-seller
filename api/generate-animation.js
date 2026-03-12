import { IncomingForm } from 'formidable';
import fs from 'fs';
import admin from 'firebase-admin';

// Firebase Admin SDK (инициализация такая же, как в generate-card.js)
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
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    throw new Error(`Firebase init failed: ${error.message}`);
  }
}
const bucket = admin.storage().bucket();

export const config = {
    api: {
        bodyParser: false,
        maxDuration: 60, // Увеличиваем время для генерации видео
    },
};

// Функция для генерации анимации через WaveSpeedAI
async function generateAnimation(imageBase64, prompt) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY not set');
    }

    // Используем Google Veo 2 (лучший для товарной анимации) [citation:7]
    const response = await fetch('https://api.wavespeed.ai/v1/generate', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'google-veo-2-image-to-video',
            image: imageBase64, // base64 изображения
            prompt: prompt,
            duration: 5, // 5 секунд
            resolution: '720p', // HD качество
            aspect_ratio: '1:1', // Квадрат для карточек
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`WaveSpeedAI error: ${error}`);
    }

    const result = await response.json();
    return result.video_url; // URL сгенерированного видео
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || '';
        const brand = fields.brand?.[0] || '';
        const price = fields.price?.[0] || '1990';
        const userFeatures = (fields.features?.[0] || '').split(',').map(f => f.trim()).filter(Boolean);
        const animationType = fields.animationType?.[0] || 'cinematic'; // тип анимации

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Получаем загруженное фото
        let imageBase64 = null;
        if (files.photo) {
            const photoFile = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            const imageBuffer = fs.readFileSync(photoFile.filepath);
            imageBase64 = imageBuffer.toString('base64');
            
            // Удаляем временный файл
            fs.unlinkSync(photoFile.filepath);
        } else {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Промпт для анимации (адаптированный из нашего ультра-промпта)
        const prompt = `Create a 5-second cinematic product animation for Wildberries. 
The product is "${productName}" by brand ${brand}. Price: ${price} ₽. Features: ${userFeatures.join(', ')}.

The animation should:
- Start with the product appearing with a soft glow
- Smoothly rotate the product 360 degrees to showcase all angles
- Have floating 3D text elements that fade in and out: product name, price, and feature badges
- Include gentle camera movement (slow dolly or orbit)
- Use premium lighting with subtle lens flares
- End with the product in a "hero shot" position with all text elements visible
- Style: luxurious, modern, photorealistic, like a high-end TV commercial

Animation type: ${animationType === 'cinematic' ? 'cinematic with smooth motion' : 'dynamic with more energy'}`;

        console.log('Generating animation...');
        
        // Генерируем анимацию
        const videoUrl = await generateAnimation(imageBase64, prompt);
        
        // Загружаем видео в Firebase Storage для постоянного хранения
        const videoFileName = `animation_${Date.now()}.mp4`;
        const videoResponse = await fetch(videoUrl);
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        
        const file = bucket.file(`animations/${videoFileName}`);
        await file.save(videoBuffer, {
            metadata: { contentType: 'video/mp4' },
            public: true,
        });
        
        const publicVideoUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
        
        console.log('✅ Animation generated and uploaded');

        res.status(200).json({ 
            videoUrl: publicVideoUrl,
            message: 'Animation created successfully' 
        });

    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}