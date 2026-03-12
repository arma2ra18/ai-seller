import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import sharp from 'sharp';

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
                aspectRatio: '3:4', // 900x1200 = 3:4
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

/**
 * Построение промпта с учётом всех требований Wildberries
 */
function buildPrompt(productName, brand, price, userFeatures, attempt, category) {
    
    // Запрещённые фразы
    const forbiddenPhrases = [
        'НЕ используй фразы: "хит", "лучший из всех", "лидер продаж", "топ", "номер 1"',
        'НЕ добавляй цены, QR-коды, скидки, контакты, ссылки',
        'НЕ используй призывы к действию (позвони, сравни, купи, закажи)',
        'НЕ указывай количество проданных товаров',
        'НЕ добавляй вознаграждение за отзыв',
        'НЕ используй оценочные суждения'
    ].join('. ');

    // Визуальные требования
    const visualRequirements = [
        'Товар на главной фотографии НЕ обрезан и виден ПОЛНОСТЬЮ',
        'Фотография качественная, предмет продажи — в ФОКУСЕ и НЕ искажён',
        'ФОН: нейтральный, чистый, ровный и контрастный товару',
        'Если есть модель: равномерный мягкий свет, без глубоких теней и резких бликов',
        'При модельной съёмке у пола и стен презентабельный вид',
        'На фотографиях НЕТ логотипов, бирок, акций или посторонних изображений',
        'Предмет продажи занимает МАКСИМАЛЬНУЮ площадь кадра',
        'Товар имеет презентабельный вид: он не битый, не мятый, не грязный',
        'Если это набор товаров — полный состав набора виден на первой фотографии',
        'Все фотографии для одного товара — в едином стиле',
        'Позы моделей естественны и расслаблены. НЕ использовать вызывающие или вульгарные образы'
    ].join('. ');

    // Категорийные особенности
    let categoryGuidelines = '';
    switch(category) {
        case 'clothing':
            categoryGuidelines = 'Одежда: модель демонстрирует товар, видна посадка, ткань, фактура. Равномерное освещение, без бликов.';
            break;
        case 'electronics':
            categoryGuidelines = 'Электроника: товар в центре, видны все порты/разъёмы, экран включён (с красивой заставкой), фон тёмный/технологичный.';
            break;
        case 'home':
            categoryGuidelines = 'Товары для дома: уютная обстановка, естественный свет, товар в использовании или на нейтральном фоне.';
            break;
        case 'beauty':
            categoryGuidelines = 'Косметика: красивая упаковка, текстура продукта, возможен показ на коже (ровный тон, без покраснений).';
            break;
        case 'food':
            categoryGuidelines = 'Продукты: аппетитный вид, свежие ингредиенты, естественный свет, товар в упаковке и рядом.';
            break;
        default:
            categoryGuidelines = 'Нейтральный фон, товар в центре, максимальная детализация.';
    }

    return `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая идеально соответствует требованиям маркетплейса и увеличит продажи.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
**Категория:** ${category}
**Ключевые особенности от пользователя:** ${userFeatures.join(', ')}

### **ПРАВИЛА WILDBERRIES (СТРОГОЕ СОБЛЮДЕНИЕ):**

#### 1. ВИЗУАЛЬНЫЕ ТРЕБОВАНИЯ:
${visualRequirements}

#### 2. ЗАПРЕЩЁННЫЙ КОНТЕНТ:
${forbiddenPhrases}

#### 3. КОМПОЗИЦИЯ:
- Товар в центре, занимает 70-80% площади кадра
- Вокруг товара — информационные блоки (название, цена, характеристики)
- Используй выноски и указатели, чтобы связать текст с деталями товара
- Текст должен быть крупным, читаемым, контрастным

#### 4. ЦВЕТОВАЯ СТРАТЕГИЯ (для категории ${category}):
${categoryGuidelines}

#### 5. ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Разрешение: 900×1200 пикселей (вертикальная карточка)
- Формат: JPEG с высоким качеством (без артефактов сжатия)
- Товар в фокусе, не искажён, без размытий
- Тени мягкие, реалистичные

#### 6. СТИЛЬ (выбери подходящий для категории):
- Для премиальных/технологичных товаров: глубокий тёмный фон, товар светится
- Для дома/еды: тёплые, "вкусные" тона (бежевый, терракотовый, мягкий зелёный)
- Для молодёжи/спорта: яркие, контрастные цвета

### **ЗАДАЧА:**
Создай фото-карточку, которая:
✅ Полностью соответствует всем правилам Wildberries выше
✅ Выглядит профессионально и продающе
✅ Не содержит запрещённых элементов
✅ Товар виден идеально, фон не отвлекает
✅ Текст читается легко

Сгенерируй изображение для попытки №${attempt + 1} из 5. Вариант должен отличаться от предыдущих (другая композиция, цветовая гамма или расположение текста), но сохранять все ключевые элементы товара.`;
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
        const category = fields.category?.[0] || 'electronics';
        const platform = fields.platform?.[0] || 'wb';
        const attempt = parseInt(fields.attempt?.[0]) || 0;
        const originalImageId = fields.originalImageId?.[0] || null;

        // Получаем шаблон, если он передан
        let template = null;
        if (fields.template?.[0]) {
            try {
                template = JSON.parse(fields.template[0]);
                console.log('🎨 Получен шаблон:', template.name);
            } catch (e) {
                console.error('Ошибка парсинга шаблона:', e);
            }
        }

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

        // Строим базовый промпт с учётом правил Wildberries
        let finalPrompt = buildPrompt(
            productName, 
            brand, 
            price, 
            userFeatures, 
            attempt,
            category
        );

        // Добавляем информацию о шаблоне, если он есть
        if (template) {
            finalPrompt += `

### **Дополнительные требования к дизайну (строго соблюдай):**
- Основной цвет (для заголовков): ${template.colors.primary}
- Вторичный цвет (для цены): ${template.colors.secondary}
- Акцентный цвет (для иконок и галочек): ${template.colors.accent}
- Цвет фона: ${template.colors.background}
- Цвет карточки: ${template.colors.cardBg || template.colors.background}
- Стиль шаблона: ${template.name}
- Расположение текста: ${template.layout === 'centered' ? 'по центру' : 
                         template.layout === 'left' ? 'слева' : 
                         template.layout === 'right' ? 'справа' : 'асимметричное'}
- Шрифт заголовка: ${template.fonts.title}
- Шрифт цены: ${template.fonts.price}
- Шрифт особенностей: ${template.fonts.features}

Используй эти цвета и шрифты в карточке. Основной цвет применяй для заголовка, вторичный для цены, акцентный для иконок и галочек.`;
        }

        // Добавляем вариативность
        finalPrompt += `\n\nЭто попытка №${attempt + 1} из 5. Сделай этот вариант отличным от предыдущих, но сохрани все ключевые элементы товара.`;

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
            size: processed.size,
            template: template ? template.name : null
        });
    } catch (error) {
        console.error('❌ Ошибка в handler:', error);
        res.status(500).json({ error: error.message });
    }
}