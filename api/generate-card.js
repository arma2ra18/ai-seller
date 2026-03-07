// api/generate-card.js
import { IncomingForm } from 'formidable';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import { createCanvas } from 'canvas';

export const config = {
    api: {
        bodyParser: false,
    },
};

const genAI = new GoogleGenerativeAI(process.env.AIzaSyDhj-2aSlKbuRuODQR9qBbBl38kP0xwXzU);

/**
 * Улучшение фото через Gemini (замена фона, освещение)
 */
async function enhanceProductImage(productBuffer, style) {
    const base64Image = productBuffer.toString('base64');
    
    const prompt = `You are a professional e-commerce photo editor. 
Take this product photo and:
1. Remove the background and replace it with a clean, ${style} style background (white, minimal, premium, etc.)
2. Add a soft, realistic shadow under the product
3. Enhance the lighting to make it look like studio photography
4. Keep the product exactly as is – do not change its shape, colors, or details
5. The final image should be 1024x1024 with the product centered

Return ONLY the edited image.`;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image-preview" });
        const result = await model.generateContent({
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: "image/jpeg", data: base64Image } }
                    ]
                }
            ],
            generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
        });

        const response = await result.response;
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

/**
 * Наложение текста на изображение с помощью canvas
 */
async function addTextToImage(imageBuffer, texts, variant) {
    const { productName, brand, features } = texts;
    const width = 1024;
    const height = 1024;

    const image = await sharp(imageBuffer)
        .resize(width, height, { fit: 'contain', background: '#ffffff' })
        .toBuffer();

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const img = await loadImage(image);
    ctx.drawImage(img, 0, 0, width, height);

    ctx.fillStyle = '#000000';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Разные варианты расположения текста
    switch (variant) {
        case 0:
            ctx.font = 'bold 48px "Inter"';
            ctx.fillText(productName, 50, 100);
            ctx.font = '36px "Inter"';
            if (brand) ctx.fillText(brand, 50, 170);
            ctx.font = '30px "Inter"';
            ctx.fillText(features.join(' · '), 50, height - 50);
            break;
        case 1:
            ctx.textAlign = 'center';
            ctx.font = 'bold 56px "Inter"';
            ctx.fillText(productName, width / 2, height - 150);
            ctx.textAlign = 'right';
            ctx.font = '32px "Inter"';
            features.forEach((f, idx) => {
                ctx.fillText(f, width - 50, 150 + idx * 50);
            });
            break;
        case 2:
            ctx.textAlign = 'left';
            ctx.font = 'bold 64px "Inter"';
            ctx.fillText(productName, 50, 120);
            ctx.font = '40px "Inter"';
            if (brand) ctx.fillText(brand, 50, 200);
            ctx.font = '28px "Inter"';
            const half = Math.ceil(features.length / 2);
            features.slice(0, half).forEach((f, idx) => {
                ctx.fillText(`✓ ${f}`, 50, 300 + idx * 45);
            });
            features.slice(half).forEach((f, idx) => {
                ctx.fillText(`✓ ${f}`, 500, 300 + idx * 45);
            });
            break;
        case 3:
            ctx.save();
            ctx.translate(900, 500);
            ctx.rotate(-Math.PI / 2);
            ctx.font = 'bold 48px "Inter"';
            ctx.fillText(productName, 0, 0);
            if (brand) {
                ctx.font = '32px "Inter"';
                ctx.fillText(brand, 0, 60);
            }
            ctx.restore();
            break;
        case 4:
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, height - 200, width, 200);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = 'bold 48px "Inter"';
            ctx.fillText(productName, width / 2, height - 120);
            ctx.font = '32px "Inter"';
            ctx.fillText(features.join(' · '), width / 2, height - 60);
            break;
    }

    return canvas.toBuffer('image/jpeg');
}

function loadImage(buffer) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    });
}

async function generateDescriptions(productName, brand, features) {
    return [
        `✨ ${productName} от ${brand} — ${features.join(', ')}`,
        `🔥 ${brand} ${productName} — высокое качество и надёжность`,
        `💎 Купите ${productName} по лучшей цене! ${features.join(', ')}`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

    try {
        const form = new IncomingForm({ keepExtensions: true, multiples: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        const productName = fields.productName?.[0] || fields.productName || '';
        const brand = fields.brand?.[0] || fields.brand || '';
        const featuresStr = fields.features?.[0] || fields.features || '';
        const features = featuresStr.split(',').map(f => f.trim()).filter(Boolean);
        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];

        if (!productName || photos.length === 0) {
            return res.status(400).json({ error: 'Product name and photo required' });
        }

        const firstPhoto = photos[0];
        const productBuffer = fs.readFileSync(firstPhoto.filepath);

        const styles = ['white minimal', 'soft studio', 'premium dark', 'bright clean', 'warm natural'];
        const images = [];

        for (let i = 0; i < styles.length; i++) {
            console.log(`🎨 Улучшение фото в стиле ${styles[i]}`);
            const enhancedBuffer = await enhanceProductImage(productBuffer, styles[i]);
            const cardBuffer = await addTextToImage(enhancedBuffer, { productName, brand, features }, i);
            const optimized = await sharp(cardBuffer).jpeg({ quality: 90 }).toBuffer();
            images.push(`data:image/jpeg;base64,${optimized.toString('base64')}`);
            await new Promise(r => setTimeout(r, 2000));
        }

        const descriptions = await generateDescriptions(productName, brand, features);

        fs.unlinkSync(firstPhoto.filepath);
        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
}