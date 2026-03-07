import formidable from 'formidable';
import fs from 'fs';
import Replicate from 'replicate';

// Отключаем встроенный парсер Vercel (нужно для работы formidable)
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
        // 1. Парсим multipart/form-data
        const form = new formidable.IncomingForm();
        form.keepExtensions = true; // сохраняем расширения файлов

        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        // 2. Извлекаем поля формы (массивы, так как formidable может вернуть массивы)
        const productName = fields.productName?.[0] || fields.productName;
        const brand = fields.brand?.[0] || fields.brand;
        const category = fields.category?.[0] || fields.category;
        const features = fields.features?.[0] || fields.features;
        const platform = fields.platform?.[0] || fields.platform; // 'wb' или 'ozon'

        // Массив загруженных фото (может быть один или несколько)
        const photos = files.photos;
        const photoArray = Array.isArray(photos) ? photos : [photos];

        if (!photoArray.length) {
            return res.status(400).json({ error: 'No photos uploaded' });
        }

        // 3. Берём первое фото как основу для генерации
        const firstPhoto = photoArray[0];
        const photoPath = firstPhoto.filepath; // путь к временному файлу

        // Читаем файл и конвертируем в base64 (или можно загрузить на временный хостинг)
        // Для Replicate нужно передать изображение как data URI или публичный URL.
        // Проще всего загрузить фото на временный хостинг, но для теста используем data URI.
        const fileBuffer = fs.readFileSync(photoPath);
        const base64Image = `data:${firstPhoto.mimetype};base64,${fileBuffer.toString('base64')}`;

        // 4. Инициализируем Replicate с токеном из переменных окружения
        const replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });

        // 5. Формируем промпт для генерации на основе данных товара
        // (можно настроить под разные категории)
        const prompt = `Профессиональное фото товара ${productName} от бренда ${brand}, категория ${category}. Особенности: ${features}. Белый фон, студийное освещение, высокая детализация, e-commerce стиль, 8k.`;

        // 6. Запускаем модель FLUX Pro (лучшая для товарных фото)
        // Используем img2img – передаём исходное изображение, чтобы сохранить форму товара
        const output = await replicate.run(
            "black-forest-labs/flux-pro",
            {
                input: {
                    prompt: prompt,
                    image: base64Image,          // передаём загруженное фото как основу
                    strength: 0.85,               // насколько сильно менять изображение (0.85 – сохраняем форму, меняем фон)
                    num_outputs: 5,                // генерируем 5 вариантов
                    aspect_ratio: "1:1",
                    output_format: "jpg",
                }
            }
        );

        // Replicate возвращает массив ссылок на сгенерированные изображения
        const images = Array.isArray(output) ? output : [output];

        // 7. Генерируем 3 варианта описания (пока заглушка, позже можно подключить GigaChat)
        const descriptions = [
            `Превосходный ${productName} от бренда ${brand}. ${features}. Идеально подходит для повседневного использования. Закажите сейчас!`,
            `${brand} ${productName} – высокое качество и надёжность. ${features}. Быстрая доставка по всей России.`,
            `Купите ${productName} по лучшей цене! ${features}. Только оригинальная продукция.`
        ];

        // 8. Возвращаем результат клиенту
        res.status(200).json({
            images: images,
            descriptions: descriptions
        });

        // 9. Опционально: удаляем временный файл, чтобы не засорять диск
        fs.unlinkSync(photoPath);

    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}