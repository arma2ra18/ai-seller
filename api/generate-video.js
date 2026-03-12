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
    },
};

const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

// Получение токена доступа
async function getAccessToken(authKey) {
    const response = await fetch(`${GIGACHAT_API_URL}/oauth`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Authorization': `Basic ${authKey}`
        },
        body: 'scope=GIGACHAT_API_PERS'
    });
    const data = await response.json();
    return data.access_token;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const authKey = process.env.GIGACHAT_AUTH_KEY;
    if (!authKey) {
        return res.status(500).json({ error: 'GIGACHAT_AUTH_KEY not set' });
    }

    try {
        // Парсим multipart/form-data
        const form = new IncomingForm({ keepExtensions: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const videoType = fields.videoType?.[0] || fields.videoType || 'standard';
        const prompt = fields.prompt?.[0] || fields.prompt || '';
        const resolution = fields.resolution?.[0] || fields.resolution || '512P';
        const userId = fields.userId?.[0];

        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        // Проверяем баланс
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('balance')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const cost = 100; // Стоимость видео
        if (user.balance < cost) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Получаем загруженное фото
        const photoFile = files.videoPhoto;
        if (!photoFile) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        const photoPath = photoFile.filepath;
        const fileBuffer = fs.readFileSync(photoPath);
        const base64Image = `data:${photoFile.mimetype};base64,${fileBuffer.toString('base64')}`;

        // Получаем access token
        const accessToken = await getAccessToken(authKey);

        // Формируем промпт
        const promptTemplates = {
            'standard': 'Профессиональное видео товара на белом фоне, студийное освещение, плавное вращение',
            '360': 'Товар плавно вращается на 360 градусов, белый фон, детальный обзор',
            'lifestyle': 'Товар используется в естественной обстановке, реалистично, повседневное использование',
            'unboxing': 'Распаковка товара, руки открывают коробку, качественная анимация'
        };
        
        const finalPrompt = prompt || promptTemplates[videoType] || promptTemplates.standard;

        // Вызываем Kandinsky Video Pro через GigaChat API
        const videoResponse = await fetch(`${GIGACHAT_API_URL}/video/generation`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'KandinskyVideoPro',
                prompt: finalPrompt,
                image: base64Image,
                duration: 5,
                resolution: resolution,
                fps: 24
            })
        });

        if (!videoResponse.ok) {
            const errorData = await videoResponse.text();
            throw new Error(`Kandinsky video error: ${errorData}`);
        }

        const videoData = await videoResponse.json();

        // Скачиваем видео и сохраняем в Supabase
        const videoFileResponse = await fetch(videoData.video_url);
        const videoBuffer = Buffer.from(await videoFileResponse.arrayBuffer());

        const fileName = `video_${Date.now()}.mp4`;
        const { error: uploadError } = await supabase
            .storage
            .from('videos')
            .upload(fileName, videoBuffer, {
                contentType: 'video/mp4',
                cacheControl: '3600'
            });

        if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        const { data: urlData } = supabase
            .storage
            .from('videos')
            .getPublicUrl(fileName);

        const publicUrl = urlData.publicUrl;

        // Сохраняем в историю
        await supabase
            .from('generation_sessions')
            .insert({
                user_id: userId,
                product_name: 'Video Generation',
                attempts: 1,
                total_spent: cost,
                images: [publicUrl],
                created_at: new Date().toISOString()
            });

        // Списываем деньги
        await supabase
            .from('users')
            .update({ balance: user.balance - cost })
            .eq('id', userId);

        // Удаляем временный файл
        fs.unlinkSync(photoPath);

        res.status(200).json({
            success: true,
            videoUrl: publicUrl,
            duration: 5,
            type: videoType
        });

    } catch (error) {
        console.error('Video generation error:', error);
        res.status(500).json({ error: error.message });
    }
}