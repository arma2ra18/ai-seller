import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import sharp from 'sharp';
import { 
  baseStylePrompt, 
  wbRules, 
  ozonRules,
  getVariationPrompt,
  noPhotoPrompt,
  getCategoryStyle 
} from './prompts/index.js';

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
async function generateGeminiImage(prompt, referenceImage, searchEnabled) {
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
                    enable: searchEnabled
                }
            }
        });

        console.log(`🔍 Поиск в интернете: ${searchEnabled ? 'ВКЛ' : 'ВЫКЛ'}`);

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
async function generateGeminiImageFromText(prompt, searchEnabled) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: [prompt],
            config: {
                responseModalities: ['Image'],
                aspectRatio: '3:4',
                googleSearch: {
                    enable: searchEnabled
                }
            }
        });

        console.log(`🔍 Поиск в интернете: ${searchEnabled ? 'ВКЛ' : 'ВЫКЛ'}`);

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
        const category = fields.category?.[0] || 'home';
        const color = fields.color?.[0] || '';
        const userFeatures = (fields.features?.[0] || '').split(',').map(f => f.trim()).filter(Boolean);
        const platform = fields.platform?.[0] || 'wb';
        const attempt = parseInt(fields.attempt?.[0]) || 0;
        const originalImageId = fields.originalImageId?.[0] || null;
        // const searchEnabled = fields.searchEnabled?.[0] === 'true';
const searchEnabled = true; // временно

        console.log('📦 Данные:', { 
            productName, 
            brand, 
            price, 
            category,
            color,
            userFeatures, 
            platform, 
            attempt, 
            originalImageId,
            searchEnabled 
        });

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

        // ===== ФОРМИРОВАНИЕ ПРОМПТА =====
        
        // Берём базовый промпт (со всей типографикой, 3D, эффектами)
        let finalPrompt = baseStylePrompt(productName, brand, price, userFeatures);

        // Добавляем стиль под категорию
        const categoryStyle = getCategoryStyle(category);
        finalPrompt += categoryStyle;

        // Правила платформы
        if (platform === 'wb') {
            finalPrompt += wbRules;
            console.log('🎯 Используем промпт для Wildberries');
        } else {
            finalPrompt += ozonRules;
            console.log('🎯 Используем промпт для Ozon');
        }

        // Добавляем информацию о генерации без фото
        if (isGeneratedFromText) {
            finalPrompt += noPhotoPrompt(productName);
        }

        // Добавляем вариацию для повторных генераций
        finalPrompt += getVariationPrompt(attempt, productName);

        console.log(`🎨 Попытка ${attempt + 1}/5`);

        let imageDataUrl;
        try {
            console.log(`🎨 Генерация изображения (попытка ${attempt + 1})...`);
            
            if (isGeneratedFromText && attempt === 0 && !originalImageId) {
                // Генерируем с нуля (без референса)
                imageDataUrl = await generateGeminiImageFromText(finalPrompt, searchEnabled);
            } else {
                // Генерируем с референсом
                imageDataUrl = await generateGeminiImage(finalPrompt, referenceBuffer, searchEnabled);
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
        if (attempt === 0 && !originalImageId) {
            try {
                const originalFileName = `original_${Date.now()}.jpg`;
                const originalFile = bucket.file(`originals/${originalFileName}`);
                
                await originalFile.save(processed.buffer, {
                    metadata: { 
                        contentType: 'image/jpeg',
                        metadata: {
                            productName: productName,
                            platform: platform,
                            category: category
                        }
                    },
                    public: false
                });
                
                savedOriginalId = originalFileName;
                console.log('💾 Сохранен originalImageId для повторных генераций:', savedOriginalId);
            } catch (err) {
                console.error('❌ Ошибка сохранения оригинала:', err);
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
        
        res.status(200).json({ 
            images: [publicUrl], 
            descriptions: [],
            originalImageId: savedOriginalId,
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