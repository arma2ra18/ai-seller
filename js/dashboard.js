import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

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

// Загрузка данных пользователя из Firestore
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

// Обновление интерфейса (баланс, тариф)
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

// Глобальная функция выхода
window.logout = async function() {
    try {
        await signOut(auth);
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Ошибка выхода:', error);
        alert('Не удалось выйти. Попробуйте ещё раз.');
    }
};

// Функция пополнения баланса
window.topUpBalance = async function() {
    alert('Функция пополнения будет доступна после подключения платежей.');
    // Здесь можно вызвать createPayment из payment.js
};

// Генерация карточки для Wildberries
window.generateWBCard = async function() {
    if (!currentUser || !userData) return;

    const productName = document.getElementById('wbProductName').value;
    const brand = document.getElementById('wbBrand').value;
    const category = document.getElementById('wbCategory').value;
    const features = document.getElementById('wbFeatures').value.split(',').map(f => f.trim());
    const files = document.getElementById('wbPhotos').files;

    if (!productName || files.length === 0) {
        alert('Заполните название и загрузите хотя бы одно фото');
        return;
    }

    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 3 > maxGen) {
        alert('Недостаточно токенов (требуется 3)');
        return;
    }

    const btn = document.querySelector('[onclick="generateWBCard()"]');
    btn.disabled = true;
    btn.textContent = '⏳ Генерация...';

    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('photos', files[i]);
        }
        formData.append('productName', productName);
        formData.append('brand', brand);
        formData.append('category', category);
        formData.append('features', JSON.stringify(features));
        formData.append('platform', 'wb');

        const response = await fetch('/api/generate-card', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }

        const result = await response.json();
        displayCardResults(result, 'wb');

        // Сохраняем в историю
        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'wb-card',
            productName,
            result,
            timestamp: new Date().toISOString()
        });

        // Списание токенов
        await updateDoc(doc(db, 'users', currentUser.uid), {
            usedGenerations: increment(3)
        });
        userData.usedGenerations += 3;
        updateUI();

        showNotification('Карточка для WB создана!', 'success');

    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Создать карточку для WB';
    }
};

// Генерация карточки для Ozon (аналогично)
window.generateOzonCard = async function() {
    if (!currentUser || !userData) return;

    const productName = document.getElementById('ozonProductName').value;
    const brand = document.getElementById('ozonBrand').value;
    const category = document.getElementById('ozonCategory').value;
    const features = document.getElementById('ozonFeatures').value.split(',').map(f => f.trim());
    const files = document.getElementById('ozonPhotos').files;

    if (!productName || files.length === 0) {
        alert('Заполните название и загрузите фото');
        return;
    }

    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 3 > maxGen) {
        alert('Недостаточно токенов');
        return;
    }

    const btn = document.querySelector('[onclick="generateOzonCard()"]');
    btn.disabled = true;
    btn.textContent = '⏳ Генерация...';

    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('photos', files[i]);
        }
        formData.append('productName', productName);
        formData.append('brand', brand);
        formData.append('category', category);
        formData.append('features', JSON.stringify(features));
        formData.append('platform', 'ozon');

        const response = await fetch('/api/generate-card', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }

        const result = await response.json();
        displayCardResults(result, 'ozon');

        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'ozon-card',
            productName,
            result,
            timestamp: new Date().toISOString()
        });

        await updateDoc(doc(db, 'users', currentUser.uid), {
            usedGenerations: increment(3)
        });
        userData.usedGenerations += 3;
        updateUI();

        showNotification('Карточка для Ozon создана!', 'success');

    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Создать карточку для Ozon';
    }
};

// Отображение результатов карточки (5 фото, несколько описаний)
function displayCardResults(result, platform) {
    const container = document.getElementById('cardResults');
    container.style.display = 'block';

    const gallery = container.querySelector('.image-gallery');
    gallery.innerHTML = '';
    if (result.images && result.images.length) {
        result.images.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Generated';
            img.onclick = () => window.open(url, '_blank');
            gallery.appendChild(img);
        });
    }

    const descList = container.querySelector('.description-list');
    descList.innerHTML = '';
    if (result.descriptions && result.descriptions.length) {
        result.descriptions.forEach((desc, idx) => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.textContent = `Вариант ${idx + 1}: ${desc}`;
            div.onclick = () => navigator.clipboard.writeText(desc) && alert('Скопировано!');
            descList.appendChild(div);
        });
    }
}

// Генерация текста (старая функция, можно оставить)
window.generate = async function() {
    // ... (код из предыдущих версий)
};

// Загрузка истории
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
                    <div><strong>${item.productName || 'Карточка'}</strong> <div class="history-date">${date}</div></div>
                    <button class="btn btn-small" onclick="viewHistoryItem('${doc.id}')">👁️</button>
                </div>
            `;
        });
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
    }
}

// Просмотр элемента истории (заглушка)
window.viewHistoryItem = async function(id) {
    alert('Просмотр истории: ' + id);
};

// Уведомления
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// Инициализация вкладок
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