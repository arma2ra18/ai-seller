import { IncomingForm } from 'formidable';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export const config = {
    api: {
        bodyParser: false,
        maxDuration: 60,
    },
};

// Функция для генерации анимации через WaveSpeedAI
async function generateAnimation(imageBase64, prompt) {
    const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
    
    if (!WAVESPEED_API_KEY) {
        throw new Error('WAVESPEED_API_KEY not set');
    }

    const response = await fetch('https://api.wavespeed.ai/v1/generate', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'google-veo-2-image-to-video',
            image: imageBase64,
            prompt: prompt,
            duration: 5,
            resolution: '720p',
            aspect_ratio: '1:1',
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`WaveSpeedAI error: ${error}`);
    }

    const result = await response.json();
    return result.video_url;
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
        const userId = fields.userId?.[0];

        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Проверяем баланс пользователя
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('balance, used_spent')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const cost = 50; // Стоимость анимации
        if (user.balance < cost) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Получаем загруженное фото
        let imageBase64 = null;
        if (files.photo) {
            const photoFile = Array.isArray(files.photo) ? files.photo[0] : files.photo;
            const imageBuffer = fs.readFileSync(photoFile.filepath);
            imageBase64 = imageBuffer.toString('base64');
            
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

        console.log('Generating animation...');
        
        // Генерируем анимацию
        const videoUrl = await generateAnimation(imageBase64, prompt);
        
        // Скачиваем видео
        const videoResponse = await fetch(videoUrl);
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        
        // Загружаем в Supabase Storage
        const videoFileName = `animation_${Date.now()}.mp4`;
        const { error: uploadError } = await supabase
            .storage
            .from('animations')
            .upload(videoFileName, videoBuffer, {
                contentType: 'video/mp4',
                cacheControl: '3600'
            });

        if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        // Получаем публичный URL
        const { data: urlData } = supabase
            .storage
            .from('animations')
            .getPublicUrl(videoFileName);
        
        const publicVideoUrl = urlData.publicUrl;

        // Сохраняем в историю
        await supabase
            .from('generation_sessions')
            .insert({
                user_id: userId,
                product_name: productName,
                brand: brand,
                price: parseInt(price),
                features: userFeatures,
                attempts: 1,
                total_spent: cost,
                images: [publicVideoUrl],
                created_at: new Date().toISOString()
            });

        // Списываем деньги
        await supabase
            .from('users')
            .update({ 
                balance: user.balance - cost,
                used_spent: (user.used_spent || 0) + cost
            })
            .eq('id', userId);

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