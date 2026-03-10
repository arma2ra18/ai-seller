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
        maxDuration: 120, // Увеличиваем время до 120 секунд для видео
    },
};

/**
 * Загружает изображение в WaveSpeed и получает URL для генерации
 */
async function uploadToWaveSpeed(imageBase64) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY not set');
    }

    // WaveSpeed ожидает base64 изображения в определенном формате [citation:3]
    const response = await fetch('https://api.wavespeed.ai/api/v3/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            image: imageBase64 // Передаем base64 напрямую
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`WaveSpeed upload error: ${response.status} ${error}`);
    }

    const result = await response.json();
    return result.image_url; // WaveSpeed возвращает временный URL для использования в генерации
}

/**
 * Генерация видео через WaveSpeed API
 */
async function generateVideo(imageUrl, prompt, duration = 5) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    // Используем правильный эндпоинт для image-to-video [citation:3][citation:9]
    const response = await fetch('https://api.wavespeed.ai/api/v3/predictions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'wan-ai/wan-2.1-i2v-720p', // Правильный ID модели для Wan 2.1 Image-to-Video [citation:9]
            input: {
                image_url: imageUrl,
                prompt: prompt,
                duration: duration, // 5 секунд
                negative_prompt: "distortion, blurry, shaking camera, low quality"
            }
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`WaveSpeed generation error: ${response.status} ${error}`);
    }

    const result = await response.json();
    
    // Polling для получения результата [citation:3]
    let videoUrl = null;
    const taskId = result.id;
    const maxAttempts = 60; // максимум 60 попыток (примерно 120 секунд)
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const statusResponse = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${taskId}`, {
            headers: {
                'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            },
        });
        
        if (!statusResponse.ok) {
            throw new Error(`Failed to check status: ${statusResponse.status}`);
        }
        
        const status = await statusResponse.json();
        
        if (status.status === 'completed') {
            videoUrl = status.outputs[0];
            break;
        } else if (status.status === 'failed') {
            throw new Error(`Generation failed: ${status.error || 'Unknown error'}`);
        }
        
        // Ждем 2 секунды перед следующей проверкой [citation:4]
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

        // Получаем загруженное фото и конвертируем в base64
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

        console.log('Uploading image to WaveSpeed...');
        
        // Загружаем изображение в WaveSpeed
        const imageUrl = await uploadToWaveSpeed(imageBase64);
        
        console.log('Generating animation...');
        
        // Генерируем видео
        const waveSpeedVideoUrl = await generateVideo(imageUrl, prompt, 5);
        
        // Скачиваем видео и загружаем в Firebase Storage
        console.log('Downloading generated video...');
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