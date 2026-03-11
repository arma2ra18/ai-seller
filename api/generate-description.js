// Временный файл /api/generate-description.js для теста
export default function handler(req, res) {
  // Разрешаем только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method Not Allowed',
      message: 'This endpoint only accepts POST requests'
    });
  }
  
  // Если дошли до сюда, значит POST запрос принят
  res.status(200).json({ 
    success: true, 
    message: 'API is working!',
    receivedData: req.body 
  });
}