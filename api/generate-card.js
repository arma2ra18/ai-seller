import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

/**
 * Генерация одного изображения через GigaChat
 * @param {string} prompt - текстовое описание изображения
 * @param {string} token - токен авторизации GigaChat
 * @returns {Promise<string>} - data URL изображения в формате base64
 */
async function generateImage(prompt, token) {
    try {
        // 1. Запрос на генерацию изображения
        const completionResponse = await fetch(`${GIGACHAT_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
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
                function_call: 'auto', // Включает возможность генерации изображений
            }),
        });

        if (!completionResponse.ok) {
            const errorText = await completionResponse.text();
            throw new Error(`GigaChat completion error: ${completionResponse.status} ${errorText}`);
        }

        const completionData = await completionResponse.json();

        // Извлекаем file_id из тега <img src="..."/>
        const content = completionData.choices?.[0]?.message?.content || '';
        const match = content.match(/<img\s+src="([^"]+)"/i);
        const fileId = match ? match[1] : null;

        if (!fileId) {
            throw new Error('Не удалось получить file_id из ответа GigaChat');
        }

        // 2. Скачиваем файл изображения
        const fileResponse = await fetch(`${GIGACHAT_API_URL}/files/${fileId}/content`, {
            method: 'GET',
            headers: {
                'Accept': 'image/jpeg, image/png, */*',
                'Authorization': `Bearer ${token}`,
            },
        });

        if (!fileResponse.ok) {
            const errorText = await fileResponse.text();
            throw new Error(`GigaChat file download error: ${fileResponse.status} ${errorText}`);
        }

        // Получаем бинарные данные
        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Определяем MIME-тип (обычно image/jpeg)
        const contentType = fileResponse.headers.get('content-type') || 'image/jpeg';
        const base64 = buffer.toString('base64');

        // Возвращаем data URL
        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error('Ошибка генерации изображения:', error);
        throw error; // пробрасываем дальше
    }
}

/**
 * Генерация описаний товара (можно через GigaChat, но пока заглушка)
 */
async function generateDescriptions(productName, brand, features, platform) {
    // Здесь можно добавить вызов GigaChat для текста
    // Пока простые заглушки
    return [
        `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Идеально подходит для повседневного использования. Закажите сейчас!`,
        `${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Быстрая доставка по всей России.`,
        `Купите ${productName} по лучшей цене! ${features.join(', ')}. Только оригинальная продукция.`,
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Получаем токен из переменных окружения
    const token = process.env.GIGACHAT_AUTH_KEY;
    if (!token) {
        return res.status(500).json({ error: 'GIGACHAT_AUTH_KEY not set' });
    }

    try {
        // 1. Парсим multipart/form-data
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

        // 2. Извлекаем поля формы (могут быть массивами)
        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const category = fields.category?.[0] || fields.category || '';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || fields.platform || 'wb';

        // Проверка обязательных полей
        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // 3. Загруженные фото (пока не используем для img2img, но можно сохранить для истории)
        let photoArray = [];
        if (files.photos) {
            photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
        }

        // 4. Формируем промпт для генерации изображений
        const basePrompt = `Профессиональное фото товара "${productName}" от бренда ${brand}. Категория: ${category}. Особенности: ${features.join(', ')}. Белый фон, студийное освещение, высокое качество, 8k.`;

        // 5. Генерируем 5 изображений (последовательно с небольшой задержкой)
        const images = [];
        for (let i = 0; i < 5; i++) {
            // Для разнообразия добавляем вариации в промпт
            const variationPrompt = `${basePrompt} Вариант ${i+1}, ракурс ${i+1}.`;
            try {
                const imageDataUrl = await generateImage(variationPrompt, token);
                images.push(imageDataUrl);
                // Небольшая задержка между запросами (1 секунда), чтобы не перегружать API
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.error(`Ошибка генерации изображения ${i+1}:`, err);
                // Если не удалось сгенерировать, добавляем плейсхолдер
                images.push(`https://via.placeholder.com/1024x1024?text=Generation+Failed+${i+1}`);
            }
        }

        // 6. Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, platform);

        // 7. Возвращаем результат
        res.status(200).json({
            images,
            descriptions,
        });

        // 8. Удаляем временные загруженные файлы (чтобы не засорять диск)
        photoArray.forEach(file => {
            if (file.filepath && fs.existsSync(file.filepath)) {
                fs.unlinkSync(file.filepath);
            }
        });

    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}