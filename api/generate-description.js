import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { productName, platform, competitors = [], keywords = [], model = 'flash' } = req.body;

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            console.error('GOOGLE_API_KEY not set');
            return res.status(500).json({ error: 'API key not configured' });
        }

        // Выбор модели на основе параметра
        const modelMap = {
            'flash': 'gemini-3.1-flash',           // Быстрая, бюджетная
            'flash-lite': 'gemini-3.1-flash-lite-preview', // Самая быстрая и дешёвая
            'pro': 'gemini-3.1-pro-preview'        // Самая мощная
        };

        const selectedModel = modelMap[model] || modelMap.flash;
        console.log(`Using model: ${selectedModel}`);

        // Определяем требования к описанию в зависимости от платформы
        const platformRules = platform === 'wb' 
            ? `Wildberries: описание должно быть структурированным, с эмодзи, выделением преимуществ, SEO-оптимизированным. Максимум 3000 символов. Обязательно указать: состав, размер, материал, страну производства.`
            : `Ozon: описание должно быть подробным, с характеристиками в начале, SEO-оптимизированным, без излишних эмодзи. Максимум 5000 символов. Обязательно указать: бренд, модель, технические характеристики.`;

        // Формируем промпт
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

        // Инициализируем Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Пробуем с выбранной моделью
        let finalDescription;
        let attempts = 0;
        const maxAttempts = 2;
        const modelsToTry = [selectedModel, 'gemini-3.1-flash', 'gemini-3.1-flash-lite-preview'];

        while (attempts < maxAttempts && !finalDescription) {
            const currentModel = modelsToTry[attempts];
            try {
                console.log(`Attempt ${attempts + 1} with model: ${currentModel}`);
                
                const model = genAI.getGenerativeModel({ 
                    model: currentModel,
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 4000,
                        topP: 0.9,
                        topK: 40
                    }
                });

                const result = await model.generateContent(prompt);
                const response = await result.response;
                finalDescription = response.text();

                if (finalDescription && finalDescription.length > 100) {
                    console.log(`✅ Success with ${currentModel}`);
                    break;
                }
            } catch (modelError) {
                console.error(`❌ Error with ${currentModel}:`, modelError.message);
                attempts++;
            }
        }

        // Если все модели не сработали, возвращаем демо-описание
        if (!finalDescription) {
            console.log('⚠️ All models failed, using fallback');
            finalDescription = generateFallbackDescription(productName, platform, keywords);
        }

        res.status(200).json({ 
            description: finalDescription,
            platform,
            model: modelsToTry[attempts] || 'fallback',
            length: finalDescription.length
        });

    } catch (error) {
        console.error('❌ Fatal error:', error);
        res.status(500).json({ error: error.message });
    }
}

// Запасная функция с демо-данными (на всякий случай)
function generateFallbackDescription(productName, platform, keywords) {
    const platformName = platform === 'wb' ? 'Wildberries' : 'Ozon';
    const keywordText = keywords.length > 0 
        ? `\n\n🔑 **Ключевые слова:** ${keywords.join(', ')}` 
        : '';

    return `✨ **${productName}** — ваш идеальный выбор для ${platformName}!

📦 **ПРЕИМУЩЕСТВА:**
• Превосходное качество и надёжность
• Современный дизайн и эргономика
• Доступная цена и выгодные условия

📋 **ХАРАКТЕРИСТИКИ:**
- Бренд: ${productName.split(' ')[0] || 'Premium'}
- Материал: Высококачественные материалы
- Страна производства: Китай/Россия
- Гарантия: 12 месяцев

🚚 **ДОСТАВКА ПО ВСЕЙ РОССИИ**
Отправляем в день заказа. Бесплатная доставка при заказе от 3000 ₽.

${keywordText}

✅ **ОФОРМЛЯЙТЕ ПРЯМО СЕЙЧАС!**`;
}