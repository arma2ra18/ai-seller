import { IncomingForm } from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || fields.productName || 'Товар';
        const brand = fields.brand?.[0] || fields.brand || 'Бренд';
        const price = fields.price?.[0] || fields.price || '1990';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);

        // Генерируем 5 тестовых изображений (плейсхолдеры)
        const images = [];
        for (let i = 0; i < 5; i++) {
            images.push(`https://via.placeholder.com/1024x1024?text=Card+${i+1}`);
        }

        // Тестовые описания
        const descriptions = [
            `Превосходный ${productName} от бренда ${brand}. Цена: ${price} ₽. Особенности: ${features.join(', ')}.`,
            `${brand} ${productName} – высокое качество и надёжность. Всего ${price} ₽.`,
            `Купите ${productName} по лучшей цене – ${price} ₽!`
        ];

        // Удаляем временные файлы
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath);
            });
        }

        res.status(200).json({ images, descriptions });
    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}