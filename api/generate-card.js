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
 * БАЗОВЫЙ ИДЕАЛЬНЫЙ ПРОМПТ (общий для всех категорий)
 */
function getBasePrompt(productName, brand, price, userFeatures, attempt) {
    
    // Запрещённые фразы (правила Wildberries)
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

    return `Ты — ведущий дизайнер инфографики для Wildberries. Твоя задача создать фото-карточку товара, которая идеально соответствует требованиям маркетплейса и увеличит продажи.

**Товар:** "${productName}"
**Бренд:** ${brand}
**Цена:** ${price} ₽
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

#### 4. ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:
- Разрешение: 900×1200 пикселей (вертикальная карточка)
- Формат: JPEG с высоким качеством (без артефактов сжатия)
- Товар в фокусе, не искажён, без размытий
- Тени мягкие, реалистичные

Сгенерируй изображение для попытки №${attempt + 1} из 5. Вариант должен отличаться от предыдущих (другая композиция, цветовая гамма или расположение текста), но сохранять все ключевые элементы товара.`;
}

/**
 * КАТЕГОРИЯ: ЮВЕЛИРНЫЕ УКРАШЕНИЯ (кольца, серьги, цепочки)
 */
function getJewelryPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const jewelrySpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ ЮВЕЛИРНЫХ УКРАШЕНИЙ:**

1. **ДЕТАЛИЗАЦИЯ:**
   - Обязательно покажи пробу металла (например, 585, 925, 750) — добавь на карточку
   - Укажи тип металла: золото, серебро, платина, родий
   - Для вставок: тип камней (фианиты, цирконы, бриллианты), огранка (Кр57, Кр17), количество, караты
   - Для цепочек/браслетов: длина, ширина, тип плетения
   - Для колец: размеры (размер пальца), ширина шинки

2. **ПРЕЗЕНТАЦИЯ:**
   - Украшение должно быть идеально чистым, без отпечатков пальцев, блики минимальны
   - Покажи украшение под разными углами (крупным планом камень/плетение)
   - Для колец — вид сверху (на камни) и сбоку (профиль)
   - Для серёг — пара вместе и отдельно

3. **ФОН И ОСВЕЩЕНИЕ:**
   - Фон: бархат, замша, глянец — чёрный, бордовый, тёмно-синий
   - Освещение: мягкий рассеянный свет, подчёркивающий блеск металла и камней
   - Тени: мягкие, создающие объём

4. **УПАКОВКА:**
   - Если есть подарочная коробка/мешочек — покажи на дополнительном фото

5. **ПРИМЕР ОФОРМЛЕНИЯ:**
   - Вверху: название и бренд
   - Слева: характеристики металла (проба, цвет)
   - Справа: камни (тип, количество, огранка)
   - Внизу: цена и значок "Подарочная упаковка"

Создай карточку ювелирного украшения, которая выглядит дорого, премиально и вызывает желание купить.`;
    
    return base + jewelrySpecific;
}

/**
 * КАТЕГОРИЯ: ЭЛЕКТРОНИКА (наушники, телефоны, часы)
 */
function getElectronicsPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const electronicsSpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ ЭЛЕКТРОНИКИ:**

1. **ХАРАКТЕРИСТИКИ (обязательно показать на карточке):**
   - Для наушников: тип (TWS/полноразмерные), Bluetooth версия, ёмкость аккумулятора, время работы, быстрая зарядка, влагозащита (IPX4/7), кодек (AAC/aptX)
   - Для смарт-часов: материал ремешка, размер экрана, функции (пульс, сон, шаги), водозащита
   - Для телефонов: память (RAM/ROM), процессор, камеры, экран (диагональ, тип)
   - Для зарядок: мощность (Вт), количество портов, технология быстрой зарядки (PD, QC)

2. **ПРЕЗЕНТАЦИЯ:**
   - Товар на тёмном технологичном фоне с неоновыми акцентами
   - Экран включён (красивая заставка/логотип)
   - Покажи все порты/разъёмы крупным планом
   - Для наушников — покажи кейс и наушники отдельно

3. **ИНФОГРАФИКА:**
   - Используй иконки: батарея, Bluetooth, вода, микрофон
   - Выноски с характеристиками
   - Цена — неоновая, с эффектом свечения

Создай футуристичную, технологичную карточку, которая подчеркнёт все преимущества устройства.`;
    
    return base + electronicsSpecific;
}

