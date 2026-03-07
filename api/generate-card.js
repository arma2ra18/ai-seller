// api/generate-card.js
import { IncomingForm } from 'formidable';
import fs from 'fs';
import axios from 'axios';
import https from 'https';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Создаём HTTPS-агент с отключённой проверкой сертификата
const agent = new https.Agent({
    rejectUnauthorized: false
});

// Создаём экземпляр axios с этим агентом
const axiosInstance = axios.create({
    httpsAgent: agent,
});

// Резервные изображения на случай ошибок
const FALLBACK_IMAGES = [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
    'https://images.unsplash.com/photo-1503602642458-232111445657?w=500',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500',
    'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=500'
];

/**
 * Генерация одного изображения через GigaChat (с axios)
 */
async function generateImage(prompt, token) {
    try {
        // 1. Запрос на генерацию (ожидаем, что GigaChat вернёт file_id в теге <img>)
        const completionResponse = await axiosInstance.post(
            'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
            {
                model: 'GigaChat',
                messages: [
                    {
                        role: 'system',
                        content: 'Ты — профессиональный дизайнер товаров для маркетплейсов. Генерируй реалистичные изображения товаров на белом фоне, студийное освещение, высокое качество.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                function_call: 'auto', // обязательно для генерации изображений
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Host': 'gigachat.devices.sberbank.ru',
                },
            }
        );

        const completionData = completionResponse.data;
        console.log('📦 GigaChat response:', JSON.stringify(completionData, null, 2));

        // Извлекаем file_id из тега <img src="..."/>
        const content = completionData.choices?.[0]?.message?.content || '';
        const match = content.match(/<img\s+src="([^"]+)"/i);
        const fileId = match ? match[1] : null;

        if (!fileId) {
            console.error('❌ File ID not found in response. Content:', content);
            throw new Error('Не удалось получить file_id из ответа GigaChat');
        }

        console.log('✅ File ID получен:', fileId);

        // 2. Скачиваем файл изображения
        const fileResponse = await axiosInstance.get(
            `https://gigachat.devices.sberbank.ru/api/v1/files/${fileId}/content`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Host': 'gigachat.devices.sberbank.ru',
                },
                responseType: 'arraybuffer', // важно для бинарных данных
            }
        );

        const buffer = Buffer.from(fileResponse.data);
        const contentType = fileResponse.headers['content-type'] || 'image/jpeg';
        const base64 = buffer.toString('base64');

        console.log(`✅ Изображение получено, размер: ${buffer.length} байт`);

        return `data:${contentType};base64,${base64}`;

    } catch (error) {
        console.error('❌ Ошибка в generateImage:', error.message);
        if (error.response) {
            console.error('❌ Статус ответа:', error.response.status);
            console.error('❌ Данные ответа:', error.response.data);
        } else if (error.request) {
            console.error('❌ Запрос был сделан, но ответ не получен:', error.request);
        } else {
            console.error('❌ Детали ошибки:', error);
        }
        // Возвращаем заглушку
        return FALLBACK_IMAGES[Math.floor(Math.random() * FALLBACK_IMAGES.length)];
    }
}

/**
 * Генерация описаний (заглушка, позже можно заменить на GigaChat)
 */
async function generateDescriptions(productName, brand, features, platform) {
    return [
        `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Идеально подходит для повседневного использования. Закажите сейчас!`,
        `${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Быстрая доставка по всей России.`,
        `Купите ${productName} по лучшей цене! ${features.join(', ')}. Только оригинальная продукция.`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = process.env.GIGACHAT_AUTH_KEY;
    if (!token) {
        console.error('❌ GIGACHAT_AUTH_KEY not set in environment');
        return res.status(500).json({ error: 'GIGACHAT_AUTH_KEY not set' });
    }

    try {
        // Парсим multipart/form-data
        const form = new IncomingForm({
            keepExtensions: true,
            multiples: true,
        });

        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const category = fields.category?.[0] || fields.category || '';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || fields.platform || 'wb';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Загруженные файлы (пока не используем, но удалим после)
        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];

        // Формируем базовый промпт
        const basePrompt = `Профессиональное фото товара "${productName}" от бренда ${brand}. Категория: ${category}. Особенности: ${features.join(', ')}. Белый фон, студийное освещение, высокое качество, 8k.`;

        // Генерируем 5 изображений
        const images = [];
        for (let i = 0; i < 5; i++) {
            const prompt = `${basePrompt} Вариант ${i+1}, ракурс ${i+1}.`;
            console.log(`🎨 Генерация изображения ${i+1} с промптом:`, prompt);
            const imageUrl = await generateImage(prompt, token);
            images.push(imageUrl);
            // Небольшая задержка между запросами
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, platform);

        // Удаляем временные файлы
        photos.forEach(file => {
            if (file.filepath && fs.existsSync(file.filepath)) {
                fs.unlinkSync(file.filepath);
            }
        });

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}