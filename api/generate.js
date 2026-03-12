export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { category, productName, features, audience, keywords } = req.body;

        // Здесь будет интеграция с GigaChat
        // Пока возвращаем тестовые данные
        
        const result = {
            names: [
                `${productName} — лучший выбор в ${category}`,
                `Купить ${productName} с доставкой по РФ`,
                `${productName} — отзывы и цены`,
                `Оригинальный ${productName} с гарантией`,
                `${productName} для ${audience || 'всей семьи'}`
            ],
            description: `**${productName}** — идеальное решение для ${audience || 'всех'}.\n\n` +
                `✅ Преимущества:\n` +
                `• ${features[0] || 'Высокое качество'}\n` +
                `• ${features[1] || 'Надежность'}\n` +
                `• ${features[2] || 'Современный дизайн'}\n\n` +
                `💰 Лучшая цена на рынке!\n\n` +
                `🚚 Быстрая доставка по всей России.\n\n` +
                `✨ Заказывайте сейчас и получите скидку!`,
            specs: {
                'Бренд': 'Не указан',
                'Модель': 'Стандартная',
                'Цвет': 'В ассортименте',
                'Материал': 'Высококачественный',
                'Страна производства': 'Россия',
                'Гарантия': '12 месяцев'
            }
        };

        return res.status(200).json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}