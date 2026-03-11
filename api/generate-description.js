export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { productName, platform, competitors = [], keywords = [] } = req.body;

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            console.error('DEEPSEEK_API_KEY not set');
            return res.status(500).json({ error: 'API key not configured' });
        }

        // Определяем требования к описанию в зависимости от платформы [citation:1]
        const platformRules = platform === 'wb' 
            ? `Wildberries: описание должно быть структурированным, с эмодзи, выделением преимуществ, SEO-оптимизированным. Максимум 3000 символов. Обязательно указать: состав, размер, материал, страну производства.`
            : `Ozon: описание должно быть подробным, с характеристиками в начале, SEO-оптимизированным, без излишних эмодзи. Максимум 5000 символов. Обязательно указать: бренд, модель, технические характеристики.`;

        // Формируем промпт для DeepSeek [citation:2][citation:5]
        const prompt = `Ты — профессиональный копирайтер для маркетплейсов Wildberries и Ozon. 
Создай уникальное, продающее описание для товара: "${productName}".

Платформа: ${platformRules}

${competitors.length > 0 
    ? `Проанализируй стиль и структуру описаний конкурентов, но создай уникальный текст, который будет лучше. Не копируй, а вдохновляйся.` 
    : ''}

${keywords.length > 0 
    ? `Обязательно включи эти ключевые слова в описание: ${keywords.join(', ')}` 
    : ''}

Требования к описанию:
1. Начни с яркого заголовка/подзаголовка с эмодзи
2. Раздели текст на логические блоки с подзаголовками
3. Используй маркированные списки для преимуществ
4. Добавь эмоциональные триггеры и пользу для покупателя
5. Укажи все важные характеристики (материалы, размеры, комплектацию)
6. Добавь раздел "Характеристики" с таблицей
7. Закончи призывом к действию
8. Объём: 2500-3500 знаков
9. Уникальность: 100%, без копирования конкурентов
10. Язык: русский, грамотный, без ошибок

Описание должно быть готово к публикации на маркетплейсе.`;

        console.log('Sending request to DeepSeek API...');

        // Вызов DeepSeek API (OpenAI-совместимый формат) [citation:1][citation:5]
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat', // или 'deepseek-reasoner' для более глубокого анализа [citation:1]
                messages: [
                    {
                        role: 'system',
                        content: 'Ты профессиональный копирайтер для маркетплейсов. Создавай уникальные, продающие описания товаров.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.8, // Баланс между креативностью и точностью [citation:2]
                max_tokens: 4000,
                top_p: 0.9,
                frequency_penalty: 0.3, // Чтобы избежать повторений
                presence_penalty: 0.3
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('DeepSeek API error:', response.status, errorData);
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        const description = data.choices[0].message.content;

        console.log('✅ Description generated successfully');

        res.status(200).json({ 
            description,
            platform,
            length: description.length
        });

    } catch (error) {
        console.error('Description generation error:', error);
        res.status(500).json({ error: error.message });
    }
}