import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

// Инициализация Firebase Admin SDK (только один раз)
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
            model: 'gemini-3.1-flash-image-preview',
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
        const platform = fields.platform?.[0] || 'wb';
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
            // Загружаем оригинал из Storage для повторных генераций
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

        // ===== УЛУЧШЕННЫЙ ПРОМПТ С ПРАВИЛАМИ WILDBERRIES =====
        const basePrompt = `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая привлечет максимум внимания и увеличит продажи.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
**Ключевые особенности от пользователя:** ${userFeatures.join(', ')}

### **ПРАВИЛА СОЗДАНИЯ ШЕДЕВРА (с учётом требований Wildberries):**

#### 1. ИСПОЛЬЗУЙ СВОИ ЗНАНИЯ
На основе названия "${productName}", найди в своей базе данных реальные характеристики, технические детали и преимущества этого товара. Добавь их на карточку в виде иконок или коротких надписей. Обязательно используй эту информацию.

#### 2. ЗАПРЕЩЁННЫЙ КОНТЕНТ (строгое соблюдение правил Wildberries):
- НЕ используй фразы: "хит", "лучший из всех", "лидер продаж", "топ", "номер 1"
- НЕ добавляй цены, QR-коды, скидки, контакты, ссылки на посторонние сайты
- НЕ используй призывы к действию (позвони, сравни, купи, закажи)
- НЕ указывай количество проданных товаров
- НЕ добавляй вознаграждение за отзыв
- НЕ используй оценочные суждения

#### 3. ВИЗУАЛЬНЫЕ ТРЕБОВАНИЯ (из правил Wildberries):
- Товар на главной фотографии НЕ обрезан и виден ПОЛНОСТЬЮ
- Фотография качественная, предмет продажи — в ФОКУСЕ и НЕ искажён
- ФОН: нейтральный, чистый, ровный и контрастный товару (товар хорошо виден, фон не отвлекает)
- На фотографиях НЕТ логотипов, бирок, акций или посторонних изображений
- Предмет продажи занимает МАКСИМАЛЬНУЮ площадь кадра
- Товар имеет презентабельный вид: он не битый, не мятый, не грязный
- Если это набор товаров — полный состав набора виден на первой фотографии
- Все фотографии для одного товара — в едином стиле

#### 4. ЦВЕТОВАЯ СТРАТЕГИЯ (выбери подходящую):
- Если товар премиальный или технологичный, используй глубокий, насыщенный фон (тёмно-синий, чёрный, изумрудный). Товар должен светиться на нём.
- Если товар для дома, уюта или еда, используй тёплые, "вкусные" тона (бежевый, терракотовый, мягкий зелёный).
- Если товар для молодёжи или спорта, добавь яркие, контрастные цвета.

#### 5. 3D И ОБЪЁМ:
Добавь мягкие, но заметные 3D-эффекты. Товар должен выглядеть объёмно. Тени должны быть реалистичными.

#### 6. ТИПОГРАФИКА (разные шрифты):
- **Название товара:** Крупный, жирный, современный шрифт.
- **Цена:** Самый яркий элемент. Сделай её "золотой", неоновой или обведи контуром. Добавь эффект лёгкого свечения.
- **Характеристики:** Используй чистый, хорошо читаемый шрифт. Сгруппируй их в аккуратные блоки.

#### 7. КОМПОЗИЦИЯ (как у лучших селлеров):
- Размести товар в центре. Вокруг него, словно на прилавке магазина, разложи информацию.
- **Вверху:** Название и главный слоган.
- **По бокам:** Ключевые фишки в виде иконок с подписями (например: шумоподавление 🎧, влагозащита 💧, 30ч работы 🔋).
- **Внизу:** Цена и стилизованная кнопка призыва к покупке.
- Используй выноски и указатели, чтобы связать текст с деталями товара.

#### 8. ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Разрешение: 900×1200 пикселей (вертикальная карточка, соотношение 3:4)
- Формат: JPEG с высоким качеством (без артефактов сжатия)
- Товар в фокусе, не искажён, без размытий

#### 9. ЗАПРЕЩЕНО:
- Белый фон, скучный минимализм, мелкий нечитаемый текст, пустота.
- Карточка должна быть насыщенной, но гармоничной.

Создай фото-карточку, от которой невозможно оторвать взгляд, полностью соответствующую правилам Wildberries.`;

        const variation = ` (Попытка ${attempt + 1}. Вариант ${attempt + 1} из 5: используй другое расположение текста, цветовую гамму или композицию, но сохрани все ключевые элементы товара)`;
        const finalPrompt = basePrompt + variation;

        let imageDataUrl;
        try {
            console.log(`Generating image (attempt ${attempt + 1})...`);
            imageDataUrl = await generateGeminiImage(finalPrompt, referenceBuffer);
        } catch (err) {
            console.error(`❌ Ошибка при генерации изображения (attempt ${attempt + 1}):`, err);
            return res.status(500).json({ error: 'Failed to generate image: ' + err.message });
        }

        // Загружаем в Storage
        const fileName = `card_${Date.now()}_${attempt}.jpg`;
        const publicUrl = await uploadToStorage(imageDataUrl, fileName);
        
        // Генерируем описания (можно варьировать в зависимости от попытки)
        const descriptions = []; // Больше не генерируем описания

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
            descriptions,
            originalImageId: savedOriginalId,
            attempt: attempt
        });
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}