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
            return res.status(500).json({ error: 'Google API key not configured' });
        }

        // Определяем требования к описанию в зависимости от платформы
        const platformRules = platform === 'wb' 
            ? `Wildberries: описание должно быть структурированным, с эмодзи, выделением преимуществ, SEO-оптимизированным. Максимум 3000 символов. Обязательно указать: состав, размер, материал, страну производства.`
            : `Ozon: описание должно быть подробным, с характеристиками в начале, SEO-оптимизированным, без излишних эмодзи. Максимум 5000 символов. Обязательно указать: бренд, модель, технические характеристики.`;

        // ========== НОВЫЙ УЛУЧШЕННЫЙ ПРОМПТ ==========
        const prompt = `Ты — профессиональный копирайтер-аналитик для маркетплейсов Wildberries и Ozon. 
Твоя задача — создать максимально подробное, продающее и реалистичное описание для товара: "${productName}".

### **ПЛАТФОРМА:** ${platformRules}

### **ИНСТРУКЦИЯ ПО СОЗДАНИЮ:**

1.  **ГЛУБОКИЙ АНАЛИЗ ТОВАРА (ОБЯЗАТЕЛЬНО):**
    *   На основе названия "${productName}", **используй свои внутренние знания**, чтобы найти и включить в описание **конкретные технические характеристики**.
    *   Для электроники это: модель процессора, объём памяти, размер и тип экрана, ёмкость аккумулятора, версия Bluetooth/Wi-Fi, материалы корпуса, степень влагозащиты (IP), датчики, комплектация.
    *   Пример для Apple Watch: укажи про процессор S11, дисплей с постоянно включённым экраном, защиту от воды 50 м, датчики ЭКГ и кислорода в крови, материалы корпуса и тип ремешка.
    *   Не пиши "высококачественные материалы" — пиши **конкретно**: "алюминий авиационного класса", "сапфировое стекло", "фторэластомерный ремешок".

2.  **СТРУКТУРА ОПИСАНИЯ (строго соблюдай):**

    *   **ЗАГОЛОВОК:** Яркий, с эмодзи, отражающий главную фишку.
    
    *   **ВВЕДЕНИЕ (1-2 предложения):** Кратко о главном — кому подойдёт и почему это лучший выбор.
    
    *   **КЛЮЧЕВЫЕ ПРЕИМУЩЕСТВА (блок с иконками):**
        *   🚀 **Производительность:** [подробно о чипе и скорости]
        *   📱 **Экран:** [технология, яркость, always-on]
        *   ⌚ **Дизайн и материалы:** [конкретные материалы, цвет, вес]
        *   💧 **Защита:** [степень защиты, для каких условий]
        *   🔋 **Автономность:** [время работы, скорость зарядки]
        *   📊 **Функции здоровья:** [ЭКГ, пульс, кислород, сон, тренировки]
    
    *   **ПОЛНЫЕ ХАРАКТЕРИСТИКИ (в виде списка или таблицы):**
        *   Бренд: [Точное название бренда]
        *   Модель: [Точная модель]
        *   Размер: [например, 41мм или 45мм]
        *   Материал корпуса: [напр., алюминий/нержавеющая сталь/титан]
        *   Материал ремешка: [напр., фторэластомер/кожа/нейлон]
        *   Цвет: [точный цвет]
        *   Тип экрана: [напр., Always-On Retina LTPO]
        *   Диагональ экрана: [в дюймах/мм]
        *   Процессор: [точная модель]
        *   Ёмкость аккумулятора: [в мАч или время работы]
        *   Защита от воды: [IP68 / 5ATM / WR50]
        *   Датчики: [полный список: пульс, ЭКГ, кислород, GPS, компас, и т.д.]
        *   Совместимость: [с какими iPhone]
        *   Комплектация: [что в коробке: часы, ремешок, зарядка, док.]
        *   Страна производства: [реальная страна]
        *   Гарантия: [срок]

    *   **КОМПЛЕКТАЦИЯ:** Подробно опиши, что пользователь найдёт в коробке.
    
    *   **ПРИЗЫВ К ДЕЙСТВИЮ:** Убедительная фраза с эмодзи.

3.  **ЗАПРЕЩЕНО:**
    *   Использовать общие фразы вроде "высокое качество", "современный дизайн" без конкретики.
    *   Писать слишком короткие описания. **Минимальный объём: 3000 знаков.**
    *   Придумывать нереальные условия доставки и акции, если они не были запрошены.
    *   Копировать текст конкурентов.

4.  **УНИКАЛЬНОСТЬ И ЯЗЫК:**
    *   Текст должен быть уникальным (100%) и адаптированным для поиска на Wildberries/Ozon.
    *   Используй ключевые слова органично, не переспамливая.
    ${keywords.length > 0 ? `Обязательно включи эти ключевые слова: ${keywords.join(', ')}.` : ''}
    *   Язык: русский, грамотный, без ошибок.`;

        // Инициализируем Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Выбираем модель
        const modelMap = {
            'flash': 'gemini-3.1-flash',
            'flash-lite': 'gemini-3.1-flash-lite-preview',
            'pro': 'gemini-3.1-pro-preview'
        };
        
        const selectedModel = modelMap[model] || modelMap.flash;
        console.log(`Using model: ${selectedModel}`);
        console.log('Prompt length:', prompt.length);

        // Генерируем описание через Gemini
        const geminiModel = genAI.getGenerativeModel({ 
            model: selectedModel,
            generationConfig: {
                temperature: 0.9,        // Чуть выше для креативности
                maxOutputTokens: 8192,    // Максимально длинный ответ
                topP: 0.95,
                topK: 40
            }
        });

        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        let description = response.text();

        // Проверяем, что описание достаточно длинное
        if (!description || description.length < 500) {
            console.log('Description too short, regenerating with higher temperature...');
            
            // Пробуем ещё раз с более высокой температурой
            const retryModel = genAI.getGenerativeModel({ 
                model: selectedModel,
                generationConfig: {
                    temperature: 1.0,
                    maxOutputTokens: 8192,
                    topP: 0.95,
                    topK: 40
                }
            });
            
            const retryResult = await retryModel.generateContent(prompt + "\n\nОЧЕНЬ ВАЖНО: Сделай описание максимально подробным и длинным, минимум 3000 символов!");
            const retryResponse = await retryResult.response;
            description = retryResponse.text();
        }

        console.log(`✅ Description generated, length: ${description.length} chars`);

        res.status(200).json({ 
            description,
            platform,
            model: selectedModel,
            length: description.length
        });

    } catch (error) {
        console.error('❌ Fatal error:', error);
        
        // Возвращаем информативную ошибку
        res.status(500).json({ 
            error: 'Ошибка генерации описания',
            details: error.message,
            fallback: generateFallbackDescription(req.body.productName, req.body.platform, req.body.keywords)
        });
    }
}

// Запасная функция с демо-данными (только если совсем всё сломалось)
function generateFallbackDescription(productName, platform, keywords) {
    const platformName = platform === 'wb' ? 'Wildberries' : 'Ozon';
    
    return `✨ **${productName}** — премиальное качество для ${platformName}!

📋 **ПОДРОБНЫЕ ХАРАКТЕРИСТИКИ:**
• Модель: ${productName}
• Бренд: ${productName.split(' ')[0] || 'Premium'}
• Страна производства: Китай
• Гарантия: 12 месяцев

📦 **КОМПЛЕКТАЦИЯ:**
- Товар в фирменной упаковке
- Документация
- Гарантийный талон

❗️ **ВНИМАНИЕ:** Это демо-режим. Полноценное описание не сгенерировалось. Пожалуйста, попробуйте ещё раз или обратитесь в поддержку.`;
}