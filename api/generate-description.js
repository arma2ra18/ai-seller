import admin from 'firebase-admin';

// Инициализация Firebase Admin SDK
if (!admin.apps.length) {
  try {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountEnv) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
    }
    const serviceAccount = JSON.parse(serviceAccountEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    throw new Error(`Firebase init failed: ${error.message}`);
  }
}

const db = admin.firestore();

export const config = {
  api: {
    bodyParser: true,
    maxDuration: 60,
  },
};

/**
 * Проверка баланса пользователя
 */
async function checkUserBalance(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return { success: false, error: 'User not found' };
    }
    
    const userData = userDoc.data();
    const balance = parseInt(userData.balance) || 0;
    
    if (balance < 100) {
      return { success: false, error: 'Insufficient balance', balance };
    }
    
    return { success: true, balance, userData };
  } catch (error) {
    console.error('Error checking balance:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Списание средств
 */
async function deductBalance(userId, amount = 100) {
  try {
    await db.collection('users').doc(userId).update({
      balance: admin.firestore.FieldValue.increment(-amount),
      usedSpent: admin.firestore.FieldValue.increment(amount)
    });
    return { success: true };
  } catch (error) {
    console.error('Error deducting balance:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Сохранение описания в историю
 */
async function saveDescription(userId, data) {
  try {
    await db.collection('users').doc(userId).collection('descriptions').add({
      productName: data.productName,
      description: data.description,
      keywords: data.keywords || '',
      competitorLinks: data.competitorLinks || [],
      platform: data.platform || 'wb',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error saving description:', error);
  }
}

/**
 * Генерация текста через прямой вызов Gemini API
 */
async function generateWithGemini(prompt) {
  const API_KEY = process.env.GOOGLE_API_KEY;
  
  if (!API_KEY) {
    throw new Error('GOOGLE_API_KEY is not set');
  }

  // Пробуем разные модели
  const models = [
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro'
  ];

  let lastError;

  for (const model of models) {
    try {
      console.log(`Trying model: ${model}`);
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            topP: 0.95,
            topK: 40
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.log(`Model ${model} failed with status ${response.status}:`, errorData);
        lastError = new Error(`Model ${model} failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        const text = data.candidates[0].content.parts[0].text;
        console.log(`✅ Success with model: ${model}`);
        return text;
      } else {
        console.log(`Model ${model} returned no text`);
        lastError = new Error(`Model ${model} returned no text`);
      }
    } catch (error) {
      console.log(`Error with model ${model}:`, error.message);
      lastError = error;
    }
  }

  throw lastError || new Error('All models failed');
}

export default async function handler(req, res) {
  // Только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      productName, 
      competitorLinks = [], 
      keywords = '',
      platform = 'wb',
      userId 
    } = req.body;

    console.log('Received request:', { productName, competitorLinks, keywords, platform, userId });

    // Валидация
    if (!productName) {
      return res.status(400).json({ error: 'Product name is required' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Проверяем баланс
    const balanceCheck = await checkUserBalance(userId);
    if (!balanceCheck.success) {
      return res.status(400).json({ error: balanceCheck.error });
    }

    console.log(`Generating description for: ${productName}`);

    // ===== ПРОМПТ ДЛЯ GEMINI =====
    const prompt = `Ты — профессиональный маркетолог и копирайтер для Wildberries и Ozon. Твоя задача — создавать продающие, структурированные описания товаров.

## Инструкция
1. Создай привлекательный заголовок.
2. Подчеркни уникальные характеристики товара.
3. ${competitorLinks.length > 0 ? 'Проанализируй ссылки конкурентов и сделай описание лучше.' : ''}
4. Используй ключевые слова: ${keywords || 'не указаны'}.
5. Структурируй описание (преимущества, характеристики, комплектация, почему стоит купить).
6. Заверши призывом к действию.
7. Платформа: ${platform === 'wb' ? 'Wildberries' : 'Ozon'}

Название товара: ${productName}
${competitorLinks.length > 0 ? `Ссылки для анализа:\n${competitorLinks.join('\n')}` : ''}

Создай уникальное, продающее описание товара.`;

    // Генерируем текст
    const generatedText = await generateWithGemini(prompt);

    if (!generatedText) {
      throw new Error('Generated text is empty');
    }

    // Списание средств
    const deductResult = await deductBalance(userId, 100);
    if (!deductResult.success) {
      console.error('Failed to deduct balance:', deductResult.error);
    }

    // Сохраняем в историю
    await saveDescription(userId, {
      productName,
      description: generatedText,
      keywords,
      competitorLinks,
      platform
    });

    // Возвращаем результат
    res.status(200).json({
      success: true,
      description: generatedText,
      balance: balanceCheck.balance - 100
    });

  } catch (error) {
    console.error('❌ Error in description generation:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}