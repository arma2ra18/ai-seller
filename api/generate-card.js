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
  }
}
const bucket = admin.storage().bucket();

export const config = {
    api: {
        bodyParser: false,
        maxDuration: 180,
    },
};

// Инициализация Gemini
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    console.error('❌ GOOGLE_API_KEY not set');
}
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

/**
 * Генерация изображения через Gemini с референсом
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
                aspectRatio: '3:4',
                googleSearch: {
                    enable: true
                }
            }
        });

        if (!response.candidates || !response.candidates[0]) {
            throw new Error('Нет ответа от Gemini');
        }

        if (response.candidates[0].content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini generation error:', error);
        throw error;
    }
}

/**
 * Генерация изображения через Gemini БЕЗ референса (только по тексту)
 */
async function generateGeminiImageFromText(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: [prompt],
            config: {
                responseModalities: ['Image'],
                aspectRatio: '3:4',
                googleSearch: {
                    enable: true
                }
            }
        });

        if (!response.candidates || !response.candidates[0]) {
            throw new Error('Нет ответа от Gemini');
        }

        if (response.candidates[0].content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini generation error:', error);
        throw error;
    }
}

/**
 * Создание пустого референса для случаев, когда фото не загружено
 */
function createEmptyReference() {
    // Создаем простой серый квадрат как референс для Gemini
    const svg = `<svg width="900" height="1200" xmlns="http://www.w3.org/2000/svg">
        <rect width="900" height="1200" fill="#f0f0f0"/>
        <text x="450" y="600" font-family="Arial" font-size="24" fill="#333333" text-anchor="middle">
            Генерация по описанию...
        </text>
    </svg>`;
    return Buffer.from(svg);
}

/**
 * Пост-обработка изображения: ресайз до 900x1200 и сжатие
 */
