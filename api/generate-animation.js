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
        maxDuration: 300,
    },
};

/**
 * Генерация видео через WaveSpeed API
 */
async function generateVideo(imageBuffer, prompt, duration = 5) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY not set');
    }

    // Конвертируем изображение в base64
    const imageBase64 = imageBuffer.toString('base64');

    // Отправляем JSON запрос
    const response = await fetch('https://api.wavespeed.ai/v1/image-to-video', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'wan-2.6-flash',
            image: imageBase64,
            prompt: prompt,
            duration: duration,
            resolution: '720p',
            audio: false
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('WaveSpeed response:', response.status, error);
        throw new Error(`WaveSpeed generation error: ${response.status} ${error}`);
    }

    const result = await response.json();
    console.log('Generation started:', result);
    
    // Получаем ID задачи
    const taskId = result.task_id || result.id;
    
    if (!taskId) {
        throw new Error('No task ID returned');
    }
    
    // Polling для получения результата
    let videoUrl = null;
    const maxAttempts = 90;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const statusResponse = await fetch(`https://api.wavespeed.ai/v1/image-to-video/${taskId}`, {
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
            videoUrl = status.output?.video || status.video_url || status.output;
            break;
        } else if (status.status === 'failed') {
            throw new Error(`Generation failed: ${status.error || 'Unknown error'}`);
        }
        
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
            
            fs.unlinkSync(photoFile.filepath);
        } else {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Промпт для анимации
        const prompt = `Create a 5-second cinematic product animation. 
The product is "${productName}" by brand ${brand}. Price: ${price} ₽. Features: ${userFeatures.join(', ')}.

The animation should:
- Smoothly rotate the product 360 degrees
- Have floating text elements: product name, price, and feature badges
- Include gentle camera movement
- End with the product in a "hero shot" position
- Style: luxurious, modern, photorealistic

Animation type: ${animationType}`;

        console.log('Starting video generation with WaveSpeed...');
        
        const waveSpeedVideoUrl = await generateVideo(imageBuffer, prompt, 5);
        
        console.log('Video generated, downloading...');
        
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