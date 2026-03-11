import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

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
 * Получение токена доступа для GigaChat API
 * @param {string} authKey - ключ авторизации (Base64 от Client ID:Client Secret)
 */
async function getGigaChatToken(authKey) {
  const url = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
  const rqUid = uuidv4(); // Уникальный идентификатор запроса
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'RqUID': rqUid,
        'Authorization': `Basic ${authKey}`
      },
      body: new URLSearchParams({
        scope: 'GIGACHAT_API_PERS' // или GIGACHAT_API_B2B для ИП/юрлиц
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GigaChat token error:', response.status, errorText);
      throw new Error(`GigaChat token error: ${response.status}`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error getting GigaChat token:', error);
    throw error;
  }
}

/**
 * Генерация описания через GigaChat API
 */
async function generateWithGigaChat(prompt, authKey) {
  // Получаем токен доступа
  const accessToken = await getGigaChatToken(authKey);
  
  const url = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
  
  const requestBody = {
    model: 'GigaChat-2-Pro', // или GigaChat-2, GigaChat-2-Max
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.7,
    max_tokens: 2048,
    top_p: 0.9,
    repetition_penalty: 1.1
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GigaChat generation error:', response.status, errorText);
      throw new Error(`GigaChat generation error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content;
    } else {
      throw new Error('GigaChat returned no content');
    }
  } catch (error) {
    console.error('Error calling GigaChat:', error);
    throw error;
  }
}

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

    // Проверяем наличие ключа GigaChat
    const GIGACHAT_AUTH_KEY = process.env.GIGACHAT_AUTH_KEY;
    if (!GIGACHAT_AUTH_KEY) {
      console.error('❌ GIGACHAT_AUTH_KEY not set in environment');
      return res.status(500).json({ error: 'GigaChat API key not configured' });
    }

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

    // ===== ПРОМПТ ДЛЯ GIGACHAT =====
    // Формируем системный промпт и пользовательский запрос
    const systemPrompt = `Ты профессиональный копирайтер для Wildberries и Ozon. Твоя задача — создавать продающие, структурированные описания товаров, которые соответствуют требованиям маркетплейсов и привлекают покупателей.

## Инструкция
1. Создай привлекательный заголовок (можно с эмодзи).
2. В основной части описания подчеркни уникальные характеристики товара, преимущества, материалы, особенности.
3. Используй ключевые слова из запроса, если они есть.
4. Структурируй описание: преимущества, характеристики, комплектация, почему стоит купить.
5. Заверши сильным призывом к действию.
6. Формат: обычный текст с абзацами, можно использовать эмодзи для визуального выделения.

Платформа: ${platform === 'wb' ? 'Wildberries' : 'Ozon'}`;

    const userPrompt = `Название товара: ${productName}
${keywords ? `Ключевые слова: ${keywords}` : ''}
${competitorLinks.length > 0 ? `Ссылки для анализа (проанализируй их и сделай описание лучше):\n${competitorLinks.map((link, i) => `${i+1}. ${link}`).join('\n')}` : ''}

Создай уникальное, продающее описание товара.`;

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    console.log('🚀 Отправляем запрос к GigaChat API...');

    // Генерируем текст через GigaChat
    const generatedText = await generateWithGigaChat(fullPrompt, GIGACHAT_AUTH_KEY);

    if (!generatedText) {
      throw new Error('Generated text is empty');
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