async function processImage(base64Data) {
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 data');
    }
    
    const base64 = matches[2];
    const buffer = Buffer.from(base64, 'base64');
    
    const processedBuffer = await sharp(buffer)
        .resize(900, 1200, {
            fit: 'cover',
            position: 'center'
        })
        .jpeg({ 
            quality: 85,
            mozjpeg: true
        })
        .toBuffer();
    
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
    // Добавляем CORS headers для отладки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('🚀 Начало генерации карточки');

        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            console.error('❌ GOOGLE_API_KEY not set');
            return res.status(500).json({ error: 'GOOGLE_API_KEY not set' });
        }

        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) {
                    console.error('Form parse error:', err);
                    reject(err);
                } else {
                    resolve({ fields, files });
                }
            });
        });

        const productName = fields.productName?.[0] || '';
        const brand = fields.brand?.[0] || '';
        const price = fields.price?.[0] || '1990';
        const userFeatures = (fields.features?.[0] || '').split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || 'wb';
        const attempt = parseInt(fields.attempt?.[0]) || 0;
        const originalImageId = fields.originalImageId?.[0] || null;

        console.log('📦 Данные:', { productName, brand, price, userFeatures, platform, attempt, originalImageId });

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        let referenceBuffer = null;
        let savedOriginalId = null;
        let isGeneratedFromText = false;

        // Если передан originalImageId - загружаем его для повторной генерации
        if (originalImageId) {
            try {
                console.log('🔄 Загружаем оригинал из Storage:', originalImageId);
                const file = bucket.file(`originals/${originalImageId}`);
                const [fileBuffer] = await file.download();
                referenceBuffer = fileBuffer;
                console.log('✅ Оригинал загружен');
            } catch (err) {
                console.error('❌ Не удалось загрузить оригинал из Storage:', err);
                return res.status(400).json({ error: 'Original image not found' });
            }
        }
        // Если нет originalImageId, но есть загруженные фото - используем их
        else if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
                console.log(`✅ Загружено референсное изображение: ${photoArray[0].originalFilename}`);
            }
        }
        // Если нет ни originalImageId, ни фото - генерируем с нуля
        else {
            console.log('📝 Фото не загружено, генерируем изображение с нуля по описанию');
            isGeneratedFromText = true;
            // Создаем пустой референс (некоторые модели Gemini требуют изображение)
            referenceBuffer = createEmptyReference();
        }

        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No reference image available' });
        }

        // Сохраняем оригинал только для первой генерации (attempt === 0)
        // Это нужно для будущих повторных генераций
        if (attempt === 0 && !originalImageId) {
            // Оригинал будет сохранен после генерации
        }

        // ===== БАЗОВЫЙ ПРОМПТ СО СТИЛЯМИ, ЦВЕТАМИ И 3D-ЭФФЕКТАМИ =====
        const baseStylePrompt = `Ты — ведущий дизайнер инфографики с 10-летним опытом. Твоя задача создать фото-карточку товара, которая взорвет продажи, выглядит премиально и современно.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
**Ключевые особенности от пользователя:** ${userFeatures.join(', ')}

### **ГЛАВНОЕ: СТИЛЬ И АТМОСФЕРА**
Создай фото в стиле **премиального 3D-рендера** (как в рекламе Apple или Dior). 
- Используй **C4D-стиль** (Cinema 4D) — чистые линии, идеальные формы, фотореализм
- Добавь **мягкое глобальное освещение** с тремя источниками: основной свет спереди-сбоку, контровой свет сзади для отделения от фона, заполняющий свет снизу
- Тени должны быть **мягкими, но контрастными** — товар должен "парить" над фоном
- Используй **эффект DOF (размытие фона)** для выделения товара
- Добавь **микро-блики** на гранях и поверхностях — товар должен выглядеть сочно и дорого

### **ЦВЕТОВАЯ ГАРМОНИЯ (выбери автоматически под категорию):**
- **Для электроники:** глубокий синий (#0A1A2F) или космический черный с градиентом, акценты — неоново-голубые линии
- **Для одежды:** мягкие пастельные тона (пудровый, мятный, лавандовый) с золотыми акцентами
- **Для косметики:** розовое золото, перламутровые переливы, жемчужно-белый фон
- **Для дома:** теплые древесные тона, уютный бежевый, легкая текстура льна
- **Для спорта:** динамичные градиенты (оранжевый → красный), эффект движения

### **3D-ЭФФЕКТЫ (ОБЯЗАТЕЛЬНО):**
- Товар должен быть **объемным** — добавь легкую дисторсию по краям (эффект широкоугольного объектива)
- Используй **parallax-эффект** — мелкие элементы (иконки, текст) слегка смещены относительно товара
- Добавь **глубину резкости** — передний план четкий, задний план мягко размыт
- Тени должны быть **многослойными**: основная тень под товаром + легкая тень от текстовых блоков
- Создай **эффект свечения** вокруг цены и ключевых фишек (мягкое outer glow)

### **ТИПОГРАФИКА (ПРЕМИУМ):**
- **Название товара:** жирный гротеск (типа Helvetica Now или Gotham), размер 40-50pt, с легкой вогнутостью
- **Цена:** самый яркий элемент — сделай её "золотой" с градиентом от #F5B041 до #FFD700, добавь внутреннюю тень для объема
- **Характеристики:** чистый шрифт (SF Pro или Inter), размер 20pt, сгруппируй в аккуратные плашки с закругленными углами и полупрозрачным фоном (backdrop-filter)
- Добавь **иконки-эмодзи** перед каждой характеристикой — они увеличивают кликабельность на 30%

### **КОМПОЗИЦИЯ (ЗОЛОТОЕ СЕЧЕНИЕ):**
- Размести товар по правилу третей — в левой или правой трети кадра
- Вокруг товара создай **информационные модули**, которые "парят" в воздухе
- Используй **направляющие линии** от товара к текстовым блокам (тонкие линии или стрелки)
- Сделай **иерархию**: название (крупно), цена (контрастно), характеристики (детали)
- Добавь **микро-взаимодействия**: маленькие кружочки или точки, которые создают ощущение движения

### **ПОИСК РЕАЛЬНЫХ ХАРАКТЕРИСТИК (ОБЯЗАТЕЛЬНО):**
Включи Search Grounding и найди реальные технические характеристики для "${productName}". Например:
- Для наушников: частотный диапазон, импеданс, версия Bluetooth, время работы, вес
- Для телефонов: процессор, объем памяти, размер экрана, емкость аккумулятора
- Для одежды: состав ткани, размерная сетка, страна производства
Используй ТОЛЬКО реальные данные — никакой отсебятины!`;

        // ===== ПРАВИЛА ДЛЯ WILDBERRIES =====
        const wbRules = `

### **ПРАВИЛА WILDBERRIES (СТРОГО):**
1. **Запрещённые фразы:** НЕТ словам "хит", "лидер продаж", "топ", "номер 1", "бестселлер"
2. **Запрещённый контент:** НЕТ QR-кодам, скидкам, промокодам, контактам, ссылкам
3. **Запрещённые призывы:** НЕТ "купи", "закажи", "позвони", "сравни"
4. **Визуальные требования:** товар полностью виден, не обрезан, в фокусе, фон нейтральный, без логотипов и бирок
5. **Технические требования:** 900×1200, JPEG, <10 МБ, товар занимает 60-70% кадра`;

        // ===== ПРАВИЛА ДЛЯ OZON =====
        const ozonRules = `

### **ПРАВИЛА OZON (СТРОГО):**
1. **Технические требования:**
   - Формат: JPEG, JPG, PNG — качество 90% (без артефактов)
   - Разрешение: 900 × 1200 пикселей (соотношение 3:4) обязательно
   - Размер файла: не более 10 МБ
   - Только цветные изображения (Ч/б запрещены)

2. **Запрещено:**
   - ❌ Никаких водяных знаков — ни на главном, ни на дополнительных фото
   - ❌ Никаких надписей с ценами, скидками, промокодами, контактными данными
   - ❌ Никаких призывов к действию ("позвони", "сравни", "купи", "закажи")
   - ❌ Никакой информации о доставке (сроки, стоимость, география) или возврате
   - ❌ Никаких коллажей — фото должно быть цельным
   - ❌ Никаких 3D-моделей или эскизов — только реальное фото товара
   - ❌ Никаких "домашних" фото (на фоне ковра, мебели, с тенями)

3. **Требования к качеству:**
   - Чёткость: товар в фокусе, фото не размытое
   - Цветопередача: естественные цвета
   - Товар показан полностью — на главном фото виден целиком
   - Композиция: товар занимает большую часть кадра
   - Фон: чистый, однородный, нейтральный

4. **Для главного фото:**
   - Товар показан с лицевой стороны
   - Фото не перевёрнуто
   - Можно добавить инфографику, но аккуратно и не перекрывая товар
   - Для одежды, мебели, постельного белья — можно фото на человеке или в интерьере

5. **Для категорий 18+:**
   - Интимные части тела должны быть размыты или скрыты`;

        // Формируем финальный промпт в зависимости от платформы
        let finalPrompt;
        if (platform === 'wb') {
            finalPrompt = baseStylePrompt + wbRules;
            console.log('🎯 Используем промпт для Wildberries');
        } else {
            finalPrompt = baseStylePrompt + ozonRules;
            console.log('🎯 Используем промпт для Ozon');
        }

        // Добавляем информацию о том, что фото генерируется с нуля
        if (isGeneratedFromText) {
            finalPrompt += `\n\n### **ВАЖНО:** У тебя нет фотографии товара. Создай изображение товара "${productName}" с нуля, основываясь на описании. Товар должен выглядеть реалистично, как на профессиональной предметной съемке.`;
        }

        const variation = `\n\nЭто попытка №${attempt + 1} из 5. Сделай этот вариант максимально отличным от предыдущих: поменяй ракурс, цветовую гамму, композицию, но сохрани все ключевые элементы и реальные характеристики.`;
        
        finalPrompt += variation;

        let imageDataUrl;
        try {
            console.log(`🎨 Генерация изображения (попытка ${attempt + 1})...`);
            
            if (isGeneratedFromText && attempt === 0 && !originalImageId) {
                // Генерируем с нуля (без референса)
                imageDataUrl = await generateGeminiImageFromText(finalPrompt);
            } else {
                // Генерируем с референсом
                imageDataUrl = await generateGeminiImage(finalPrompt, referenceBuffer);
            }
            
            console.log('✅ Изображение сгенерировано');
        } catch (err) {
            console.error(`❌ Ошибка при генерации изображения:`, err);
            return res.status(500).json({ error: 'Failed to generate image: ' + err.message });
        }

        const processed = await processImage(imageDataUrl);
        
        // Сохраняем сгенерированное изображение
        const fileName = `card_${Date.now()}_${attempt}.jpg`;
        const publicUrl = await uploadToStorage(processed.buffer, fileName, processed.mimeType);

        // ВАЖНО: Для первой генерации (attempt === 0) всегда сохраняем оригинал
        // Это нужно для повторных генераций, даже если фото не было загружено
        if (attempt === 0 && !originalImageId) {
            try {
                const originalFileName = `original_${Date.now()}.jpg`;
                const originalFile = bucket.file(`originals/${originalFileName}`);
                
                await originalFile.save(processed.buffer, {
                    metadata: { 
                        contentType: 'image/jpeg',
                        metadata: {
                            productName: productName,
                            platform: platform
                        }
                    },
                    public: false
                });
                
                savedOriginalId = originalFileName;
                console.log('💾 Сохранен originalImageId для повторных генераций:', savedOriginalId);
            } catch (err) {
                console.error('❌ Ошибка сохранения оригинала:', err);
                // Продолжаем, даже если не удалось сохранить оригинал
            }
        }

        // Удаляем временные файлы, если они были
        if (files.photos) {
            const photoArray = Array.isArray(files.photos) ? files.photos : [files.photos];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Успешно сгенерировано изображение 900x1200');
        
        // Возвращаем результат с originalImageId
        res.status(200).json({ 
            images: [publicUrl], 
            descriptions: [],
            originalImageId: savedOriginalId, // Всегда передаем, если сохранили
            attempt: attempt,
            dimensions: '900x1200',
            size: processed.size,
            generatedFromText: isGeneratedFromText
        });

    } catch (error) {
        console.error('❌ Критическая ошибка в handler:', error);
        console.error('Stack:', error.stack);
        
        let statusCode = 500;
        let errorMessage = 'Internal server error';
        
        if (error.message.includes('API key')) {
            errorMessage = 'Invalid Google API key';
        } else if (error.message.includes('model')) {
            errorMessage = 'Gemini model error';
        } else if (error.message.includes('bucket')) {
            errorMessage = 'Firebase Storage error';
        } else if (error.message.includes('quota')) {
            errorMessage = 'API quota exceeded';
            statusCode = 429;
        }
        
        res.status(statusCode).json({ 
            error: errorMessage,
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
}