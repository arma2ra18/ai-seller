import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import sharp from 'sharp'; // Добавляем для обработки изображений

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
 * Генерация изображения через Gemini с нужным разрешением
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
                aspectRatio: '3:4', // Важно! 900x1200 = 3:4
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
 * Пост-обработка изображения: ресайз до 900x1200 и сжатие
 */
async function processImage(base64Data) {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 data');
    }
    
    const mimeType = matches[1];
    const base64 = matches[2];
    const buffer = Buffer.from(base64, 'base64');
    
    // Ресайз до 900x1200 с сохранением пропорций (crop если нужно)
    const processedBuffer = await sharp(buffer)
        .resize(900, 1200, {
            fit: 'cover',      // Обрезаем, если пропорции не совпадают
            position: 'center' // Центрируем товар
        })
        .jpeg({ 
            quality: 85,       // Качество 85% (выше 65%)
            mozjpeg: true      // Лучшее сжатие
        })
        .toBuffer();
    
    // Проверяем размер файла (не больше 10 МБ)
    const fileSizeMB = processedBuffer.length / (1024 * 1024);
    if (fileSizeMB > 10) {
        console.warn(`Размер файла ${fileSizeMB.toFixed(2)} МБ > 10 МБ, сжимаем сильнее`);
        // Если больше 10 МБ, сжимаем до 70% качества
        const smallerBuffer = await sharp(processedBuffer)
            .jpeg({ quality: 70, mozjpeg: true })
            .toBuffer();
        return {
            buffer: smallerBuffer,
            mimeType: 'image/jpeg',
            size: smallerBuffer.length
        };
    }
    
    return {
        buffer: processedBuffer,
        mimeType: 'image/jpeg', // Всегда JPEG на выходе
        size: processedBuffer.length
    };
}

/**
 * Загружает изображение в Firebase Storage
 */
async function uploadToStorage(buffer, fileName, mimeType) {
    const file = bucket.file(`generated/${fileName}`);
    await file.save(buffer, {
        metadata: { 
            contentType: mimeType,
            metadata: {
                width: '900',
                height: '1200',
                generated: 'true'
            }
        },
        public: true,
    });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    console.log(`Uploaded to Storage: ${publicUrl} (${buffer.length} bytes)`);
    return publicUrl;
}

// УЛЬТРА-ПРОМПТ с запретами Wildberries
function buildPrompt(productName, brand, price, userFeatures, attempt) {
    const forbiddenPhrases = [
        'Не используй фразы: "хит", "лучший из всех", "лидер продаж", "топ"',
        'Не добавляй цены, QR-коды, скидки, контакты',
        'Не используй призывы к действию (позвони, сравни, купи)',
        'Не указывай количество проданных товаров',
        'Не добавляй вознаграждение за отзыв'
    ].join('. ');
    
    return `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая привлечет максимум внимания и увеличит продажи.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
**Ключевые особенности от пользователя:** ${userFeatures.join(', ')}

### **Правила создания шедевра:**

1. **Используй свои знания.** На основе названия "${productName}", найди в своей базе данных реальные характеристики, технические детали и преимущества этого товара. Добавь их на карточку в виде иконок или коротких надписей.

2. **Цветовая стратегия (выбери подходящую):**
   * Если товар премиальный или технологичный, используй глубокий, насыщенный фон (тёмно-синий, чёрный, изумрудный). Товар должен светиться на нём.
   * Если товар для дома, уюта или еда, используй тёплые, "вкусные" тона (бежевый, терракотовый, мягкий зелёный).
   * Если товар для молодёжи или спорта, добавь яркие, контрастные цвета.

3. **3D и объём:** Добавь мягкие, но заметные 3D-эффекты. Товар должен выглядеть объёмно. Тени реалистичные.

4. **Типографика (разные шрифты):**
   * **Название товара:** Крупный, жирный, современный шрифт.
   * **Цена:** Самый яркий элемент. Сделай её "золотой", неоновой или обведи контуром. Добавь эффект лёгкого свечения.
   * **Характеристики:** Чистый, хорошо читаемый шрифт. Сгруппируй в аккуратные блоки.

5. **Композиция (как у лучших селлеров):**
   * Размести товар в центре. Вокруг него, словно на прилавке магазина, разложи информацию.
   * **Вверху:** Название и главный слоган.
   * **По бокам:** Ключевые фишки в виде иконок с подписями.
   * **Внизу:** Цена и стилизованная кнопка призыва к покупке.
   * Используй выноски и указатели, чтобы связать текст с деталями товара.

6. **ВАЖНО — ЗАПРЕЩЕНО (правила Wildberries):**
   ${forbiddenPhrases}

7. **Размер и пропорции:** Создавай карточку в пропорциях 3:4 (вертикальную), чтобы после обрезки получилось 900x1200 пикселей.

Создай фото-карточку, от которой невозможно оторвать взгляд, строго соблюдая правила Wildberries.`;
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

        // Строим промпт с учётом правил Wildberries
        const finalPrompt = buildPrompt(productName, brand, price, userFeatures, attempt);

        let imageDataUrl;
        try {
            console.log(`Generating image (attempt ${attempt + 1})...`);
            imageDataUrl = await generateGeminiImage(finalPrompt, referenceBuffer);
        } catch (err) {
            console.error(`❌ Ошибка при генерации изображения:`, err);
            return res.status(500).json({ error: 'Failed to generate image: ' + err.message });
        }

        // Пост-обработка: ресайз до 900x1200 и сжатие
        const processed = await processImage(imageDataUrl);
        
        // Загружаем в Storage
        const fileName = `card_${Date.now()}_${attempt}.jpg`;
        const publicUrl = await uploadToStorage(processed.buffer, fileName, processed.mimeType);
        
        // Удаляем временные файлы
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Успешно сгенерировано изображение 900x1200');
        res.status(200).json({ 
            images: [publicUrl], 
            originalImageId: savedOriginalId,
            attempt: attempt,
            dimensions: '900x1200',
            size: processed.size
        });
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}