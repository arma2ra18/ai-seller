// api/send-verification-code.js
import axios from 'axios';

export default async function handler(req, res) {
  // Разрешаем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    
    if (!firebaseApiKey) {
      throw new Error('FIREBASE_API_KEY not set');
    }

    console.log(`📱 Sending code to ${phoneNumber}`);

    // Отправляем запрос в Firebase
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${firebaseApiKey}`,
      {
        phoneNumber: phoneNumber,
        recaptchaToken: 'NO_RECAPTCHA' // Для серверной отправки
      }
    );

    const { sessionInfo } = response.data;

    res.status(200).json({ 
      success: true,
      sessionInfo: sessionInfo
    });

  } catch (error) {
    console.error('SMS error:', error.response?.data || error.message);
    
    const errorMessage = error.response?.data?.error?.message || error.message;
    
    res.status(500).json({ 
      error: errorMessage,
      details: 'Failed to send verification code'
    });
  }
}