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
        maxDuration: 180, // 3 минуты на генерацию видео
    },
};

/**
 * Генерация видео через WaveSpeed API с моделью WAN 2.6 Flash
 */
async function generateVideo(imageBuffer, prompt, duration = 5) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY not set');
    }

    // Создаем FormData для отправки файла
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
    formData.append('image', blob, 'product.jpg');
    formData.append('model', 'alibaba/wan-2.6/image-to-video-flash'); // Правильная модель
    formData.append('prompt', prompt);
    formData.append('duration', duration.toString());
    formData.append('resolution', '720p'); // Можно сделать выбор в будущем
    formData.append('shot_type', 'single'); // Один непрерывный кадр
    formData.append('enable_audio', 'false'); // Аудио не нужно
    formData.append('enable_prompt_expansion', 'true'); // Авто-улучшение промпта

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
    console.log('Generation started:', result);
    
    // Polling для получения результата
    let videoUrl = null;
    const predictionId = result.id;
    const maxAttempts = 60; // максимум 60 попыток (примерно 2 минуты)
    
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
            // URL может быть в разных полях
            videoUrl = status.output?.video || status.output?.url || status.output;
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

        console.log('Starting video generation with WaveSpeed...');
        
        // Генерируем видео (5 секунд, 720p, без аудио)
        const waveSpeedVideoUrl = await generateVideo(imageBuffer, prompt, 5);
        
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