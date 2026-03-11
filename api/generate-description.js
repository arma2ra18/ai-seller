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

    console.log('📝 Получен запрос:', { 
      productName, 
      competitorLinks: competitorLinks.length, 
      keywords, 
      platform, 
      userId 
    });

    // Валидация
    if (!productName) {
      return res.status(400).json({ error: 'Название товара обязательно' });
    }

    if (!userId) {
      return res.status(400).json({ error: 'ID пользователя обязателен' });
    }

    // Проверяем баланс
    const balanceCheck = await checkUserBalance(userId);
    if (!balanceCheck.success) {
      return res.status(400).json({ error: balanceCheck.error });
    }

    console.log(`💰 Баланс пользователя: ${balanceCheck.balance} ₽`);

    // ===== ПРОМПТ ДЛЯ GEMINI =====
    const prompt = `Ты профессиональный копирайтер для Wildberries и Ozon. Напиши продающее описание товара.

Правила:
- Заголовок должен быть ярким и привлекательным
- Описание должно быть структурированным (используй эмодзи, списки)
- Подчеркни преимущества товара
- Добавь призыв к действию в конце
- Не используй шаблонные фразы

Товар: ${productName}
Платформа: ${platform === 'wb' ? 'Wildberries' : 'Ozon'}
${keywords ? `Ключевые слова: ${keywords}` : ''}
${competitorLinks.length > 0 ? 'Проанализируй конкурентов по ссылкам и сделай описание лучше' : ''}

Напиши описание:`;

    // Используем ТОЛЬКО gemini-1.5-flash (самая стабильная)
    const API_KEY = process.env.GOOGLE_API_KEY;
    
    if (!API_KEY) {
      throw new Error('GOOGLE_API_KEY не задан');
    }

    console.log('🚀 Отправляем запрос к Gemini API...');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
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
          temperature: 0.8,
          maxOutputTokens: 2048,
          topP: 0.95,
          topK: 40
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Gemini API ошибка:', response.status, errorText);
      throw new Error(`Gemini API вернул ошибку ${response.status}`);
    }

    const data = await response.json();
    
    // Извлекаем текст из ответа
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!generatedText) {
      console.error('❌ Пустой ответ от Gemini:', data);
      throw new Error('Gemini не вернул текст');
    }

    console.log('✅ Описание успешно сгенерировано, длина:', generatedText.length);

    // Списание средств
    await deductBalance(userId, 100);
    console.log('💰 Списано 100 ₽');

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
    console.error('❌ Критическая ошибка:', error);
    res.status(500).json({ error: error.message || 'Внутренняя ошибка сервера' });
  }
}