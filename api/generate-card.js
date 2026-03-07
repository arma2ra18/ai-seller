// api/generate-card.js
import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { createCanvas, registerFont } from 'canvas';
import backgroundRemover from '@imgly/background-removal-node';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Вспомогательная функция для удаления фона
async function removeBackground(imageBuffer) {
    try {
        // backgroundRemover ожидает Blob, создаём его из буфера
        const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
        const resultBlob = await backgroundRemover.removeBackground(blob);
        const arrayBuffer = await resultBlob.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        console.error('Ошибка удаления фона:', error);
        // В случае ошибки возвращаем исходное изображение (можно будет добавить заглушку)
        return imageBuffer;
    }
}

// Генерация одного варианта карточки
async function generateCardImage(productBuffer, texts, variant) {
    // Задаём размеры холста
    const width = 1024;
    const height = 1024;

    // Создаём холст
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Белый фон
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Вставляем товар (масштабируем, центрируем)
    // Используем sharp для изменения размера изображения товара
    const resizedProduct = await sharp(productBuffer)
        .resize(800, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .toBuffer();

    // Загружаем изображение в canvas
    const productImage = await loadImage(resizedProduct);
    const productWidth = productImage.width;
    const productHeight = productImage.height;
    const x = (width - productWidth) / 2;
    const y = 100; // отступ сверху
    ctx.drawImage(productImage, x, y, productWidth, productHeight);

    // 3. Настройки текста
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 40px "Inter"';
    ctx.textAlign = 'left';

    // 4. Добавляем текстовые блоки в зависимости от варианта
    // Варианты: разные расположения (слева, справа, снизу и т.д.)
    const { productName, brand, features } = texts;

    // Базовые тексты
    const title = productName;
    const brandText = brand ? `Бренд: ${brand}` : '';
    const featuresText = features.join(' · ');

    switch (variant) {
        case 0: // Вариант 1: текст слева
            ctx.font = 'bold 50px "Inter"';
            ctx.fillText(title, 50, 850);
            ctx.font = '40px "Inter"';
            if (brandText) ctx.fillText(brandText, 50, 910);
            ctx.font = '30px "Inter"';
            ctx.fillText(featuresText, 50, 970);
            break;
        case 1: // Вариант 2: текст снизу, по центру
            ctx.textAlign = 'center';
            ctx.font = 'bold 50px "Inter"';
            ctx.fillText(title, width / 2, 900);
            ctx.font = '40px "Inter"';
            if (brandText) ctx.fillText(brandText, width / 2, 960);
            ctx.font = '30px "Inter"';
            ctx.fillText(featuresText, width / 2, 1010);
            break;
        case 2: // Вариант 3: текст справа
            ctx.textAlign = 'right';
            ctx.font = 'bold 50px "Inter"';
            ctx.fillText(title, width - 50, 850);
            ctx.font = '40px "Inter"';
            if (brandText) ctx.fillText(brandText, width - 50, 910);
            ctx.font = '30px "Inter"';
            ctx.fillText(featuresText, width - 50, 970);
            break;
        case 3: // Вариант 4: две колонки
            ctx.textAlign = 'left';
            ctx.font = 'bold 50px "Inter"';
            ctx.fillText(title, 50, 750);
            ctx.font = '40px "Inter"';
            if (brandText) ctx.fillText(brandText, 50, 820);
            ctx.font = '30px "Inter"';
            // Разбиваем особенности на две колонки
            const half = Math.ceil(features.length / 2);
            const col1 = features.slice(0, half).join(' · ');
            const col2 = features.slice(half).join(' · ');
            ctx.fillText(col1, 50, 890);
            ctx.fillText(col2, 500, 890);
            break;
        case 4: // Вариант 5: текст вертикально справа
            ctx.save();
            ctx.translate(900, 500);
            ctx.rotate(-Math.PI / 2);
            ctx.font = 'bold 40px "Inter"';
            ctx.fillText(title, 0, 0);
            ctx.restore();
            break;
    }

    // Возвращаем буфер изображения
    return canvas.toBuffer('image/jpeg');
}

// Вспомогательная функция для загрузки изображения в canvas
function loadImage(buffer) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    });
}

// Генерация описаний (оставляем как есть)
async function generateDescriptions(productName, brand, features, platform) {
    return [
        `Превосходный ${productName} от бренда ${brand}. Особенности: ${features.join(', ')}. Идеально подходит для повседневного использования. Закажите сейчас!`,
        `${brand} ${productName} – высокое качество и надёжность. ${features.join(', ')}. Быстрая доставка по всей России.`,
        `Купите ${productName} по лучшей цене! ${features.join(', ')}. Только оригинальная продукция.`
    ];
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Парсим multipart/form-data
        const form = new IncomingForm({
            keepExtensions: true,
            multiples: true,
        });

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
        const platform = fields.platform?.[0] || fields.platform || 'wb';

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        // Берём первое загруженное фото (или все, но для примера одно)
        const photos = files.photos ? (Array.isArray(files.photos) ? files.photos : [files.photos]) : [];
        if (photos.length === 0) {
            return res.status(400).json({ error: 'At least one photo is required' });
        }

        const firstPhoto = photos[0];
        const productBuffer = fs.readFileSync(firstPhoto.filepath);

        // Удаляем фон
        console.log('🔄 Удаление фона...');
        const productWithoutBg = await removeBackground(productBuffer);
        console.log('✅ Фон удалён');

        // Генерируем 5 вариантов карточек
        const images = [];
        for (let i = 0; i < 5; i++) {
            console.log(`🎨 Генерация варианта ${i+1}`);
            const cardBuffer = await generateCardImage(productWithoutBg, { productName, brand, features }, i);
            const base64 = cardBuffer.toString('base64');
            images.push(`data:image/jpeg;base64,${base64}`);
        }

        // Генерируем описания
        const descriptions = await generateDescriptions(productName, brand, features, platform);

        // Удаляем временный файл
        fs.unlinkSync(firstPhoto.filepath);

        res.status(200).json({ images, descriptions });

    } catch (error) {
        console.error('❌ Generate card error:', error);
        res.status(500).json({ error: error.message });
    }
}