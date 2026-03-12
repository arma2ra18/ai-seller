import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { productImage, prompt, model, userId } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        // Здесь будет интеграция с Replicate/FLUX
        // Пока возвращаем тестовое изображение
        
        const imageUrl = 'https://placehold.co/1024x1024/6c5ce7/white?text=AI+Generated+Product+Photo';

        // Сохраняем в историю (опционально)
        await supabase
            .from('generation_sessions')
            .insert({
                user_id: userId,
                product_name: 'Generated Image',
                attempts: 1,
                total_spent: 0,
                images: [imageUrl],
                created_at: new Date().toISOString()
            });

        return res.status(200).json({
            success: true,
            imageUrl: imageUrl,
            model: model || 'flux-2-pro'
        });
    } catch (error) {
        console.error('❌ Error:', error);
        return res.status(500).json({ error: error.message });
    }
}