// api/generate-card.js
import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

/**
 * Генерация одного изображения через Pollinations.AI (бесплатно, без ключей)
 * @param {string} prompt - текстовое описание
 * @param {number} seed - число для разнообразия
 * @returns {string} - прямая ссылка на изображение
 */
function generateImageUrl(prompt, seed) {
    // Кодируем промпт для URL
    const encodedPrompt = encodeURIComponent(prompt);
    // Добавляем seed, чтобы каждый раз получать разные картинки
    return `https://pollinations.ai/p/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;
}

/**
 * Генерация описаний (заглушка, можно заменить на вызов GigaChat позже)
 */
async function generateDescriptions(productName, brand, features, platform) {
    return [
        `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Идеально подходит для повседневного использования. Закажите сейчас!`,
        `${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Быстрая доставка по всей России.`,
        `Купите ${productName} по лучшей цене! ${features.join(', ')}. Только оригинальная продукция.`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Парсим multipart/form-data
        const form = new IncomingForm({
            keepExtensions: true,
            multiples: true,
        });

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
        const platform = fields.platform?.[0] || fields.platform || 'wb';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Загруженные файлы (пока не используем, но удалим после)
        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];

        // Формируем базовый промпт на русском (Pollinations отлично понимает)
        const basePrompt = `Профессиональное фото товара "${productName}" от бренда ${brand}. Категория: ${category}. Особенности: ${features.join(', ')}. Белый фон, студийное освещение, высокое качество, 8k.`;

        // Генерируем 5 разных изображений, меняя seed
        const images = [];
        for (let i = 0; i < 5; i++) {
            const seed = Math.floor(Math.random() * 10000) + i * 1000; // уникальный seed
            const prompt = `${basePrompt} Вариант ${i+1}.`;
            const imageUrl = generateImageUrl(prompt, seed);
            images.push(imageUrl);
        }

        // Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, platform);

        // Удаляем временные файлы
        photos.forEach(file => {
            if (file.filepath && fs.existsSync(file.filepath)) {
                fs.unlinkSync(file.filepath);
            }
        });

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}