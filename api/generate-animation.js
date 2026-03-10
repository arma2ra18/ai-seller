import { IncomingForm } from 'formidable';
import fs from 'fs';
import admin from 'firebase-admin';

// Firebase Admin SDK (без изменений)
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
 * Загружает файл на WaveSpeed и возвращает временный URL.
 * (Имитация wavespeed.upload из Python SDK)
 */
async function uploadToWaveSpeed(fileBuffer, fileName, mimeType) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    if (!WAVESPEED_API_KEY) throw new Error('WAVESPEED_API_KEY not set');

    // 1. Получаем URL для загрузки (предполагаемый эндпоинт, может отличаться)
    // Вместо этого можно сразу отправлять файл на predictions, если API поддерживает base64.
    // Пока оставим этот шаг как заглушку, но на самом деле многие модели принимают base64 напрямую.
    // Для простоты мы будем отправлять base64 сразу в predictions.
    // Этот метод оставлен для возможной будущей реализации.
    console.log('Upload endpoint simulation - using base64 in main request.');
    return null; // Мы не будем его использовать
}

/**
 * Генерация видео через WaveSpeed API с моделью WAN 2.6 Flash
 */
async function generateVideo(imageBuffer, prompt, duration = 5) {
    const WAVESPEED_API_KEY = process.env.GOOGLE_API_KEY; // ВНИМАНИЕ: проверьте название переменной!
    // Исправлено: используем GOOGLE_API_KEY, так как вы сказали, что он работает.
    // Если у вас отдельный ключ для WaveSpeed, создайте переменную WAVESPEED_API_KEY.

    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY (или GOOGLE_API_KEY) not set');
    }

    // Конвертируем изображение в base64
    const imageBase64 = imageBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${imageBase64}`;

    // Формируем тело запроса в формате, похожем на то, что ожидает API
    const requestBody = {
        // ID модели, как на странице модели
        model: 'alibaba/wan-2.6/image-to-video-flash',
        // Входные данные для модели. Формат может зависеть от модели.
        input: {
            image: dataUrl, // Отправляем как data URL
            prompt: prompt,
            duration: duration,
            resolution: '720p',
            audio: false,
            shot_type: 'single'
        },
        // webhook: null // можно добавить для асинхронного уведомления
    };

    console.log('Sending request to WaveSpeed with body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://api.wavespeed.ai/v1/predictions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('WaveSpeed response error:', response.status, errorText);
        throw new Error(`WaveSpeed generation error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log('Generation started, response:', result);

    // Извлекаем ID предсказания. В разных API это может быть prediction.id или task_id
    const predictionId = result.id || result.prediction_id || result.task_id;
    if (!predictionId) {
        throw new Error('No prediction ID returned from WaveSpeed');
    }

    // Polling для получения результата
    let videoUrl = null;
    const maxAttempts = 90; // ~3 минуты
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

        if (status.status === 'succeeded' || status.status === 'completed') {
            // Извлекаем URL из ответа. Может быть status.output или status.outputs[0]
            videoUrl = status.output?.video || status.output?.url || status.output || (status.outputs && status.outputs[0]);
            break;
        } else if (status.status === 'failed') {
            throw new Error(`Generation failed: ${status.error || 'Unknown error'}`);
        } else if (status.status === 'canceled') {
            throw new Error('Generation was canceled');
        }

        // Ждем перед следующей проверкой
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

            // Удаляем временный файл (можно сделать после генерации, но для экономии места удалим сейчас)
            fs.unlinkSync(photoFile.filepath);
        } else {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Промпт для анимации (немного сократил для надежности)
        const prompt = `Create a 5-second cinematic product animation. 
The product is "${productName}" by brand ${brand}. Price: ${price} ₽. Features: ${userFeatures.join(', ')}.

The animation should:
- Start with the product appearing with a soft glow
- Smoothly rotate the product 360 degrees
- Have floating 3D text elements that fade in and out: product name, price, and feature badges
- Include gentle camera movement
- End with the product in a "hero shot" position
- Style: luxurious, modern, photorealistic

Animation type: ${animationType}.`;

        console.log('Starting video generation with WaveSpeed...');

        // Генерируем видео (5 секунд, 720p, без аудио)
        const waveSpeedVideoUrl = await generateVideo(imageBuffer, prompt, 5);

        console.log('Video generated, downloading from:', waveSpeedVideoUrl);

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

        console.log('✅ Animation generated and uploaded to:', publicVideoUrl);

        res.status(200).json({
            videoUrl: publicVideoUrl,
            message: 'Animation created successfully'
        });

    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}