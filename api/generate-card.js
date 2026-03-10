import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

export const config = {
    api: {
        bodyParser: false,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация изображения через Gemini с ультра-промптом
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
                aspectRatio: '1:1',
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

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

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

        const productName = fields.productName?.[0] || '';
        const brand = fields.brand?.[0] || '';
        const price = fields.price?.[0] || '1990';
        const userFeatures = (fields.features?.[0] || '').split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || 'wb';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        let referenceBuffer = null;
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
                console.log(`Loaded reference image: ${photoArray[0].originalFilename}`);
            }
        }
        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // ========== УЛЬТРА-ПРОМПТ ==========
        const prompt = `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая привлечет максимум внимания и увеличит продажи.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
**Ключевые особенности от пользователя:** ${userFeatures.join(', ')}

### **Правила создания шедевра:**

1.  **Используй свои знания.** На основе названия "${productName}", найди в своей базе данных реальные характеристики, технические детали и преимущества этого товара. Добавь их на карточку в виде иконок или коротких надписей. Например, для "AirPods Pro" ты должна знать про чип H2, активное шумоподавление, влагозащиту IPX4 и время работы 30 часов. Обязательно используй эту информацию.

2.  **Цветовая стратегия (выбери подходящую):**
    *   Если товар премиальный или технологичный (украшения, электроника), используй глубокий, насыщенный фон (тёмно-синий, чёрный, изумрудный). Товар должен светиться на нём.
    *   Если товар для дома, уюта или еда, используй тёплые, "вкусные" тона (бежевый, терракотовый, мягкий зелёный).
    *   Если товар для молодёжи или спорта, добавь яркие, контрастные цвета.

3.  **3D и объём:** Добавь мягкие, но заметные 3D-эффекты. Товар должен выглядеть объёмно. Тени должны быть реалистичными.

4.  **Типографика (разные шрифты):**
    *   **Название товара:** Крупный, жирный, современный шрифт (например, Bebas Neue, Oswald).
    *   **Цена:** Самый яркий элемент. Сделай её "золотой", неоновой или обведи контуром. Добавь эффект лёгкого свечения.
    *   **Характеристики:** Используй чистый, хорошо читаемый шрифт (например, Roboto, Open Sans). Сгруппируй их в аккуратные блоки.

5.  **Композиция (как у лучших селлеров):**
    *   Размести товар в центре. Вокруг него, словно на прилавке магазина, разложи информацию.
    *   **Вверху:** Название и главный слоган (например, "Лидер продаж 2026").
    *   **По бокам:** Ключевые фишки в виде иконок с подписями (шумоподавление 🎧, влагозащита 💧, 30ч работы 🔋).
    *   **Внизу:** Цена и кнопка призыва к покупке (стилизованно).
    *   Используй выноски и указатели, чтобы связать текст с деталями товара.

6.  **Запрещено:** Белый фон, скучный минимализм, мелкий нечитаемый текст, пустота. Карточка должна быть насыщенной, но гармоничной.

Создай фото-карточку, от которой невозможно оторвать взгляд.`;

        const images = [];
        // Генерируем 3 разных варианта с небольшими вариациями композиции
        for (let i = 0; i < 3; i++) {
            const variation = ` (Вариант ${i+1}: попробуй другое расположение текста или цветовую гамму, но сохрани все ключевые элементы)`;
            try {
                console.log(`Generating image ${i+1}...`);
                const imageDataUrl = await generateGeminiImage(prompt + variation, referenceBuffer);
                images.push(imageDataUrl);
                console.log(`Image ${i+1} generated successfully`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Увеличил задержку
            } catch (err) {
                console.error(`❌ Ошибка при генерации изображения ${i+1}:`, err);
            }
        }

        if (images.length === 0) {
            throw new Error('Не удалось сгенерировать ни одного изображения');
        }

        // Описания (тоже сделаем более "продающими")
        const descriptions = [
            `✨ ${productName} от ${brand}. ${userFeatures.slice(0,3).join(', ')}. Премиальное качество по цене ${price} ₽.`,
            `💎 Ваш идеальный выбор: ${productName}. Всего ${price} ₽. Особенности: ${userFeatures.join(', ')}. Закажи сейчас!`,
            `🔥 Хит продаж! ${productName} — это ${userFeatures[0] || 'непревзойденное качество'}. Успей купить за ${price} ₽.`
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

        console.log('✅ Успешно сгенерировано изображений:', images.length);
        res.status(200).json({ images, descriptions });
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}