/**
 * КАТЕГОРИЯ: ОДЕЖДА
 */
function getClothingPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const clothingSpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ ОДЕЖДЫ:**

1. **ХАРАКТЕРИСТИКИ:**
   - Состав ткани (100% хлопок, полиэстер и т.д.)
   - Размерная сетка (в виде иконок: S, M, L, XL)
   - Страна производства
   - Особенности ухода (деликатная стирка, не гладить и т.д.)

2. **ПРЕЗЕНТАЦИЯ:**
   - Модель демонстрирует товар (если есть модель)
   - Показать посадку на фигуре спереди, сзади, сбоку
   - Крупный план ткани/фактуры
   - Если без модели — товар на манекене или разложен ровно

3. **ФОН:**
   - Светлый, чистый, студийный (белый/бежевый/светло-серый)
   - Естественное освещение, без теней на лице модели

4. **ЦВЕТА:**
   - Передать точный оттенок товара (без искажений)
   - Если несколько цветов — показать палитру

Создай карточку одежды, где видно качество материала, посадку и фасон.`;
    
    return base + clothingSpecific;
}

/**
 * КАТЕГОРИЯ: ТОВАРЫ ДЛЯ ДОМА
 */
function getHomePrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const homeSpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ ТОВАРОВ ДЛЯ ДОМА:**

1. **ХАРАКТЕРИСТИКИ:**
   - Материал (дерево, металл, пластик, стекло)
   - Размеры (ДхШхВ)
   - Цвет
   - Страна производства
   - Уход (моется/не моется, сборка)

2. **ПРЕЗЕНТАЦИЯ:**
   - Товар в интерьере (покажи, как он выглядит в реальной обстановке)
   - Крупный план деталей (фурнитура, фактура)
   - Фото с предметами для масштаба (рядом с чашкой, книгой)

3. **ФОН:**
   - Уютный, домашний (дерево, текстиль)
   - Естественное освещение

4. **ДЛЯ ПОСУДЫ:**
   - Показать с едой/напитками (аппетитно)
   - Вид сверху, сбоку, в руке

Создай карточку, вызывающую уют и желание купить товар для дома.`;
    
    return base + homeSpecific;
}

/**
 * КАТЕГОРИЯ: КОСМЕТИКА
 */
function getBeautyPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const beautySpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ КОСМЕТИКИ:**

1. **ХАРАКТЕРИСТИКИ:**
   - Объём/вес (мл/г)
   - Тип кожи/волос
   - Эффект (увлажнение, матирование, питание)
   - Состав (ключевые компоненты: гиалурон, коллаген, масла)
   - Срок годности после вскрытия

2. **ПРЕЗЕНТАЦИЯ:**
   - Упаковка — идеально чистая, без бликов
   - Показать текстуру (крем, сыворотка, помада)
   - Свотчи (на коже) — ровный тон, без покраснений
   - До/после (если уместно)

3. **ФОН:**
   - Белый, мрамор, нежные пастельные тона
   - Чистота, минимализм, премиальность

4. **ДЛЯ ПАРФЮМА:**
   - Красивый флакон, показать шлейф (визуализация аромата)
   - Ноты: верхние, средние, базовые

Создай карточку, которая выглядит дорого, чисто и вызывает доверие к продукту.`;
    
    return base + beautySpecific;
}

/**
 * КАТЕГОРИЯ: ДЕТСКИЕ ТОВАРЫ
 */
function getChildrenPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const childrenSpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ ДЕТСКИХ ТОВАРОВ:**

1. **ХАРАКТЕРИСТИКИ:**
   - Возраст (0+, 3+ и т.д.)
   - Материалы (безопасные, гипоаллергенные)
   - Сертификаты
   - Размеры/вес

2. **ПРЕЗЕНТАЦИЯ:**
   - Товар в руках ребёнка (для игрушек)
   - Безопасность на первом плане
   - Яркие, но не кричащие цвета
   - Показать все функции/детали

3. **ФОН:**
   - Мягкий, уютный, пастельный
   - Детская комната, ковёр

4. **ЗАПРЕЩЕНО:**
   - Вульгарные позы, вызывающая одежда на детях
   - Страх, агрессия
   - Младенцы в опасных позах

Создай карточку, которая вызывает у родителей доверие и умиление.`;
    
    return base + childrenSpecific;
}

