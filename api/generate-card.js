import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';

export const config = {
    api: {
        bodyParser: false,
    },
};

const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

/**
 * Генерация одного изображения через GigaChat
 */
async function generateImage(prompt, token) {
    try {
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
                function_call: 'auto',
            }),
        });

        if (!completionResponse.ok) {
            throw new Error(`GigaChat completion error: ${completionResponse.status}`);
        }

        const completionData = await completionResponse.json();
        const content = completionData.choices?.[0]?.message?.content || '';
        const match = content.match(/<img\s+src="([^"]+)"/i);
        const fileId = match ? match[1] : null;

        if (!fileId) {
            throw new Error('Не удалось получить file_id');
        }

        const fileResponse = await fetch(`${GIGACHAT_API_URL}/files/${fileId}/content`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!fileResponse.ok) {
            throw new Error('GigaChat file download error');
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = fileResponse.headers.get('content-type') || 'image/jpeg';
        const base64 = buffer.toString('base64');
        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error('Ошибка генерации изображения:', error);
        throw error;
    }
}

/**
 * Наложение текста на изображение с помощью sharp
 * @param {string} base64Image - исходное изображение в формате data:image/...;base64,...
 * @param {object} data - данные для наложения: { productName, price, features }
 * @returns {Promise<string>} - готовое изображение в base64
 */
async function overlayText(base64Image, data) {
    // Удаляем префикс data:image/...;base64,
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, 'base64');

    // Получаем размеры изображения (предполагаем 1024x1024)
    const metadata = await sharp(imgBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // Формируем SVG с текстом (позиционируем внизу)
    const svgText = `
    <svg width="${width}" height="${height}">
        <style>
            .title { fill: white; font-size: 42px; font-family: 'Inter', Arial; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
            .price { fill: gold; font-size: 58px; font-family: 'Inter', Arial; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
            .feature { fill: #ddd; font-size: 28px; font-family: 'Inter', Arial; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); }
        </style>
        <text x="50" y="${height - 150}" class="title">${data.productName}</text>
        <text x="50" y="${height - 80}" class="price">${data.price} ₽</text>
        ${data.features.slice(0,3).map((feat, i) => 
            `<text x="50" y="${height - 200 - i*35}" class="feature">• ${feat}</text>`
        ).join('')}
    </svg>`;

    const svgBuffer = Buffer.from(svgText);

    // Накладываем SVG на исходное изображение
    const finalBuffer = await sharp(imgBuffer)
        .composite([{ input: svgBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();

    return `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
}

/**
 * Генерация описаний (заглушка)
 */
async function generateDescriptions(productName, brand, features, price, platform) {
    return [
        `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Цена: ${price} ₽. Идеально подходит для повседневного использования. Закажите сейчас!`,
        `${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Всего ${price} ₽. Быстрая доставка по всей России.`,
        `Купите ${productName} по лучшей цене – ${price} ₽! ${features.join(', ')}. Только оригинальная продукция.`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = process.env.GIGACHAT_AUTH_KEY;
    if (!token) {
        return res.status(500).json({ error: 'GIGACHAT_AUTH_KEY not set' });
    }

    try {
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const category = fields.category?.[0] || fields.category || '';
        const price = fields.price?.[0] || fields.price || '1990';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || fields.platform || 'wb';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Обрабатываем загруженные фото (пока не используем)
        let photoArray = [];
        if (files.photos) {
            photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
        }

        // Формируем промпт для генерации изображений (фон)
        const basePrompt = `Профессиональное фото товара "${productName}" от бренда ${brand}. Категория: ${category}. Особенности: ${features.join(', ')}. Белый фон, студийное освещение, высокое качество, 8k.`;

        // Генерируем 5 изображений и накладываем текст
        const images = [];
        for (let i = 0; i < 5; i++) {
            const variationPrompt = `${basePrompt} Вариант ${i+1}, ракурс ${i+1}.`;
            try {
                const imageDataUrl = await generateImage(variationPrompt, token);
                // Накладываем текст
                const finalImage = await overlayText(imageDataUrl, {
                    productName,
                    price,
                    features
                });
                images.push(finalImage);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.error(`Ошибка генерации изображения ${i+1}:`, err);
                images.push(`https://via.placeholder.com/1024x1024?text=Generation+Failed+${i+1}`);
            }
        }

        // Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, price, platform);

        // Удаляем временные файлы
        photoArray.forEach(file => {
            if (file.filepath && fs.existsSync(file.filepath)) {
                fs.unlinkSync(file.filepath);
            }
        });

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}