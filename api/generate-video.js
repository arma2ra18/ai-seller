import { IncomingForm } from 'formidable';
import fs from 'fs';
import * as fal from "@fal-ai/serverless-client";

export const config = {
    api: {
        bodyParser: false,
    },
};

// Инициализация fal.ai клиента
fal.config({
    credentials: process.env.FAL_KEY
});

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const falKey = process.env.FAL_KEY;
    if (!falKey) {
        return res.status(500).json({ error: 'FAL_KEY not set in environment variables' });
    }

    try {
        // Парсим multipart/form-data
        const form = new IncomingForm({ keepExtensions: true });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });

        // Извлекаем поля
        const videoType = fields.videoType?.[0] || fields.videoType || 'standard';
        const prompt = fields.prompt?.[0] || fields.prompt || '';
        const resolution = fields.resolution?.[0] || fields.resolution || '512P';

        // Получаем загруженное фото
        const photoFile = files.videoPhoto;
        if (!photoFile) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }

        const photoPath = photoFile.filepath;

        // Читаем файл и конвертируем в base64
        const fileBuffer = fs.readFileSync(photoPath);
        const base64Image = `data:${photoFile.mimetype};base64,${fileBuffer.toString('base64')}`;

        // Загружаем изображение во временное хранилище (fal.ai требует URL)
        // Для простоты используем data URI напрямую
        const imageUrl = base64Image;

        // Формируем промпт в зависимости от типа видео
        let finalPrompt = prompt;
        if (!finalPrompt) {
            const promptTemplates = {
                'standard': 'The product rotates slowly on a white surface, camera holds steady, soft studio lighting, smooth motion, professional e-commerce video',
                '360': 'The product rotates 360 degrees smoothly, white background, studio lighting, detailed view, professional product showcase',
                'lifestyle': 'The product being used in a realistic setting, natural lighting, cinematic quality, subtle motion',
                'unboxing': 'The product being unboxed, hands opening box, exciting reveal, high quality, smooth animation'
            };
            finalPrompt = promptTemplates[videoType] || promptTemplates.standard;
        }

        // Вызываем fal.ai Kandinsky5 Pro
        const result = await fal.subscribe("fal-ai/kandinsky5-pro/image-to-video", {
            input: {
                image_url: imageUrl,
                prompt: finalPrompt,
                resolution: resolution,
                duration: "5s",
                num_inference_steps: 28,
                acceleration: "regular"
            },
            logs: true,
            onQueueUpdate: (update) => {
                if (update.status === "IN_PROGRESS") {
                    console.log(`Video generation progress: ${update.logs}`);
                }
            },
        });

        // Возвращаем результат
        res.status(200).json({
            success: true,
            videoUrl: result.video.url,
            fileSize: result.video.file_size,
            fileName: result.video.file_name,
            type: videoType,
            duration: 5
        });

        // Удаляем временный файл
        fs.unlinkSync(photoPath);

    } catch (error) {
        console.error('Video generation error:', error);
        res.status(500).json({ error: error.message });
    }
}