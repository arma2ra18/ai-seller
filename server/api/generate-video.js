export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { productImage, videoType, duration, aspectRatio, customPrompt } = req.body;

        // Здесь будет интеграция с Replicate/Veo
        // Пока возвращаем тестовое видео
        
        return res.status(200).json({
            success: true,
            videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
            type: videoType,
            duration: duration
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}