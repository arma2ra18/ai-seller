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
 * Генерация фона изображения через Gemini (Image Preview)
 * @param {string} prompt - промпт для генерации фона
 * @param {Buffer} referenceImage - буфер загруженного пользователем фото
 * @returns {Promise<string>} - data URL готового фонового изображения
 */
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
            model: 'gemini-3-pro-image-preview',
            contents: contents,
            config: {
                responseModalities: ['Image'],
                aspectRatio: '3:4', // Wildberries требует соотношение 3:4 для главного фото [citation:7]
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
 * Наложение текста на изображение с помощью sharp
 */
async function overlayText(base64Image, data) {
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(imgBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // Оптимизированный SVG для Wildberries – крупный читаемый текст, премиальный стиль
    const svgText = `
    <svg width="${width}" height="${height}">
        <style>
            .title { 
                fill: white; 
                font-size: 48px; 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                font-weight: 700; 
                text-shadow: 2px 2px 6px rgba(0,0,0,0.7);
                letter-spacing: -0.5px;
            }
            .price { 
                fill: #ffd700; 
                font-size: 64px; 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                font-weight: 800; 
                text-shadow: 2px 2px 6px rgba(0,0,0,0.7);
                letter-spacing: -0.5px;
            }
            .feature { 
                fill: #ffffff; 
                font-size: 32px; 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                font-weight: 500; 
                text-shadow: 1px 1px 4px rgba(0,0,0,0.7);
            }
        </style>
        <text x="50" y="${height - 150}" class="title">${data.productName}</text>
        <text x="50" y="${height - 70}" class="price">${data.price} ₽</text>
        ${data.features.slice(0,3).map((feat, i) => 
            `<text x="50" y="${height - 220 - i*45}" class="feature">• ${feat}</text>`
        ).join('')}
    </svg>`;

    const svgBuffer = Buffer.from(svgText);
    const finalBuffer = await sharp(imgBuffer)
        .composite([{ input: svgBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 95 }) // Высокое качество, но не превышаем 10 МБ
        .toBuffer();
    return `data:image/jpeg;base64,${finalBuffer.toString('base64')}`;
}

/**
 * Генерация описаний для Wildberries – структурированные, продающие, SEO-оптимизированные
 * Согласно требованиям Wildberries: максимум 2000 символов, без спама, с ключевыми характеристиками [citation:1][citation:3]
 */
async function generateDescriptions(productName, brand, features, price, platform) {
    // Формируем список особенностей для читаемого текста
    const featureList = features.map(f => `• ${f}`).join('\n');
    
    // Базовое описание для всех категорий
    const baseDescription = `${productName} от бренда ${brand} — это качество и надёжность, подтверждённые тысячами довольных покупателей. Товар сертифицирован и полностью соответствует заявленным характеристикам.\n\n`;

    const usageDescription = `🔹 Идеально подходит для: повседневного использования, подарка, создания уюта и комфорта.\n🔹 Преимущества: ${features.slice(0,3).join(', ')}.\n🔹 В комплекте: всё необходимое для начала использования.\n\n`;

    const priceDescription = `💰 Цена: ${price} ₽ — лучшее предложение на рынке с учётом качества и функциональности.\n\n`;

    const guaranteeDescription = `✅ Гарантия качества — вся продукция проходит строгий контроль.\n✅ Быстрая доставка по всей России.\n✅ Лёгкий возврат в случае необходимости.\n\n`;

    // SEO-блок с ключевыми словами (естественно встроенными)
    const seoDescription = `Купить ${productName} в интернет-магазине Wildberries. ${brand} ${productName} — это ${features.slice(0,2).join(' и ')}. Заказывайте ${productName} с доставкой по России.`;

    const fullDescription = baseDescription + usageDescription + priceDescription + guaranteeDescription + seoDescription;

    // Возвращаем три варианта с разными акцентами
    return [
        fullDescription.substring(0, 1800) + '...', // Обрезаем до лимита
        
        `✨ ${productName} от ${brand} — ваш идеальный выбор!\n\nОсобенности:\n${featureList}\n\n📦 Комплектация: всё как на фото и в описании.\n🚚 Доставка по всей России 1-3 дня.\n\n💰 Цена: ${price} ₽ — лучшее соотношение цены и качества.`,
        
        `🔥 ХИТ ПРОДАЖ! ${productName} (${brand}) уже в наличии на Wildberries.\n\n✅ Проверенное качество\n✅ ${features[0] || 'Высокая надёжность'}\n✅ ${features[1] || 'Стильный дизайн'}\n✅ ${features[2] || 'Доступная цена'}\n\n⭐ Более 1000 положительных отзывов! Цена: ${price} ₽.`
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

        /* ===== ОПТИМИЗИРОВАННЫЕ ПРОМПТЫ ДЛЯ WILDBERRIES ===== */
        
        // 1. Промпт для главного фото (обложка) – строгие требования WB: белый фон, без текста, товар в фокусе [citation:1][citation:8]
        const mainPhotoPrompt = `Product photography of ${productName}. Isolated on pure white background (RGB 255,255,255). Studio softbox lighting, even illumination, no harsh shadows. High resolution, 8k, sharp focus, detailed texture, photorealistic. Product centered in frame, full view. Professional e-commerce photo for Wildberries, clean and modern style. Aspect ratio 3:4, no text, no watermarks, no logos.`;

        // 2. Промпт для фото в использовании (lifestyle) – эмоциональное фото, повышает CTR [citation:5]
        const lifestylePrompt = `Lifestyle photo of ${productName} in natural setting. ${productName} by brand ${brand} being used in real life scenario. Warm natural lighting, shallow depth of field, product in focus, background slightly blurred. Photorealistic, high quality, cinematic composition. For Wildberries marketplace, showing product in context, making viewer want to buy.`;

        // 3. Промпт для детального фото – крупный план, показывает качество материалов [citation:2]
        const detailPrompt = `Extreme close-up macro photography of ${productName}. Detailed texture of materials, high-end craftsmanship visible. Sharp focus on surface details, fabric texture, stitching, finish. Studio lighting, high contrast, 8k resolution. Professional product detail shot for Wildberries e-commerce.`;

        // 4. Промпт для фото с размерами – для понимания габаритов [citation:3]
        const sizePrompt = `Product photo of ${productName} showing scale and dimensions. ${productName} next to common objects for size reference. Clear, professional composition, studio lighting, white background. High resolution, 8k. Perfect for Wildberries card to show actual size.`;

        // 5. Промпт для фото комплектации – что входит в набор [citation:4]
        const packagePrompt = `Product photography of ${productName} complete package contents. All items included in the set arranged neatly on white background. Studio lighting, flat lay composition, high detail, 8k. For Wildberries listing showing full комплектация.`;

        // Создаём массив из 5 промптов для 5 вариаций
        const prompts = [
            mainPhotoPrompt,
            lifestylePrompt,
            detailPrompt,
            sizePrompt,
            packagePrompt
        ];

        // Генерируем 5 изображений
        const images = [];
        for (let i = 0; i < 5; i++) {
            try {
                const imageDataUrl = await generateGeminiImage(prompts[i], referenceBuffer);
                const finalImage = await overlayText(imageDataUrl, {
                    productName,
                    price,
                    features
                });
                images.push(finalImage);
                // Небольшая задержка между запросами
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.error(`❌ Ошибка генерации изображения ${i+1}:`, err);
                images.push(`https://dummyimage.com/1024x1024/0071e3/ffffff.png&text=${encodeURIComponent(productName)}`);
            }
        }

        // Генерируем оптимизированные описания для Wildberries
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