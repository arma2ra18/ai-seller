import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1';

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
                    { role: 'system', content: 'Ты — профессиональный дизайнер товаров для маркетплейсов. Генерируй реалистичные изображения товаров на белом фоне, студийное освещение, высокое качество.' },
                    { role: 'user', content: prompt }
                ],
                function_call: 'auto',
            }),
        });

        if (!completionResponse.ok) throw new Error('GigaChat completion error');
        const completionData = await completionResponse.json();
        const content = completionData.choices?.[0]?.message?.content || '';
        const match = content.match(/<img\s+src="([^"]+)"/i);
        const fileId = match ? match[1] : null;
        if (!fileId) throw new Error('Не удалось получить file_id');

        const fileResponse = await fetch(`${GIGACHAT_API_URL}/files/${fileId}/content`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!fileResponse.ok) throw new Error('GigaChat file download error');
        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = fileResponse.headers.get('content-type') || 'image/jpeg';
        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error('Ошибка генерации изображения:', error);
        throw error;
    }
}

async function generateDescriptions(productName, brand, features, platform) {
    return [
        `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Идеально подходит для повседневного использования. Закажите сейчас!`,
        `${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Быстрая доставка по всей России.`,
        `Купите ${productName} по лучшей цене! ${features.join(', ')}. Только оригинальная продукция.`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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

        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const category = fields.category?.[0] || fields.category || '';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        if (!productName) return res.status(400).json({ error: 'Product name required' });

        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];

        const basePrompt = `Профессиональное фото товара "${productName}" от бренда ${brand}. Категория: ${category}. Особенности: ${features.join(', ')}. Белый фон, студийное освещение, высокое качество, 8k.`;

        const images = [];
        for (let i = 0; i < 5; i++) {
            try {
                const imageDataUrl = await generateImage(`${basePrompt} Вариант ${i+1}, ракурс ${i+1}.`, token);
                images.push(imageDataUrl);
                await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                images.push(`https://via.placeholder.com/1024x1024?text=Generation+Failed+${i+1}`);
            }
        }

        const descriptions = await generateDescriptions(productName, brand, features, fields.platform || 'wb');
        res.status(200).json({ images, descriptions });

        photos.forEach(file => {
            if (file.filepath && fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);
        });
    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}