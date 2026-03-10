import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';

// Инициализация Firebase Admin
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
    console.log('Firebase Admin initialized successfully (generate-video)');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    throw new Error(`Firebase init failed: ${error.message}`);
  }
}
const bucket = admin.storage().bucket();

export const config = {
    api: {
        bodyParser: false,
        maxDuration: 60,
    },
};

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

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
                const base64Data = part.inlineData.data;
                const buffer = Buffer.from(base64Data, 'base64');
                return buffer;
            }
        }
        throw new Error('Ответ не содержит изображения');
    } catch (error) {
        console.error('Gemini generation error:', error);
        throw error;
    }
}

async function uploadToStorage(buffer, fileName, mimeType = 'image/jpeg') {
    const file = bucket.file(`videos/${fileName}`);
    await file.save(buffer, {
        metadata: { contentType: mimeType },
        public: true,
    });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/videos/${fileName}`;
    console.log(`✅ Uploaded to Storage: ${publicUrl}`);
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

        const productName = fields.productName?.[0] || 'товар';
        const videoType = fields.videoType?.[0] || 'standard';
        const customPrompt = fields.customPrompt?.[0] || '';

        let referenceBuffer = null;
        if (files.videoPhoto) {
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            if (photoArray.length) {
                referenceBuffer = fs.readFileSync(photoArray[0].filepath);
                console.log(`📸 Loaded reference image: ${photoArray[0].originalFilename}`);
            }
        }
        if (!referenceBuffer) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        // Генерируем 3 кадра с разных ракурсов
        const prompts = [
            `Профессиональное фото товара "${productName}" с угла 0 градусов. Студийное освещение, белый фон, высокое качество.`,
            `Профессиональное фото товара "${productName}" с угла 120 градусов. Студийное освещение, белый фон, высокое качество.`,
            `Профессиональное фото товара "${productName}" с угла 240 градусов. Студийное освещение, белый фон, высокое качество.`
        ];

        const imageUrls = [];
        
        for (let i = 0; i < prompts.length; i++) {
            console.log(`Генерация кадра ${i+1}/${prompts.length}...`);
            try {
                const imageBuffer = await generateGeminiImage(prompts[i], referenceBuffer);
                const fileName = `frame_${Date.now()}_${i}.jpg`;
                const url = await uploadToStorage(imageBuffer, fileName, 'image/jpeg');
                imageUrls.push(url);
            } catch (err) {
                console.error(`Ошибка генерации кадра ${i+1}:`, err);
            }
        }

        if (imageUrls.length === 0) {
            throw new Error('Не удалось сгенерировать ни одного кадра');
        }

        // Удаляем временные файлы
        if (files.videoPhoto) {
            const photoArray = Array.isArray(files.videoPhoto) ? files.videoPhoto : [files.videoPhoto];
            photoArray.forEach(file => {
                if (file.filepath && fs.existsSync(file.filepath)) {
                    fs.unlinkSync(file.filepath);
                }
            });
        }

        console.log('✅ Кадры сгенерированы и загружены');
        res.status(200).json({ frames: imageUrls });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
}