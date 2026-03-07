import formidable from 'formidable';
import fs from 'fs';
import { createWorker } from 'some-image-generation-library'; // замените на реальный импорт

export const config = {
    api: {
        bodyParser: false, // отключаем встроенный парсер для обработки multipart
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const form = new formidable.IncomingForm();
        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error('Form parse error:', err);
                return res.status(500).json({ error: 'Form parsing error' });
            }

            const productName = fields.productName?.[0] || fields.productName;
            const brand = fields.brand?.[0] || fields.brand;
            const category = fields.category?.[0] || fields.category;
            const features = JSON.parse(fields.features?.[0] || fields.features || '[]');
            const platform = fields.platform?.[0] || fields.platform; // 'wb' или 'ozon'

            // Получаем массив загруженных файлов
            const photos = files.photos;
            const photoArray = Array.isArray(photos) ? photos : [photos];

            // Здесь должна быть логика загрузки фото в Firebase Storage
            // и получения публичных URL. Для примера просто используем временные пути.
            const uploadedUrls = photoArray.map(file => {
                // читаем файл, загружаем куда-то, возвращаем URL
                // пока вернём локальный путь для теста
                return `/uploads/${file.newFilename}`; // заглушка
            });

            // Генерация 5 изображений с наложенным текстом
            const generatedImages = [];
            for (let i = 0; i < 5; i++) {
                // Здесь вызывается нейросеть (например, Replicate)
                // Используем первое загруженное фото как основу
                const baseImage = uploadedUrls[0];
                const prompt = buildPrompt(productName, brand, category, features, platform, i);
                const imageUrl = await generateImage(prompt, baseImage);
                generatedImages.push(imageUrl);
            }

            // Генерация 3 вариантов описания
            const descriptions = await generateDescriptions(productName, brand, features, platform);

            res.status(200).json({
                images: generatedImages,
                descriptions: descriptions
            });
        });
    } catch (error) {
        console.error('Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}

// Вспомогательные функции (нужно реализовать)
async function generateImage(prompt, baseImage) {
    // Пример с Replicate (замените на реальный код)
    // const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    // const output = await replicate.run("black-forest-labs/flux-pro", {
    //     input: { prompt, image: baseImage }
    // });
    // return output[0];
    return `https://via.placeholder.com/1024x1024?text=Generated+${Date.now()}`; // заглушка
}

async function generateDescriptions(productName, brand, features, platform) {
    // Здесь вызов GigaChat или другого API
    // Пока заглушка
    return [
        `Отличный ${productName} от бренда ${brand}. Подходит для повседневного использования.`,
        `Купите ${productName} по выгодной цене. ${features.join(', ')}.`,
        `${brand} ${productName} – лучшее решение для ваших задач. Закажите сейчас!`
    ];
}

function buildPrompt(productName, brand, category, features, platform, index) {
    const base = `Профессиональное фото товара ${productName} от бренда ${brand}, категория ${category}.`;
    const variations = [
        ' на белом фоне, студийное освещение',
        ' в интерьере, естественный свет',
        ' крупным планом, детали',
        ' с дополнительными аксессуарами',
        ' в упаковке'
    ];
    return base + variations[index % variations.length];
}