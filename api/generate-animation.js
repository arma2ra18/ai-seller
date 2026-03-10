import { IncomingForm } from 'formidable';
import fs from 'fs';
import admin from 'firebase-admin';

// Firebase Admin SDK (та же инициализация)
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
        maxDuration: 300, // Увеличиваем время до 300 секунд (5 минут) для видео
    },
};

/**
 * Генерация видео через WaveSpeed API v1
 */
async function generateVideo(imageBuffer, prompt) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY not set');
    }

    // Создаем FormData для отправки файла
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    formData.append('image', blob, 'product.jpg');
    formData.append('prompt', prompt);
    formData.append('model', 'wan-2.1-image-to-video');
    formData.append('duration', '5');
    formData.append('aspect_ratio', '1:1');
    formData.append('resolution', '720p');

    // Отправляем запрос на генерацию 
    const response = await fetch('https://api.wavespeed.ai/v1/predictions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('WaveSpeed response:', response.status, error);
        throw new Error(`WaveSpeed generation error: ${response.status} ${error}`);
    }

    const result = await response.json();
    
    // Polling для получения результата 
    let videoUrl = null;
    const predictionId = result.id;
    const maxAttempts = 150; // максимум 150 попыток (примерно 5 минут)
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const statusResponse = await fetch(`https://api.wavespeed.ai/v1/predictions/${predictionId}`, {
            headers: {
                'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            },
        });
        
        if (!statusResponse.ok) {
            throw new Error(`Failed to check status: ${statusResponse.status}`);
        }
        
        const status = await statusResponse.json();
        console.log(`Status check ${attempt + 1}:`, status.status);
        
        if (status.status === 'completed') {
            videoUrl = status.output;
            break;
        } else if (status.status === 'failed') {
            throw new Error(`Generation failed: ${status.error || 'Unknown error'}`);
        }
        
        // Ждем 2 секунды перед следующей проверкой 
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    if (!videoUrl) {
        throw new Error('Generation timeout');
    }
    
    return videoUrl;
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
        const animationType = fields.animationType?.[0] || 'cinematic';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Получаем загруженное фото
        let imageBuffer = null;
        if (files.photo) {
            const photoFile = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            imageBuffer = fs.readFileSync(photoFile.filepath);
            console.log(`Loaded reference image: ${photoFile.originalFilename}`);
        } else {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Промпт для анимации
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

        console.log('Starting video generation with WaveSpeed...');
        
        // Генерируем видео
        const waveSpeedVideoUrl = await generateVideo(imageBuffer, prompt);
        
        console.log('Video generated, downloading...');
        
        // Скачиваем видео и загружаем в Firebase Storage
        const videoResponse = await fetch(waveSpeedVideoUrl);
        if (!videoResponse.ok) {
            throw new Error(`Failed to download video: ${videoResponse.status}`);
        }
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        
        const videoFileName = `animation_${Date.now()}.mp4`;
        const file = bucket.file(`animations/${videoFileName}`);
        await file.save(videoBuffer, {
            metadata: { contentType: 'video/mp4' },
            public: true,
        });
        
        const publicVideoUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
        
        // Удаляем временный файл изображения
        if (files.photo) {
            const photoFile = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            if (photoFile.filepath && fs.existsSync(photoFile.filepath)) {
                fs.unlinkSync(photoFile.filepath);
            }
        }

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