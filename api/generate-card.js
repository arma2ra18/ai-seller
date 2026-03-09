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

        // Промпт с 3D эффектами и надписями
        const basePrompt = `Generate an ultra-premium product image for Wildberries marketplace, as if designed by the world's most expensive designer. 
The image should feature the product "${productName}" by brand ${brand} in the center, rendered in hyper-realistic 3D with cinematic lighting, reflections, and sharp details. 
Around the product, place multiple 3D text elements with luxurious effects: 
- The product name "${productName}" at the top in a large, elegant 3D gold/metallic font with subtle glow and bevel.
- The price "${price} ₽" at the bottom in a prominent 3D gold or diamond-encrusted style, with sparkling highlights.
- For each key feature, create small 3D badges or icons with accompanying text (in Russian): ${features.slice(0,4).map(f => `"${f}"`).join(', ')}. 
These badges should have a premium look (e.g., glossy, with metallic edges, subtle shadows) and be placed around the product in a balanced composition.
The background should be a soft gradient or an abstract luxurious studio environment with depth-of-field, making the product and text pop.
Overall style: ultra-modern, opulent, photorealistic, with reflections and ambient occlusion. All text must be crisp, readable, and seamlessly integrated as if part of a high-end 3D render.
The image must be square, 1024x1024, 8k resolution, sharp focus, no white background.`;

        // Генерируем 3 изображения с небольшими вариациями
        const images = [];
        for (let i = 0; i < 3; i++) {
            const variation = ` (variation ${i+1}: slightly different composition, lighting angle, or text placement)`;
            try {
                const imageUrl = await generateGeminiImage(basePrompt + variation, referenceBuffer);
                images.push(imageUrl);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.error(`Error generating image ${i+1}:`, err);
                images.push(null);
            }
        }

        const successfulImages = images.filter(img => img !== null);

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

        res.status(200).json({ images: successfulImages, descriptions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
}