// api/lib/db.js
import { neon } from '@neondatabase/serverless';

// Проверяем, есть ли строка подключения в переменных окружения
if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is not set. Please connect your Neon database.');
}

// Создаем функцию для выполнения SQL-запросов
// Мы назовем её `sql`, чтобы было понятно.
// `process.env.POSTGRES_URL` — это секретный ключ, который Vercel создал сам,
// когда мы подключили Neon. Он хранит адрес нашей базы данных и пароль.
export const sql = neon(process.env.POSTGRES_URL);