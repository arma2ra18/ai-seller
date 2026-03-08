import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Инициализация клиента Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация изображения через Gemini 2.5 Flash Image
 * @param {string} prompt - текстовое описание
 * @param {Buffer} referenceImage - буфер загруженного пользователем фото (опционально)
 * @returns {Promise<string>} - data URL изображения в формате base64
 */
async function generateGeminiImage(prompt, referenceImage = null) {
    try {
        // Формируем содержимое запроса
        const contents = [];
        
        if (referenceImage) {
            // Если есть референсное изображение, отправляем его как base64
            const base64Image = referenceImage.toString('base64');
            contents.push({
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            });
        }
        
        // Добавляем текстовый промпт
        contents.push(prompt);

        // Вызываем модель
        const response = await ai.models.generateContent({
            model: 'gemini-3.0-flash-image-preview', // или gemini-2.0-flash-image-exp
            contents: contents,
            config: {
                responseModalities: ['Text', 'Image']
            }
        });

        // Извлекаем изображение из ответа
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                // Возвращаем как data URL
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

        // Берём первое загруженное фото как референс
        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length > 0) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
            }
        }

        // Базовый промпт для генерации карточки
        const basePrompt = `Создай профессиональное изображение для карточки товара на маркетплейсе Wildberries. 
На изображении должен быть товар "${productName}" от бренда ${brand}. Категория: ${category}. 
Особенности товара: ${features.join(', ')}. 
Цена: ${price} ₽.
Стиль: студийное освещение, белый фон, высокое качество, 8k.
На изображении обязательно должен быть крупно написан текст с названием товара, ценой и краткими особенностями (в виде иконок или буллитов). 
Дизайн современный, премиальный, как в примерах wbgen.ru.`;

        // Генерируем 5 вариантов
        const images = [];
        for (let i = 0; i < 5; i++) {
            const variationPrompt = `${basePrompt} Вариант ${i+1}, немного измени композицию и расположение текста.`;
            try {
                const imageUrl = await generateGeminiImage(variationPrompt, referenceBuffer);
                images.push(imageUrl);
                // Небольшая задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.error(`❌ Ошибка генерации изображения ${i+1}:`, err);
                images.push(`https://via.placeholder.com/1024x1024?text=Generation+Failed+${i+1}`);
            }
        }

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

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}