import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let currentUser = null;
let userData = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;
    await loadUserData();
});

async function loadUserData() {
    if (!currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            userData = userDoc.data();
            updateUI();
            loadHistory();
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
    }
}

function updateUI() {
    if (!userData) return;
    document.getElementById('userEmail').textContent = currentUser.email;

    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;

    const used = userData.usedGenerations || 0;
    const remaining = Math.max(0, maxGen - used);

    document.getElementById('usedGenerations').textContent = used;
    document.getElementById('maxGenerations').textContent = maxGen;
    document.getElementById('remainingGenerations').textContent = remaining;

    const progress = (used / maxGen) * 100;
    document.getElementById('generationProgress').style.width = `${Math.min(progress, 100)}%`;

    const planNames = { 'start': 'Старт', 'business': 'Бизнес', 'pro': 'Профи' };
    document.getElementById('userPlan').textContent = planNames[userData.plan] || 'Старт';
}

// ==================== ТЕКСТ ====================
window.generate = async function() {
    // ... (оставляем без изменений, он у тебя работает)
    // Для краткости я не копирую всю функцию, но в твоём файле она уже есть.
    // Вставь сюда свою рабочую функцию generate, если хочешь сохранить.
    // Или оставь как есть, но для целостности я приведу полный файл в конце.
};

function displayResults(result) {
    // ... (тоже есть)
}

window.copyText = function(element) {
    navigator.clipboard.writeText(element.textContent);
    alert('Скопировано!');
};

// ==================== ФОТО ====================
window.generateProductPhoto = async function() {
    if (!currentUser || !userData) return;

    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;

    if ((userData.usedGenerations || 0) + 2 > maxGen) {
        alert('Недостаточно токенов (нужно 2)');
        return;
    }

    const fileInput = document.getElementById('productPhoto');
    if (!fileInput || !fileInput.files[0]) {
        alert('Загрузите фото');
        return;
    }

    const prompt = document.getElementById('photoPrompt').value;
    const model = document.getElementById('photoModel').value;

    // Показываем загрузку
    document.getElementById('photoLoading').style.display = 'block';
    document.getElementById('photoResult').style.display = 'none';
    const btn = document.getElementById('generatePhotoBtn');
    btn.disabled = true;

    try {
        const productImageBase64 = await fileToBase64(fileInput.files[0]);

        console.log('Отправка запроса на /api/generate-image...');
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productImage: productImageBase64, prompt, model })
        });

        console.log('Статус ответа:', response.status);
        const responseText = await response.text();
        console.log('Ответ сервера (сырой):', responseText);

        if (!response.ok) {
            throw new Error(`Ошибка ${response.status}: ${responseText.substring(0, 200)}`);
        }

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            throw new Error('Сервер вернул не JSON: ' + responseText.substring(0, 100));
        }

        console.log('Распарсенный результат:', result);

        if (result.success && result.imageUrl) {
            // Устанавливаем изображение
            const img = document.getElementById('generatedImage');
            img.src = result.imageUrl;
            img.onload = () => console.log('Изображение загружено');
            img.onerror = (e) => console.error('Ошибка загрузки изображения:', e);

            document.getElementById('photoResult').style.display = 'block';
            window.lastImageUrl = result.imageUrl;

            // Сохраняем в историю
            await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
                type: 'image',
                productName: document.getElementById('productName')?.value || 'Товар',
                imageUrl: result.imageUrl,
                prompt: prompt,
                timestamp: new Date().toISOString()
            });

            // Списываем токены
            await updateDoc(doc(db, 'users', currentUser.uid), {
                usedGenerations: increment(2)
            });

            userData.usedGenerations = (userData.usedGenerations || 0) + 2;
            updateUI();
            alert('Фото готово!');
        } else {
            throw new Error('Сервер не вернул imageUrl: ' + JSON.stringify(result));
        }
    } catch (error) {
        console.error('Ошибка генерации фото:', error);
        alert('Ошибка: ' + error.message);
    } finally {
        document.getElementById('photoLoading').style.display = 'none';
        btn.disabled = false;
    }
};

window.downloadImage = function() {
    if (!window.lastImageUrl) {
        alert('Сначала сгенерируйте фото');
        return;
    }
    const link = document.createElement('a');
    link.href = window.lastImageUrl;
    link.download = `product-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.copyImageUrl = function() {
    if (!window.lastImageUrl) {
        alert('Сначала сгенерируйте фото');
        return;
    }
    navigator.clipboard.writeText(window.lastImageUrl);
    alert('Ссылка скопирована');
};

// ==================== ВИДЕО ====================
window.generateVideo = async function() {
    // Аналогично можно доработать, но сначала фото
    alert('Генерация видео в разработке');
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ====================
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });
}

// ==================== ИСТОРИЯ ====================
async function loadHistory() {
    if (!currentUser) return;
    try {
        const q = query(
            collection(db, 'users', currentUser.uid, 'generations'),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        const snapshot = await getDocs(q);
        const historyList = document.getElementById('historyList');
        if (snapshot.empty) {
            historyList.innerHTML = '<p>История пуста</p>';
            return;
        }
        historyList.innerHTML = '';
        snapshot.forEach(doc => {
            const item = doc.data();
            const date = new Date(item.timestamp).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            let preview = '';
            if (item.type === 'image' && item.imageUrl) {
                preview = `<img src="${item.imageUrl}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; margin-right: 10px;">`;
            }
            historyList.innerHTML += `
                <div class="history-item">
                    <div style="display: flex; align-items: center;">
                        ${preview}
                        <div>
                            <strong>${item.productName || 'Без названия'}</strong>
                            <div class="history-date">${date}</div>
                        </div>
                    </div>
                    <button class="btn btn-small" onclick="alert('Просмотр: ${doc.id}')">👁️</button>
                </div>
            `;
        });
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });

    document.querySelectorAll('.result-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const resultId = this.dataset.result;
            document.querySelectorAll('.result-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.result-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(`${resultId}-result`).classList.add('active');
        });
    });
});