import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

export const config = {
    api: {
        bodyParser: false,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация одного изображения через Gemini (минимальный промпт)
 */
async function generateGeminiImage(prompt, referenceImage) {
    try {
        const base64Image = referenceImage.toString('base64');
        const contents = [
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            },
            prompt
        ];

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: contents,
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
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini generation error:', error);
        throw error;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('❌ GOOGLE_API_KEY not set');
        return res.status(500).json({ error: 'GOOGLE_API_KEY not set' });
    }

    try {
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || 'товар';
        const brand = fields.brand?.[0] || 'бренд';
        const price = fields.price?.[0] || '1990';
        const features = (fields.features?.[0] || '').split(',').map(f => f.trim()).filter(Boolean);

        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
            }
        }
        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Максимально простой промпт
        const prompt = `Create a product image for ${productName} by ${brand}. Price ${price}. Features: ${features.join(', ')}. Square, high quality.`;

        const images = [];
        // Пробуем сгенерировать 1 изображение (для начала)
        try {
            console.log('Generating image...');
            const imageDataUrl = await generateGeminiImage(prompt, referenceBuffer);
            images.push(imageDataUrl);
        } catch (err) {
            console.error('Generation failed:', err);
        }

        if (images.length === 0) {
            throw new Error('Не удалось сгенерировать изображение');
        }

        const descriptions = [
            `✨ ${productName} от ${brand}. Цена: ${price} ₽.`
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

        res.status(200).json({ images, descriptions });
    } catch (error) {
        console.error('❌ Handler error:', error);
        res.status(500).json({ error: error.message });
    }
}