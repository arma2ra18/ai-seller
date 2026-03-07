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
        const replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
        });

        // Допустим, мы уже распарсили форму и получили поля
        // (для простоты я пропускаю парсинг multipart – он у тебя уже есть)
        const { productName, brand, features, platform } = req.body; // на самом деле нужно из formData

        // Формируем промпт на основе данных товара
        const prompt = `Профессиональное фото товара ${productName} от бренда ${brand}, особенности: ${features}. Белый фон, студийное освещение, высокая детализация.`;

        // Запускаем модель FLUX Pro (или можно FLUX Schnell – быстрее, но чуть хуже)
        const output = await replicate.run(
            "black-forest-labs/flux-pro",
            {
                input: {
                    prompt: prompt,
                    aspect_ratio: "1:1",
                    output_format: "jpg",
                    num_outputs: 5 // генерация 5 вариантов
                }
            }
        );

        // output – это массив ссылок на сгенерированные изображения
        const images = Array.isArray(output) ? output : [output];

        // Здесь также можно вызвать GigaChat для генерации описаний
        const descriptions = [
            `Превосходный ${productName} для ежедневного использования.`,
            `Купите ${productName} сейчас по выгодной цене!`,
            `${productName} – лучшее решение для ваших задач.`
        ]; // пока заглушка

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('Replicate error:', error);
        res.status(500).json({ error: error.message });
    }
}