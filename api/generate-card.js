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
 * Генерация фона изображения через Gemini с учётом правил WB
 * @param {string} productName - название товара
 * @param {string} brand - бренд
 * @param {string} category - категория
 * @param {string[]} features - особенности
 * @param {Buffer} referenceImage - буфер загруженного пользователем фото
 * @returns {Promise<string>} - data URL готового фонового изображения
 */
async function generateGeminiImage(productName, brand, category, features, referenceImage) {
    try {
        const base64Image = referenceImage.toString('base64');
        
        // Формируем промпт для генерации фона (без текста!)
        const prompt = `Сгенерируй профессиональное фото для карточки товара на Wildberries.
Товар: ${productName}
Бренд: ${brand}
Категория: ${category}
Особенности: ${features.join(', ')}

Технические требования Wildberries:
- Минимальное разрешение: 700×900 пикселей
- Товар в фокусе, не обрезан, виден полностью
- Фон нейтральный, чистый, ровный, контрастный товару
- Без текста, логотипов, водяных знаков, цен, QR-кодов на изображении [citation:4]
- Без оценочных суждений ("хит", "лучший") [citation:1]
- Без призывов к действию

Стиль: 
- Для одежды/обуви: можно использовать модель для демонстрации (естественные позы, равномерное освещение) [citation:4]
- Для товаров для дома: создать атмосферу уюта, но не перегружать фон [citation:6]
- Для электроники/инструментов: строгий, техничный фон, акцент на деталях
- Для продуктов питания: аппетитная подача, но без искажения цвета
- Для украшений: можно использовать тёмный фон для "люксового" эффекта [citation:2]

Сохрани форму, цвет и фактуру товара с загруженного фото.`;

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
            model: 'gemini-3-pro-image-preview',
            contents: contents,
            config: {
                responseModalities: ['Image'],
                aspectRatio: '1:1', // или можно динамически подбирать
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
 * Генерация SEO-названия (до 60 символов)
 */
function generateSeoTitle(productName, brand, category, features) {
    // Правила WB: максимум 60 символов, без синонимов, без оценочных слов [citation:1][citation:7]
    const base = `${brand} ${productName}`.slice(0, 40);
    // Добавляем ключевую особенность, если остаётся место
    if (features.length > 0 && base.length + features[0].length + 1 <= 60) {
        return `${base} ${features[0]}`;
    }
    return base;
}

/**
 * Генерация продающего описания по правилам WB
 */
async function generateDescription(productName, brand, category, features, price) {
    // Структура описания:
    // 1. Для кого и для чего (2-3 предложения)
    // 2. Преимущества через пользу (4-6 пунктов)
    // 3. Сценарии применения
    // 4. Комплектация и уход [citation:5][citation:9]
    // 5. Естественное встраивание ключевых слов [citation:7]

    const advantages = features.map(f => 
        `• ${f} — это даёт вам: ${getBenefit(f, category)}`
    ).join('\n');

    const scenarios = getScenarios(category);

    return `${productName} от бренда ${brand} — идеальное решение для ${getTargetAudience(category)}. Этот товар создан, чтобы ${getMainBenefit(category)}.

✅ Преимущества:
${advantages}

✨ Сценарии использования:
${scenarios}

📦 В комплекте: ${getPackageContents(category)}

💧 Уход: ${getCareInstructions(category)}

Цена: ${price} ₽. Закажите сейчас и оцените качество!`;
}

/**
 * Вспомогательные функции (можно расширять под свои категории)
 */
function getBenefit(feature, category) {
    const benefits = {
        'electronics': 'надёжность и долговечность',
        'clothing': 'комфорт и стиль',
        'home': 'уют и удобство',
        'beauty': 'здоровье и красоту',
        'default': 'превосходный результат'
    };
    return benefits[category] || benefits.default;
}

function getTargetAudience(category) {
    const audiences = {
        'electronics': 'всех, кто ценит современные технологии',
        'clothing': 'тех, кто следит за модой и комфортом',
        'home': 'создания уютной атмосферы в доме',
        'beauty': 'ежедневного ухода и сияния кожи',
        'default': 'повседневного использования'
    };
    return audiences[category] || audiences.default;
}

function getMainBenefit(category) {
    const benefits = {
        'electronics': 'упростить вашу жизнь и сделать её комфортнее',
        'clothing': 'подчеркнуть ваш индивидуальный стиль',
        'home': 'наполнить дом теплом и уютом',
        'beauty': 'подарить коже здоровье и сияние',
        'default': 'радовать вас каждый день'
    };
    return benefits[category] || benefits.default;
}

function getScenarios(category) {
    const scenarios = {
        'electronics': '• Дома для работы и развлечений\n• В офисе для повышения продуктивности\n• В дороге благодаря компактности',
        'clothing': '• На каждый день для создания стильных образов\n• Для особых случаев и праздников\n• Для активного отдыха и прогулок',
        'home': '• Для уютных семейных вечеров\n• Для встречи гостей и создания атмосферы\n• Для повседневного использования',
        'beauty': '• В ежедневном уходе за кожей\n• Для подготовки к важным событиям\n• Как расслабляющий ритуал',
        'default': '• Для повседневного использования\n• В различных ситуациях и условиях'
    };
    return scenarios[category] || scenarios.default;
}

function getPackageContents(category) {
    const contents = {
        'electronics': 'товар, зарядное устройство, инструкция, гарантийный талон',
        'clothing': 'товар, подарочная упаковка (для премиум-позиций)',
        'home': 'товар, инструкция по уходу',
        'beauty': 'товар, инструкция по применению',
        'default': 'товар, упаковка, инструкция'
    };
    return contents[category] || contents.default;
}

function getCareInstructions(category) {
    const instructions = {
        'electronics': 'берегите от влаги и механических повреждений, протирайте мягкой тканью',
        'clothing': 'следуйте рекомендациям на бирке, стирка при щадящем режиме',
        'home': 'протирайте влажной тканью, избегайте агрессивных моющих средств',
        'beauty': 'храните в сухом прохладном месте, избегайте попадания прямых солнечных лучей',
        'default': 'следуйте рекомендациям производителя'
    };
    return instructions[category] || instructions.default;
}

/**
 * Наложение текста на изображение с помощью sharp
 * (только для дополнительных фото, не для главного! [citation:4])
 */
async function overlayText(base64Image, data, isMain = false) {
    // Для главного фото текст не накладываем (правила WB) [citation:4]
    if (isMain) {
        return base64Image;
    }

    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(imgBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // SVG с текстом для дополнительных фото (инфографика)
    const svgText = `
    <svg width="${width}" height="${height}">
        <style>
            .title { fill: white; font-size: 36px; font-family: 'Inter', Arial; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
            .price { fill: gold; font-size: 48px; font-family: 'Inter', Arial; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); }
            .feature { fill: #ddd; font-size: 24px; font-family: 'Inter', Arial; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); }
        </style>
        <text x="50" y="${height - 120}" class="title">${data.productName}</text>
        <text x="50" y="${height - 60}" class="price">${data.price} ₽</text>
        ${data.features.slice(0,2).map((feat, i) => 
            `<text x="50" y="${height - 170 - i*30}" class="feature">• ${feat}</text>`
        ).join('')}
    </svg>`;

    const svgBuffer = Buffer.from(svgText);
    const finalBuffer = await sharp(imgBuffer)
        .composite([{ input: svgBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();
    return `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
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
        const category = fields.category?.[0] || fields.category || 'default';
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

        // 1. Генерируем SEO-название
        const seoTitle = generateSeoTitle(productName, brand, category, features);

        // 2. Генерируем описание
        const description = await generateDescription(productName, brand, category, features, price);

        // 3. Генерируем фоновое изображение (без текста)
        const imageDataUrl = await generateGeminiImage(productName, brand, category, features, referenceBuffer);

        // 4. Подготавливаем массив изображений:
        //    - Первое (главное) фото — без текста (правила WB) [citation:4]
        //    - Остальные — с текстом (инфографика)
        const images = [];
        
        // Главное фото (без текста)
        images.push(imageDataUrl);

        // Дополнительные варианты с текстом (3 штуки)
        for (let i = 0; i < 3; i++) {
            // Генерируем слегка изменённый фон (можно варьировать промпт)
            // В реальном проекте здесь может быть отдельный вызов Gemini для разнообразия
            // Пока используем то же изображение, но накладываем текст
            const withText = await overlayText(imageDataUrl, {
                productName: seoTitle,
                price,
                features
            }, false);
            images.push(withText);
        }

        // 5. Описания (3 варианта) — используем сгенерированное выше, можно слегка варьировать
        const descriptions = [
            description,
            description.replace('Закажите сейчас', 'Купите сейчас'),
            description + ' Быстрая доставка по всей России!'
        ];

        // Удаляем временные файлы
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        res.status(200).json({ 
            images, 
            descriptions,
            seoTitle // можно использовать в интерфейсе
        });

    } catch (error) {
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}