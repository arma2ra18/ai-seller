import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let currentUser = null;
let userData = null;

// Следим за состоянием авторизации
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;
    await loadUserData();
});

// Загружаем данные пользователя из Firestore
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

// Обновляем интерфейс (баланс, тариф)
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
    if (!currentUser || !userData) return;

    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;

    if ((userData.usedGenerations || 0) >= maxGen) {
        alert('Лимит исчерпан');
        return;
    }

    const data = {
        category: document.getElementById('category').value,
        productName: document.getElementById('productName').value,
        features: document.getElementById('features').value.split(',').map(f => f.trim()),
        audience: document.getElementById('audience').value,
        keywords: document.getElementById('keywords').value.split(',').map(k => k.trim())
    };

    if (!data.category || !data.productName) {
        alert('Заполните категорию и название');
        return;
    }

    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Генерация...';

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Сервер вернул ${response.status}: ${text.substring(0, 100)}`);
        }

        const result = await response.json();
        displayResults(result);

        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'text',
            productName: data.productName,
            result: result,
            timestamp: new Date().toISOString()
        });

        await updateDoc(doc(db, 'users', currentUser.uid), {
            usedGenerations: increment(1)
        });

        userData.usedGenerations = (userData.usedGenerations || 0) + 1;
        updateUI();
        alert('Готово!');

    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '✨ Сгенерировать текст (1 токен)';
    }
};

function displayResults(result) {
    document.getElementById('resultsSection').style.display = 'block';

    const namesList = document.getElementById('namesList');
    namesList.innerHTML = '';
    if (result.names) {
        result.names.forEach(name => {
            namesList.innerHTML += `<div class="result-item" onclick="copyText(this)">${name}</div>`;
        });
    }

    document.getElementById('descriptionText').textContent = result.description || '';

    const specsTable = document.getElementById('specsTable');
    specsTable.innerHTML = '';
    if (result.specs) {
        Object.entries(result.specs).forEach(([key, value]) => {
            specsTable.innerHTML += `<tr><td><strong>${key}</strong></td><td>${value || '—'}</td></tr>`;
        });
    }
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

    // Показываем индикатор загрузки
    document.getElementById('photoLoading').style.display = 'block';
    document.getElementById('photoResult').style.display = 'none';
    const btn = document.getElementById('generatePhotoBtn');
    btn.disabled = true;

    try {
        const productImageBase64 = await fileToBase64(fileInput.files[0]);

        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productImage: productImageBase64, prompt, model })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Ошибка: ${response.status} — ${text.substring(0, 100)}`);
        }

        const result = await response.json();

        if (result.success) {
            document.getElementById('generatedImage').src = result.imageUrl;
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

            // Списываем токены (2)
            await updateDoc(doc(db, 'users', currentUser.uid), {
                usedGenerations: increment(2)
            });

            userData.usedGenerations = (userData.usedGenerations || 0) + 2;
            updateUI();
            alert('Фото готово!');
        } else {
            throw new Error(result.error || 'Неизвестная ошибка');
        }
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        document.getElementById('photoLoading').style.display = 'none';
        btn.disabled = false;
    }
};

// ==================== ВИДЕО ====================
window.generateVideo = async function() {
    if (!currentUser || !userData) return;

    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;

    if ((userData.usedGenerations || 0) + 5 > maxGen) {
        alert('Недостаточно токенов (нужно 5)');
        return;
    }

    const fileInput = document.getElementById('videoPhoto');
    if (!fileInput || !fileInput.files[0]) {
        alert('Загрузите фото для видео');
        return;
    }

    const videoType = document.getElementById('videoType').value;
    const duration = parseInt(document.getElementById('videoDuration').value);
    const aspectRatio = document.getElementById('videoAspectRatio').value;
    const category = document.getElementById('videoCategory').value;
    const customPrompt = document.getElementById('videoPrompt').value;

    // Если пользователь не ввёл промпт, используем шаблон (можно подключить promptTemplates)
    let finalPrompt = customPrompt;
    if (!finalPrompt) {
        // Здесь можно добавить импорт promptTemplates, если нужно
        finalPrompt = `Professional product video, ${category} category, high quality`;
    }

    document.getElementById('videoLoading').style.display = 'block';
    document.getElementById('videoResult').style.display = 'none';
    const btn = document.getElementById('generateVideoBtn');
    btn.disabled = true;

    try {
        const productImageBase64 = await fileToBase64(fileInput.files[0]);

        const response = await fetch('/api/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                productImage: productImageBase64,
                videoType,
                duration,
                aspectRatio,
                customPrompt: finalPrompt
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Ошибка: ${response.status} — ${text.substring(0, 100)}`);
        }

        const result = await response.json();

        if (result.success) {
            const videoEl = document.getElementById('generatedVideo');
            videoEl.src = result.videoUrl;
            document.getElementById('videoResult').style.display = 'block';
            window.lastVideoUrl = result.videoUrl;

            await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
                type: 'video',
                productName: document.getElementById('productName')?.value || 'Товар',
                videoUrl: result.videoUrl,
                videoType: videoType,
                timestamp: new Date().toISOString()
            });

            await updateDoc(doc(db, 'users', currentUser.uid), {
                usedGenerations: increment(5)
            });

            userData.usedGenerations = (userData.usedGenerations || 0) + 5;
            updateUI();
            alert('Видео готово!');
        } else {
            throw new Error(result.error || 'Неизвестная ошибка');
        }
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        document.getElementById('videoLoading').style.display = 'none';
        btn.disabled = false;
    }
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

window.downloadImage = function() {
    if (!window.lastImageUrl) return;
    const link = document.createElement('a');
    link.href = window.lastImageUrl;
    link.download = `product-${Date.now()}.jpg`;
    link.click();
};

window.downloadVideo = function() {
    if (!window.lastVideoUrl) return;
    const link = document.createElement('a');
    link.href = window.lastVideoUrl;
    link.download = `video-${Date.now()}.mp4`;
    link.click();
};

window.copyImageUrl = function() {
    if (!window.lastImageUrl) return;
    navigator.clipboard.writeText(window.lastImageUrl);
    alert('Ссылка скопирована');
};

window.copyVideoUrl = function() {
    if (!window.lastVideoUrl) return;
    navigator.clipboard.writeText(window.lastVideoUrl);
    alert('Ссылка скопирована');
};

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
            historyList.innerHTML += `
                <div class="history-item">
                    <div><strong>${item.productName || 'Фото/видео'}</strong> <div class="history-date">${date}</div></div>
                    <button class="btn btn-small" onclick="alert('Просмотр: ${doc.id}')">👁️</button>
                </div>
            `;
        });
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ ВКЛАДОК ====================
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