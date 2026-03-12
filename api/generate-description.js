import { GoogleGenerativeAI } from '@google/generative-ai';
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
        const { productName, platform, competitors = [], keywords = [], model = 'flash', userId } = req.body;

        if (!productName) {
            return res.status(400).json({ error: 'Product name is required' });
        }

        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            console.error('GOOGLE_API_KEY not set');
            return res.status(500).json({ error: 'Google API key not configured' });
        }

        // Проверяем баланс пользователя
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('balance, used_spent')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.balance < 50) {
            return res.status(400).json({ error: 'Insufficient balance. Required: 50 ₽' });
        }

        // Определяем требования к описанию в зависимости от платформы
        const platformRules = platform === 'wb' 
            ? `Wildberries: описание должно быть структурированным, с эмодзи, выделением преимуществ, SEO-оптимизированным. Максимум 3000 символов. Обязательно указать: состав, размер, материал, страну производства.`
            : `Ozon: описание должно быть подробным, с характеристиками в начале, SEO-оптимизированным, без излишних эмодзи. Максимум 5000 символов. Обязательно указать: бренд, модель, технические характеристики.`;

        // ========== УЛУЧШЕННЫЙ ПРОМПТ ==========
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

        // Инициализируем Gemini с правильными названиями моделей
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Карта правильных названий моделей
        const modelMap = {
            'flash': 'gemini-2.5-flash',
            'flash-lite': 'gemini-2.5-flash-lite',
            'pro': 'gemini-2.5-pro'
        };
        
        const selectedModel = modelMap[model] || modelMap.flash;
        console.log(`Using model: ${selectedModel}`);
        console.log('Prompt length:', prompt.length);

        // Генерируем описание через Gemini
        const geminiModel = genAI.getGenerativeModel({ 
            model: selectedModel,
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 8192,
                topP: 0.95,
                topK: 40
            }
        });

        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        let description = response.text();

        // Проверяем, что описание достаточно длинное
        if (!description || description.length < 1000) {
            console.log('Description too short, regenerating with higher temperature...');
            
            const retryModel = genAI.getGenerativeModel({ 
                model: selectedModel,
                generationConfig: {
                    temperature: 1.0,
                    maxOutputTokens: 8192,
                    topP: 0.95,
                    topK: 40
                }
            });
            
            const retryResult = await retryModel.generateContent(prompt + "\n\nОЧЕНЬ ВАЖНО: Сделай описание максимально подробным и длинным, минимум 3000 символов! Укажи ВСЕ технические характеристики!");
            const retryResponse = await retryResult.response;
            description = retryResponse.text();
        }

        // Сохраняем описание в БД
        const { data: savedDesc, error: insertError } = await supabase
            .from('descriptions')
            .insert({
                user_id: userId,
                product_name: productName,
                platform: platform,
                description: description,
                keywords: keywords,
                cost: 50,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (insertError) {
            console.error('❌ Error saving description:', insertError);
            // Не возвращаем ошибку, просто логируем
        }

        // Списываем деньги
        await supabase
            .from('users')
            .update({ 
                balance: user.balance - 50,
                used_spent: (user.used_spent || 0) + 50
            })
            .eq('id', userId);

        console.log(`✅ Description generated, length: ${description.length} chars`);

        res.status(200).json({ 
            description,
            platform,
            model: selectedModel,
            length: description.length,
            saved: !insertError
        });

    } catch (error) {
        console.error('❌ Fatal error:', error);
        
        res.status(500).json({ 
            error: 'Ошибка генерации описания',
            details: error.message
        });
    }
}