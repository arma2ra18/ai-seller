import { IncomingForm } from 'formidable';
import fs from 'fs';
import Replicate from 'replicate';

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
        // 1. Правильное создание экземпляра IncomingForm
        const form = new IncomingForm({
            keepExtensions: true,
            multiples: true, // разрешаем несколько файлов
        });

        // 2. Парсинг формы с помощью промиса
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        // 3. Извлекаем поля (учитываем, что formidable может вернуть массивы)
        const productName = fields.productName?.[0] || fields.productName;
        const brand = fields.brand?.[0] || fields.brand;
        const category = fields.category?.[0] || fields.category;
        const features = fields.features?.[0] || fields.features;
        const platform = fields.platform?.[0] || fields.platform;

        // 4. Обработка загруженных файлов
        let photoArray = [];
        if (files.photos) {
            photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
        }

        if (photoArray.length === 0) {
            return res.status(400).json({ error: 'No photos uploaded' });
        }

        // Берём первое фото для генерации
        const firstPhoto = photoArray[0];
        const photoPath = firstPhoto.filepath;

        // Читаем файл в base64
        const fileBuffer = fs.readFileSync(photoPath);
        const base64Image = `data:${firstPhoto.mimetype};base64,${fileBuffer.toString('base64')}`;

        // 5. Инициализация Replicate
        const replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });

        // Формируем промпт
        const prompt = `Профессиональное фото товара ${productName} от бренда ${brand}, категория ${category}. Особенности: ${features}. Белый фон, студийное освещение, высокая детализация, e-commerce стиль, 8k.`;

        // 6. Запуск генерации изображений
        const output = await replicate.run(
            "black-forest-labs/flux-pro",
            {
                input: {
                    prompt: prompt,
                    image: base64Image,
                    strength: 0.85,
                    num_outputs: 5,
                    aspect_ratio: "1:1",
                    output_format: "jpg",
                }
            }
        );

        const images = Array.isArray(output) ? output : [output];

        // 7. Генерация описаний (заглушка)
        const descriptions = [
            `Превосходный ${productName} от бренда ${brand}. ${features}. Идеально подходит для повседневного использования. Закажите сейчас!`,
            `${brand} ${productName} – высокое качество и надёжность. ${features}. Быстрая доставка по всей России.`,
            `Купите ${productName} по лучшей цене! ${features}. Только оригинальная продукция.`
        ];

        // 8. Удаляем временный файл (опционально, можно закомментировать при ошибках)
        try {
            fs.unlinkSync(photoPath);
        } catch (e) {
            console.warn('Failed to delete temp file:', e.message);
        }

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}