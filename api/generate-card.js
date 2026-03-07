async function generateImagesWithGigaChat(prompt, count = 5) {
    const images = [];
    
    for (let i = 0; i < count; i++) {
        // Уникальный промпт для каждого изображения
        const imagePrompt = `${prompt}, вариант ${i+1}, ${i % 2 === 0 ? 'белый фон' : 'студийный свет'}`;
        
        // 1. Запрос на генерацию
        const completionResponse = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GIGACHAT_AUTH_KEY}`
            },
            body: JSON.stringify({
                model: 'GigaChat',
                messages: [
                    {
                        role: 'system',
                        content: 'Ты — профессиональный дизайнер. Создавай фото товаров для маркетплейсов.'
                    },
                    {
                        role: 'user',
                        content: imagePrompt
                    }
                ],
                function_call: 'auto'
            })
        });

        const completionData = await completionResponse.json();
        
        // 2. Извлекаем file_id из ответа (он в теге <img src="..."/>)
        const content = completionData.choices[0].message.content;
        const match = content.match(/<img src="([^"]+)"/);
        const fileId = match ? match[1] : null;
        
        if (!fileId) {
            console.warn('Не удалось получить file_id');
            continue;
        }

        // 3. Скачиваем изображение
        const imageResponse = await fetch(`https://gigachat.devices.sberbank.ru/api/v1/files/${fileId}/content`, {
            headers: {
                'Accept': 'application/jpg',
                'Authorization': `Bearer ${process.env.GIGACHAT_AUTH_KEY}`
            }
        });

        // 4. Сохраняем или возвращаем URL (можно загрузить в Firebase Storage)
        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const imageUrl = `data:image/jpeg;base64,${base64Image}`;
        
        images.push(imageUrl);
        
        // Небольшая задержка между запросами
        await new Promise(r => setTimeout(r, 1000));
    }
    
    return images;
}