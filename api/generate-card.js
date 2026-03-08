import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

export const config = {
    api: {
        bodyParser: false,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

async function generateGeminiImage(prompt, referenceImage) {
    const base64Image = referenceImage.toString('base64');
    const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp-image-generation', // быстрее?
        contents: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
            prompt
        ],
        config: {
            responseModalities: ['Image'],
            aspectRatio: '1:1',
        }
    });
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    throw new Error('Нет изображения');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'No API key' });

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
        const features = (fields.features?.[0] || '').split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || 'wb';

        if (!productName) return res.status(400).json({ error: 'Name required' });

        // Берём первое фото
        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) referenceBuffer = fs.readFileSync(photoArray[0].filepath);
        }
        if (!referenceBuffer) return res.status(400).json({ error: 'Photo required' });

        // Короткий промпт
        const prompt = `Карточка для ${platform === 'wb' ? 'Wildberries' : 'Ozon'}. Товар: ${productName}, бренд: ${brand}, цена: ${price}₽, особенности: ${features.join(', ')}. Белый фон, студийное освещение. На карточке название, цена и особенности.`;

        let imageUrl;
        try {
            imageUrl = await generateGeminiImage(prompt, referenceBuffer);
        } catch (err) {
            imageUrl = 'https://dummyimage.com/1024x1024/2f6ed6/ffffff.png&text=Generation+Failed';
        }

        const descriptions = [
            `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Цена: ${price} ₽.`,
            `${brand} ${productName} – высокое качество. Всего ${price} ₽.`,
            `Купите ${productName} по лучшей цене – ${price} ₽!`
        ];

        // Удаляем временные файлы
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);
            });
        }

        res.status(200).json({ images: [imageUrl], descriptions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}