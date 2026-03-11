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

    *   **ЗАГОЛОВОК:** Яркий, с эмодзи, отражающий главную фишку. (Пример: ⌚️ **Apple Watch Series 11 — Будущее на вашем запястье**)
    
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
// ==============================================

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