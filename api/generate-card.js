import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

// Инициализация Firebase Admin SDK
if (!admin.apps.length) {
  try {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountEnv) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
    }
    const serviceAccount = JSON.parse(serviceAccountEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    throw new Error(`Firebase init failed: ${error.message}`);
  }
}
const bucket = admin.storage().bucket();

export const config = {
    api: {
        bodyParser: false,
        maxDuration: 180,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

/**
 * Генерация одного изображения через Gemini
 */
async function generateGeminiImage(prompt, referenceImage) {
    try {
        const base64Image = referenceImage.toString('base64');
        
        // Используем правильную модель для генерации изображений
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash-exp', // Эта модель поддерживает изображения
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: base64Image
                            }
                        },
                        {
                            text: prompt
                        }
                    ]
                }
            ],
            config: {
                responseModalities: ['Text', 'Image'],
                temperature: 1,
                topK: 32,
                topP: 1,
                maxOutputTokens: 8192,
            }
        });

        if (!response || !response.candidates || !response.candidates[0]) {
            throw new Error('Нет ответа от Gemini');
        }

        const candidate = response.candidates[0];
        
        if (!candidate.content || !candidate.content.parts) {
            throw new Error('Ответ не содержит parts');
        }

        // Ищем изображение в ответе
        for (const part of candidate.content.parts) {
            if (part.inlineData && part.inlineData.data) {
                return `data:${part.inlineData.mimeType || 'image/jpeg'};base64,${part.inlineData.data}`;
            }
        }
        
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini generation error:', error);
        throw error;
    }
}

/**
 * Загружает изображение в Firebase Storage и возвращает публичный URL.
 */
async function uploadToStorage(base64Data, fileName) {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 data');
    }
    const mimeType = matches[1];
    const base64 = matches[2];
    const buffer = Buffer.from(base64, 'base64');

    const file = bucket.file(`generated/${fileName}`);
    await file.save(buffer, {
        metadata: { contentType: mimeType },
        public: true,
    });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`Uploaded to Storage: ${publicUrl}`);
    return publicUrl;
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
        const attempt = parseInt(fields.attempt?.[0]) || 0;
        const originalImageId = fields.originalImageId?.[0] || null;

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        let referenceBuffer = null;
        let savedOriginalId = null;

        // Загружаем референсное изображение
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
                console.log(`Loaded reference image: ${photoArray[0].originalFilename}`);
            }
        } else if (originalImageId) {
            try {
                const file = bucket.file(`originals/${originalImageId}`);
                const [fileBuffer] = await file.download();
                referenceBuffer = fileBuffer;
                console.log(`Loaded original image from Storage: ${originalImageId}`);
            } catch (err) {
                console.error('Failed to load original image from Storage:', err);
                return res.status(400).json({ error: 'Original image not found' });
            }
        }

        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded or original image not found' });
        }

        // Сохраняем оригинал при первой генерации
        if (attempt === 0 && files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) {
                const originalFileName = `original_${Date.now()}_${photoArray[0].originalFilename}`;
                const file = bucket.file(`originals/${originalFileName}`);
                await file.save(referenceBuffer, { 
                    metadata: { contentType: photoArray[0].mimetype }, 
                    public: false 
                });
                savedOriginalId = originalFileName;
                console.log(`Saved original image as: ${originalFileName}`);
            }
        }

        // ПОЛНЫЙ УЛЬТРА-ПРОМПТ (восстановлен)
        const basePrompt = `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая привлечет максимум внимания и увеличит продажи.

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

        const variation = ` (Попытка ${attempt + 1}. Вариант ${attempt + 1} из 5: используй другое расположение текста, цветовую гамму или композицию, но сохрани все ключевые элементы товара)`;
        const finalPrompt = basePrompt + variation;

        let imageDataUrl;
        try {
            console.log(`Generating image (attempt ${attempt + 1})...`);
            imageDataUrl = await generateGeminiImage(finalPrompt, referenceBuffer);
        } catch (err) {
            console.error(`❌ Ошибка при генерации изображения:`, err);
            return res.status(500).json({ error: 'Failed to generate image: ' + err.message });
        }

        // Загружаем в Storage
        const fileName = `card_${Date.now()}_${attempt}.jpg`;
        const publicUrl = await uploadToStorage(imageDataUrl, fileName);
        
        // Удаляем временные файлы
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Успешно сгенерировано изображение');
        res.status(200).json({ 
            images: [publicUrl], 
            originalImageId: savedOriginalId,
            attempt: attempt
        });
        
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}