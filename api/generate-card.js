import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';

export const config = {
    api: {
        bodyParser: false,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация фона изображения через Gemini (Image Preview)
 * @param {string} prompt - промпт для генерации фона
 * @param {Buffer} referenceImage - буфер загруженного пользователем фото
 * @returns {Promise<string>} - data URL готового фонового изображения
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
            model: 'gemini-3-pro-image-preview', // или gemini-3.1-flash-image-preview
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

/**
 * Наложение текста на изображение с помощью sharp
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

        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length > 0) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
            }
        }

        if (!referenceBuffer) {
            return res.status(400).json({ error: 'Необходимо загрузить хотя бы одно фото' });
        }

        // Промпт для генерации фона (без текста, так как текст наложим отдельно)
        const prompt = `Product photography of ${productName} from brand ${brand}. Minimalistic composition, isolated on a pure white soft gradient background (light grey to white). Studio softbox lighting, no shadows, high resolution, 8k, sharp focus, detailed texture, photorealistic. Professional e-commerce photo, clean and modern style. Keep the product shape exactly as in the reference image.`;

        // Генерируем только одно изображение (фон)
        let imageDataUrl;
        try {
            imageDataUrl = await generateGeminiImage(prompt, referenceBuffer);
        } catch (err) {
            console.error('❌ Ошибка генерации изображения:', err);
            return res.status(500).json({ error: 'Gemini generation failed: ' + err.message });
        }

        // Накладываем текст
        const finalImage = await overlayText(imageDataUrl, { productName, price, features });

        const descriptions = await generateDescriptions(productName, brand, features, price, platform);

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
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}