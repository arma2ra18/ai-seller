// api/generate-card.js
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Инициализация Gemini
const genAI = new GoogleGenerativeAI(process.env.AIzaSyDhj-2aSlKbuRuODQR9qBbBl38kP0xwXzU);

/**
 * Генерация карточки товара через Gemini
 */
async function generateProductCard(productBuffer, texts, style) {
    const { productName, brand, features } = texts;
    
    // Конвертируем изображение в base64
    const base64Image = productBuffer.toString('base64');
    
    // Промпт для Gemini (на английском для лучшего качества)
    const prompt = `You are a professional e-commerce product photographer and designer.
    
Task: Create a high-quality product card image for an online marketplace.

Product details:
- Name: ${productName}
- Brand: ${brand || 'Generic'}
- Features: ${features.join(', ')}
- Style: ${style} (modern, minimal, premium, bold, or eco)

Requirements:
1. Place the product on a clean, professional background (${style} style)
2. Add soft, realistic shadows under the product
3. Enhance lighting to look like studio photography
4. Preserve ALL product details, colors, and text exactly as in the original
5. Add these text elements (make them crisp and readable):
   - Product name at the top (bold, large font)
   - Key features as small icons or bullet points
   - Brand logo/name subtly placed
6. Ensure the final image looks like it was professionally designed
7. Maintain 1024x1024 resolution
8. Do NOT alter the product shape or details

Return ONLY the edited image.`;

    try {
        // Вызов Gemini API
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash-image-preview", // или "gemini-3-pro-image-preview" для 4K
        });

        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: "image/jpeg",
                                data: base64Image
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 4096,
            }
        });

        const response = await result.response;
        
        // Извлекаем изображение из ответа
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return Buffer.from(part.inlineData.data, 'base64');
            }
        }
        
        throw new Error('No image in response');
        
    } catch (error) {
        console.error('Gemini error:', error);
        throw error;
    }
}

// Генерация описаний (оставляем как есть)
async function generateDescriptions(productName, brand, features, platform) {
    return [
        `✨ ${productName} от ${brand} — ${features.join(', ')}. Идеально для повседневного использования!`,
        `🔥 ${brand} ${productName} — высокое качество и надёжность. ${features.join(', ')}.`,
        `💎 Купите ${productName} по лучшей цене! ${features.join(', ')}. Только оригинал.`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY not set' });
    }

    try {
        // Парсинг формы
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const category = fields.category?.[0] || fields.category || '';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        
        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];
        if (photos.length === 0 || !productName) {
            return res.status(400).json({ error: 'Product name and photo required' });
        }

        const firstPhoto = photos[0];
        const productBuffer = fs.readFileSync(firstPhoto.filepath);

        // Стили для генерации
        const styles = ['modern', 'minimal', 'premium', 'bold', 'eco'];
        
        // Генерируем 5 вариантов карточек
        const images = [];
        for (let i = 0; i < styles.length; i++) {
            console.log(`🎨 Генерация стиля ${styles[i]}`);
            try {
                const cardBuffer = await generateProductCard(
                    productBuffer, 
                    { productName, brand, features }, 
                    styles[i]
                );
                
                // Оптимизация размера через sharp
                const optimized = await sharp(cardBuffer)
                    .resize(1024, 1024, { fit: 'contain', background: '#ffffff' })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                
                images.push(`data:image/jpeg;base64,${optimized.toString('base64')}`);
                
                // Небольшая задержка между запросами
                await new Promise(r => setTimeout(r, 2000));
                
            } catch (err) {
                console.error(`Ошибка для стиля ${styles[i]}:`, err);
                // Добавляем заглушку при ошибке
                images.push(null);
            }
        }

        // Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, fields.platform || 'wb');

        // Удаляем временный файл
        fs.unlinkSync(firstPhoto.filepath);

        res.status(200).json({ 
            images: images.filter(img => img !== null), // Убираем неудачные
            descriptions 
        });

    } catch (error) {
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}