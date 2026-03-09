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

        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) referenceBuffer = fs.readFileSync(photoArray[0].filepath);
        }
        if (!referenceBuffer) return res.status(400).json({ error: 'Photo required' });

        // ⭐ УЛУЧШЕННЫЙ ПРОМПТ: больше надписей, окружающих товар
        const prompt = `Generate a premium product image for Wildberries marketplace. 
The image should feature the product "${productName}" by brand ${brand} prominently in the center. 
The product must be rendered in high-quality 3D with realistic textures and soft studio lighting.
Around the product, add multiple stylish text elements (in Russian) that describe the key features:
${features.slice(0,4).map(f => `- "${f}"`).join('\n')}
Also include:
- The product name "${productName}" in a large, elegant font at the top.
- The price "${price} ₽" in a prominent, eye-catching style (e.g., gold or with a badge) at the bottom.
- Small icons or badges for each key feature (e.g., waterproof icon, noise-cancelling icon) placed around the product.
The background should be a soft gradient or subtle studio environment (not white) that makes the product stand out.
The overall design should be modern, luxurious, and instantly recognizable as a top-tier Wildberries card.
All text must be clearly readable and integrated harmoniously with the product.
The image should be square, 1024x1024, high resolution, 8k, sharp focus.`;

        let imageUrl;
        try {
            imageUrl = await generateGeminiImage(prompt, referenceBuffer);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Gemini generation failed: ' + err.message });
        }

        // Текстовые описания (можно оставить или тоже улучшить)
        const descriptions = [
            `✨ Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Цена: ${price} ₽. Идеально подходит для повседневного использования. Закажите сейчас!`,
            `💎 ${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Всего ${price} ₽. Быстрая доставка по всей России.`,
            `🔥 Купите ${productName} по лучшей цене – ${price} ₽! ${features.join(', ')}. Только оригинальная продукция.`
        ];

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