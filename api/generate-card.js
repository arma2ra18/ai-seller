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
 * Генерация изображения через GigaChat (Kandinsky)
 * @param {string} prompt - текстовое описание фона
 * @param {string} token - токен GigaChat
 * @returns {Promise<string>} - data URL изображения
 */
async function generateImage(prompt, token) {
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
                { role: 'user', content: prompt }
            ],
            function_call: 'auto',
        }),
    });

    if (!completionResponse.ok) {
        const errorText = await completionResponse.text();
        throw new Error(`GigaChat completion error: ${completionResponse.status} ${errorText}`);
    }

    const completionData = await completionResponse.json();
    const content = completionData.choices?.[0]?.message?.content || '';
    const match = content.match(/<img\s+src="([^"]+)"/i);
    const fileId = match ? match[1] : null;
    if (!fileId) throw new Error('Не удалось получить file_id');

    const fileResponse = await fetch(`${GIGACHAT_API_URL}/files/${fileId}/content`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!fileResponse.ok) {
        const errorText = await fileResponse.text();
        throw new Error(`GigaChat file download error: ${fileResponse.status} ${errorText}`);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = fileResponse.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
}

/**
 * Наложение текста на изображение с помощью sharp
 * @param {string} base64Image - изображение в формате data URL
 * @param {object} data - { productName, price, features }
 * @returns {Promise<string>} - итоговое изображение с текстом
 */
async function overlayText(base64Image, data) {
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(imgBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

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
    const finalBuffer = await sharp(imgBuffer)
        .composite([{ input: svgBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();
    return `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const token = process.env.GIGACHAT_AUTH_KEY;
    if (!token) return res.status(500).json({ error: 'GIGACHAT_AUTH_KEY not set' });

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
        const category = fields.category?.[0] || '';
        const price = fields.price?.[0] || '1990';
        const featuresStr = fields.features?.[0] || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || 'wb';

        if (!productName) return res.status(400).json({ error: 'Name required' });

        // Берём первое загруженное фото
        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length > 0) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
            }
        }
        if (!referenceBuffer) return res.status(400).json({ error: 'Photo required' });

        // Промпт для генерации фона (без текста)
        const prompt = `Профессиональное фото товара "${productName}" от бренда ${brand}. Категория: ${category}. Особенности: ${features.join(', ')}. Белый фон, студийное освещение, высокое качество.`;

        let imageDataUrl;
        try {
            imageDataUrl = await generateImage(prompt, token);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'GigaChat generation failed: ' + err.message });
        }

        // Накладываем текст
        const finalImage = await overlayText(imageDataUrl, { productName, price, features });

        const descriptions = [
            `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Цена: ${price} ₽.`,
            `${brand} ${productName} – высокое качество. Всего ${price} ₽.`,
            `Купите ${productName} по лучшей цене – ${price} ₽!`
        ];

        // Удаляем временные файлы
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        res.status(200).json({ images: [finalImage], descriptions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}