/**
 * КАТЕГОРИЯ: ПРОДУКТЫ ПИТАНИЯ
 */
function getFoodPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const foodSpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ ПРОДУКТОВ ПИТАНИЯ:**

1. **ХАРАКТЕРИСТИКИ:**
   - Вес/объём
   - Состав (крупным планом)
   - Пищевая ценность (КБЖУ)
   - Срок годности
   - Условия хранения

2. **ПРЕЗЕНТАЦИЯ:**
   - Товар должен выглядеть АППЕТИТНО
   - Фото в готовом виде (если требуется приготовление)
   - Разрез/вид изнутри
   - Показать упаковку и содержимое рядом

3. **ФОН:**
   - Тёплый, деревянный, скатерть
   - Естественное освещение
   - Стилизация под кафе/кухню

4. **ПРАВИЛА:**
   - Не использовать искусственные добавки для красоты (если их нет в составе)
   - Честная передача цвета продукта

Создай карточку, от которой захочется сразу это съесть.`;
    
    return base + foodSpecific;
}

/**
 * КАТЕГОРИЯ: АВТОТОВАРЫ
 */
function getAutoPrompt(productName, brand, price, userFeatures, attempt) {
    const base = getBasePrompt(productName, brand, price, userFeatures, attempt);
    
    const autoSpecific = `
### **СПЕЦИАЛЬНЫЕ ПРАВИЛА ДЛЯ АВТОТОВАРОВ:**

1. **ХАРАКТЕРИСТИКИ:**
   - Совместимость (марка/модель авто)
   - Материалы
   - Размеры
   - Комплектация

2. **ПРЕЗЕНТАЦИЯ:**
   - Товар на фоне авто или в салоне
   - Показать установку/использование
   - Крупный план деталей, креплений
   - Для аксессуаров — на руле/сиденье

3. **ФОН:**
   - Автосалон, гараж, дорога
   - Мужественный, технологичный стиль

4. **ДЛЯ ХИМИИ:**
   - Показать результат (до/после)
   - Безопасность для авто

Создай карточку, подчёркивающую надёжность и функциональность.`;
    
    return base + autoSpecific;
}

/**
 * УНИВЕРСАЛЬНАЯ ФУНКЦИЯ: выбирает промпт по категории
 */
function buildPromptByCategory(category, productName, brand, price, userFeatures, attempt) {
    switch(category) {
        case 'jewelry':
        case 'jewelry':
            return getJewelryPrompt(productName, brand, price, userFeatures, attempt);
        case 'electronics':
            return getElectronicsPrompt(productName, brand, price, userFeatures, attempt);
        case 'clothing':
            return getClothingPrompt(productName, brand, price, userFeatures, attempt);
        case 'home':
        case 'furniture':
        case 'kitchen':
        case 'textile':
            return getHomePrompt(productName, brand, price, userFeatures, attempt);
        case 'beauty':
            return getBeautyPrompt(productName, brand, price, userFeatures, attempt);
        case 'children':
            return getChildrenPrompt(productName, brand, price, userFeatures, attempt);
        case 'food':
            return getFoodPrompt(productName, brand, price, userFeatures, attempt);
        case 'auto':
            return getAutoPrompt(productName, brand, price, userFeatures, attempt);
        default:
            return getBasePrompt(productName, brand, price, userFeatures, attempt);
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

        // ВЫБИРАЕМ ПРОМПТ ПО КАТЕГОРИИ
        let finalPrompt = buildPromptByCategory(
            category,
            productName,
            brand,
            price,
            userFeatures,
            attempt
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

        console.log(`📝 Используем промпт для категории: ${category}`);

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