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
            model: 'gemini-3-pro-image-preview', // Правильная модель для генерации изображений!
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

        // Промпт для генерации карточки с текстом
        const prompt = `Создай профессиональную карточку для маркетплейса ${platform === 'wb' ? 'Wildberries' : 'Ozon'}. 
На изображении товар "${productName}" от бренда ${brand}. Цена: ${price} ₽. Особенности: ${features.join(', ')}.
Официальная фотография товара для маркетплейса Wildberries. В правом верхнем углу расположен официальный логотип Wildberries — черные строчные буквы на белом фоне, современный плавный шрифт . Основной фон фотографии — однородный белый, без градиентов . Сам товар расположен по центру, виден полностью, не обрезан . Фотография качественная, товар в фокусе, без искажений. Студийный мягкий свет, равномерное освещение, без глубоких теней и резких бликов . Формат изображения — квадрат 1:1, минимальное разрешение 1000×1000 пикселей . Чистый, минималистичный стиль, премиум-качество, гиперреализм. На фото нет посторонних надписей, логотипов бренда продавца, маркетинговых текстов ("хит", "скидка") и водяных знаков . Товар занимает максимальную площадь кадра, имеет презентабельный вид .`;

        let imageUrl;
        try {
            imageUrl = await generateGeminiImage(prompt, referenceBuffer);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Gemini generation failed: ' + err.message });
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