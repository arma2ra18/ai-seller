import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import sharp from 'sharp';

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
 * Генерация одного изображения через Gemini с Search Grounding
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
                aspectRatio: '3:4', // 900x1200
                // Включаем поиск в интернете для получения реальных характеристик
                googleSearch: {
                    enable: true  // Search Grounding включён 
                }
            }
        });

        // Логируем метаданные граундинга для отладки
        if (response.candidates && response.candidates[0] && response.candidates[0].groundingMetadata) {
            console.log('🔍 Grounding Metadata:', JSON.stringify(response.candidates[0].groundingMetadata, null, 2));
        } else {
            console.warn('⚠️ No grounding metadata found - model may be hallucinating');
        }

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
    
    // Ресайз до 900x1200 с сохранением пропорций
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
        mimeType: 'image/jpeg',
        size: processedBuffer.length
    };
}

/**
 * Загружает изображение в Firebase Storage и возвращает публичный URL.
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

        // ===== УЛУЧШЕННЫЙ ПРОМПТ С ПРИНУДИТЕЛЬНОЙ ПРОВЕРКОЙ =====
        const basePrompt = `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая привлечет максимум внимания и увеличит продажи.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
**Ключевые особенности от пользователя:** ${userFeatures.join(', ')}

### **КРИТИЧЕСКИ ВАЖНО: ИСПОЛЬЗУЙ ТОЛЬКО РЕАЛЬНЫЕ ДАННЫЕ**
Ты ОБЯЗАН использовать Search Grounding для поиска в интернете реальных характеристик этого товара. Найди актуальную информацию о модели, технических спецификациях, дате выхода, видеокарте, процессоре и других параметрах.

**ПРОВЕРКА ДАННЫХ:**
- Если ты находишь противоречивую информацию, используй самую свежую (2025 год)
- НИ В КОЕМ СЛУЧАЕ не выдумывай характеристики

#### 1. ЗАПРЕЩЁННЫЙ КОНТЕНТ (строгое соблюдение правил Wildberries):
- НЕ используй фразы: "хит", "лучший из всех", "лидер продаж", "топ", "номер 1"
- НЕ добавляй цены, QR-коды, скидки, контакты, ссылки на посторонние сайты
- НЕ используй призывы к действию (позвони, сравни, купи, закажи)
- НЕ указывай количество проданных товаров
- НЕ добавляй вознаграждение за отзыв
- НЕ используй оценочные суждения

#### 2. ВИЗУАЛЬНЫЕ ТРЕБОВАНИЯ (из правил Wildberries):
- Товар на главной фотографии НЕ обрезан и виден ПОЛНОСТЬЮ
- Фотография качественная, предмет продажи — в ФОКУСЕ и НЕ искажён
- ФОН: нейтральный, чистый, ровный и контрастный товару
- На фотографиях НЕТ логотипов, бирок, акций или посторонних изображений
- Предмет продажи занимает МАКСИМАЛЬНУЮ площадь кадра
- Товар имеет презентабельный вид: он не битый, не мятый, не грязный
- Если это набор товаров — полный состав набора виден на первой фотографии
- Все фотографии для одного товара — в едином стиле

#### 3. ЦВЕТОВАЯ СТРАТЕГИЯ (выбери подходящую):
- Для игрового ноутбука ASUS ROG используй агрессивный, технологичный фон (тёмно-синий, чёрный с RGB-акцентами)
- Добавь эффекты свечения, характерные для ROG-брендинга

#### 4. ТИПОГРАФИКА (разные шрифты):
- **Название товара:** Крупный, жирный, современный шрифт (например, Bebas Neue, Orbitron)
- **Цена:** Самый яркий элемент. Сделай её неоновой с эффектом свечения
- **Характеристики:** Используй чистый, хорошо читаемый шрифт. Сгруппируй их в аккуратные блоки

#### 5. КОМПОЗИЦИЯ:
- Размести товар в центре. Вокруг него, словно на прилавке магазина, разложи информацию
- **Вверху:** Название и главный слоган
- **По бокам:** Ключевые фишки в виде иконок с подписями (процессор, видеокарта, RAM, SSD)
- **Внизу:** Цена и стилизованная кнопка

#### 6. ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Разрешение: 900×1200 пикселей (вертикальная карточка, соотношение 3:4)
- Формат: JPEG с высоким качеством
- Товар в фокусе, не искажён, без размытий

Создай фото-карточку, от которой невозможно оторвать взгляд, используя ТОЛЬКО РЕАЛЬНЫЕ характеристики, найденные через поиск.`;

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

        // Пост-обработка: ресайз до 900x1200 и сжатие
        const processed = await processImage(imageDataUrl);
        
        // Загружаем в Storage
        const fileName = `card_${Date.now()}_${attempt}.jpg`;
        const publicUrl = await uploadToStorage(processed.buffer, fileName, processed.mimeType);
        
        // Генерируем описания (больше не генерируем)
        const descriptions = [];

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
            descriptions,
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