// variations.js
export const getVariationPrompt = (attempt, productName) => {
  // Для всех попыток (1-5) ничего не добавляем
  return '';
};

// Для генерации без фото
export const noPhotoPrompt = (productName) => `
### **ГЕНЕРАЦИЯ С НУЛЯ**
У тебя нет фотографии товара. Создай изображение товара "${productName}" с нуля, основываясь на описании. 
Примени все основные правила.
`;