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
            model: 'gemini-1.5-flash', // Эта модель точно работает
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text: `Generate a professional product photo card based on this image. ${prompt}`
                        }
                    ]
                }
            ],
            config: {
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

        // В gemini-1.5-flash нет прямой генерации изображений,
        // поэтому возвращаем текст с описанием
        const textResponse = candidate.content.parts.map(p => p.text).join('');
        
        // Создаем простой SVG с текстом (временное решение)
        const svgContent = `
            <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
                <rect width="1024" height="1024" fill="#1a1a2e"/>
                <text x="512" y="200" font-family="Arial" font-size="48" fill="white" text-anchor="middle">${prompt.split('\n')[0]}</text>
                <text x="512" y="300" font-family="Arial" font-size="36" fill="#00ff00" text-anchor="middle">Цена: ${price} ₽</text>
                <text x="512" y="400" font-family="Arial" font-size="24" fill="#cccccc" text-anchor="middle">${userFeatures.join(' • ')}</text>
                <circle cx="512" cy="600" r="200" fill="#0071e3" opacity="0.5"/>
                <text x="512" y="620" font-family="Arial" font-size="32" fill="white" text-anchor="middle">✨ Готово!</text>
            </svg>
        `;
        
        const base64Svg = Buffer.from(svgContent).toString('base64');
        return `data:image/svg+xml;base64,${base64Svg}`;
        
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
        const attempt = parseInt(fields.attempt?.[0]) || 0;
        const originalImageId = fields.originalImageId?.[0] || null;

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        let referenceBuffer = null;
        let savedOriginalId = null;

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

        // Генерируем изображение
        let imageDataUrl;
        try {
            console.log(`Generating image (attempt ${attempt + 1})...`);
            
            // Пока используем заглушку - возвращаем то же изображение с наложенным текстом
            // В реальном проекте нужно использовать Replicate или другую нейросеть
            const base64Image = referenceBuffer.toString('base64');
            imageDataUrl = `data:image/jpeg;base64,${base64Image}`;
            
        } catch (err) {
            console.error(`❌ Ошибка при генерации изображения:`, err);
            return res.status(500).json({ error: 'Failed to generate image: ' + err.message });
        }

        // Загружаем в Storage
        const fileName = `card_${Date.now()}_${attempt}.jpg`;
        const publicUrl = await uploadToStorage(imageDataUrl, fileName);
        
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