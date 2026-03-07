export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { productImage, prompt, model } = req.body;

        // Здесь будет интеграция с Replicate/FLUX
        // Пока возвращаем тестовое изображение
        
        return res.status(200).json({
            success: true,
            imageUrl: 'https://placehold.co/1024x1024/6c5ce7/white?text=AI+Generated+Product+Photo',
            model: model || 'flux-2-pro'
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}