import admin from 'firebase-admin';
import { GoogleGenAI } from '@google/genai';

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
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

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
    const systemPrompt = `Ты — профессиональный маркетолог и копирайтер для Wildberries и Ozon. Твоя задача — создавать продающие, структурированные описания товаров, которые соответствуют требованиям маркетплейсов и привлекают покупателей.

## Инструкция
1. Создай привлекательный заголовок.
2. В основной части описания подчеркни уникальные характеристики товара.
3. Если даны ссылки на конкурентов, проанализируй их.
4. Используй ключевые слова из запроса.
5. Структурируй описание.
6. Заверши сильным призывом к действию.
7. Формат: обычный текст с абзацами.

Платформа: ${platform === 'wb' ? 'Wildberries' : 'Ozon'}`;

    const userPrompt = `
Название товара: ${productName}
${keywords ? `Ключевые слова: ${keywords}` : ''}
${competitorLinks.length > 0 ? `Ссылки для анализа:\n${competitorLinks.map((link, i) => `${i+1}. ${link}`).join('\n')}` : ''}

Создай уникальное, продающее описание товара.`;

    // ИСПРАВЛЕНО: правильное название модели
    const response = await ai.models.generateContent({
      model: 'models/gemini-1.5-flash', // или 'models/gemini-1.5-pro'
      contents: [
        {
          role: 'user',
          parts: [{ text: systemPrompt + "\n\n" + userPrompt }]
        }
      ],
      config: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      }
    });

    const generatedText = response.text;

    if (!generatedText) {
      throw new Error('Failed to generate description');
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