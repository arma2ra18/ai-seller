// api/generate-card.js
import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Заглушка для изображений – массив готовых ссылок (вместо генерации через GigaChat)
const PLACEHOLDER_IMAGES = [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
    'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
    'https://images.unsplash.com/photo-1503602642458-232111445657?w=500',
    'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500',
    'https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=500'
];

// Генерация описаний (заглушка, можно позже заменить на вызов GigaChat)
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

        // Извлекаем поля (могут быть массивами)
        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const category = fields.category?.[0] || fields.category || '';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || fields.platform || 'wb';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Загруженные файлы (пока не используем, но можно сохранить или обработать позже)
        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];

        // Вместо реальной генерации используем массив готовых изображений
        const images = PLACEHOLDER_IMAGES; // всегда 5 картинок

        // Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, platform);

        // Возвращаем результат клиенту
        res.status(200).json({
            images,
            descriptions
        });

        // Опционально: удаляем временные файлы, чтобы не засорять диск
        photos.forEach(file => {
            if (file.filepath && fs.existsSync(file.filepath)) {
                fs.unlinkSync(file.filepath);
            }
        });

    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}