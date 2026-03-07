import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

// Получение токена доступа (GigaChat требует Bearer token)
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
        // 1. Парсим multipart/form-data
        const form = new IncomingForm({ keepExtensions: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        // 2. Извлекаем поля
        const videoType = fields.videoType?.[0] || fields.videoType || 'standard';
        const prompt = fields.prompt?.[0] || fields.prompt || '';
        const resolution = fields.resolution?.[0] || fields.resolution || '512P';

        // 3. Получаем загруженное фото
        const photoFile = files.videoPhoto;
        if (!photoFile) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        const photoPath = photoFile.filepath;
        const fileBuffer = fs.readFileSync(photoPath);
        const base64Image = `data:${photoFile.mimetype};base64,${fileBuffer.toString('base64')}`;

        // 4. Получаем access token
        const accessToken = await getAccessToken(authKey);

        // 5. Формируем промпт (Kandinsky 5.0 Video Pro)
        const promptTemplates = {
            'standard': 'Профессиональное видео товара на белом фоне, студийное освещение, плавное вращение',
            '360': 'Товар плавно вращается на 360 градусов, белый фон, детальный обзор',
            'lifestyle': 'Товар используется в естественной обстановке, реалистично, повседневное использование',
            'unboxing': 'Распаковка товара, руки открывают коробку, качественная анимация'
        };
        
        const finalPrompt = prompt || promptTemplates[videoType] || promptTemplates.standard;

        // 6. Вызываем Kandinsky Video Pro через GigaChat API
        const videoResponse = await fetch(`${GIGACHAT_API_URL}/video/generation`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'KandinskyVideoPro',  // или 'KandinskyVideoLite' для более быстрой версии
                prompt: finalPrompt,
                image: base64Image,  // стартовый кадр
                duration: 5,          // секунд
                resolution: resolution, // 512P или 1024P
                fps: 24
            })
        });

        if (!videoResponse.ok) {
            const errorData = await videoResponse.text();
            throw new Error(`Kandinsky video error: ${errorData}`);
        }

        const videoData = await videoResponse.json();

        // 7. Возвращаем результат
        res.status(200).json({
            success: true,
            videoUrl: videoData.video_url,  // URL сгенерированного видео
            duration: 5,
            type: videoType
        });

        // 8. Удаляем временный файл
        fs.unlinkSync(photoPath);

    } catch (error) {
        console.error('Video generation error:', error);
        res.status(500).json({ error: error.message });
    }
}