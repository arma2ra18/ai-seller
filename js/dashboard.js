import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit, setDoc
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

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
        } else {
            await setDoc(doc(db, 'users', currentUser.uid), {
                email: currentUser.email,
                plan: 'start',
                balance: 30,
                usedGenerations: 0,
                createdAt: new Date().toISOString()
            });
            await loadUserData();
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

function updateUI() {
    if (!userData) return;
    document.getElementById('userEmail').textContent = currentUser.email;
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    const used = userData.usedGenerations || 0;
    document.getElementById('usedGenerations').textContent = used;
    document.getElementById('maxGenerations').textContent = maxGen;
    document.getElementById('remainingGenerations').textContent = Math.max(0, maxGen - used);
    const progress = (used / maxGen) * 100;
    document.getElementById('generationProgress').style.width = `${Math.min(progress, 100)}%`;
    const planNames = { 'start': 'Старт', 'business': 'Бизнес', 'pro': 'Профи' };
    document.getElementById('userPlan').textContent = planNames[userData.plan] || 'Старт';
}

window.logout = async function() {
    try {
        await signOut(auth);
        window.location.href = '/login.html';
    } catch (error) {
        showNotification('Ошибка выхода', 'error');
    }
};

// ----- Пополнение баланса и подписка -----
let currentPlan = null;
let currentPrice = 0;

window.showPaymentModal = function() {
    document.getElementById('modalTitle').textContent = 'Пополнение баланса';
    document.getElementById('modalDescription').innerHTML = 'Выберите один из тарифов ниже.';
    document.getElementById('selectedPlanName').textContent = '—';
    document.getElementById('modalAmount').textContent = '0 ₽';
    document.getElementById('paymentModal').classList.add('show');
};

window.selectPlan = function(plan) {
    const plans = {
        'start': { name: 'Старт', price: 990 },
        'business': { name: 'Бизнес', price: 2990 },
        'pro': { name: 'Профи', price: 9900 }
    };
    currentPlan = plan;
    currentPrice = plans[plan].price;

    document.getElementById('modalTitle').textContent = 'Оформление подписки';
    document.getElementById('selectedPlanName').textContent = plans[plan].name;
    document.getElementById('modalAmount').textContent = `${plans[plan].price} ₽`;
    document.getElementById('paymentModal').classList.add('show');
};

window.confirmPayment = function() {
    if (!currentPlan) {
        showNotification('Сначала выберите тариф', 'warning');
        return;
    }

    const tokensMap = { 'start': 30, 'business': 200, 'pro': 999999 };
    const tokens = tokensMap[currentPlan];

    showNotification('Оплата обрабатывается...', 'info');

    setTimeout(async () => {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                plan: currentPlan,
                balance: tokens,
                usedGenerations: userData.usedGenerations || 0
            });
            userData.plan = currentPlan;
            userData.balance = tokens;
            updateUI();
            showNotification(`Тариф "${currentPlan}" активирован!`, 'success');
            closeModal();
        } catch (error) {
            showNotification('Ошибка при активации', 'error');
        }
    }, 2000);
};

window.closeModal = function() {
    document.getElementById('paymentModal').classList.remove('show');
    currentPlan = null;
    currentPrice = 0;
};

// ----- Генерация карточек -----
window.generateWBCard = async function() {
    if (!currentUser || !userData) return;
    const productName = document.getElementById('wbProductName').value.trim();
    const brand = document.getElementById('wbBrand').value.trim();
    const category = document.getElementById('wbCategory').value;
    const features = document.getElementById('wbFeatures').value.split(',').map(f => f.trim()).filter(Boolean);
    const files = document.getElementById('wbPhotos').files;
    if (!productName || files.length === 0) {
        showNotification('Заполните название и загрузите фото', 'error');
        return;
    }
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 3 > maxGen) {
        showNotification('Недостаточно токенов (требуется 3)', 'error');
        return;
    }
    const btn = document.querySelector('[onclick="generateWBCard()"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) formData.append('photos', files[i]);
        formData.append('productName', productName);
        formData.append('brand', brand);
        formData.append('category', category);
        formData.append('features', JSON.stringify(features));
        formData.append('platform', 'wb');

        const response = await fetch('/api/generate-card', {
            method: 'POST',
            body: formData
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        displayCardResults(result, 'wb');

        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'wb-card',
            productName,
            result,
            timestamp: new Date().toISOString()
        });
        await updateDoc(doc(db, 'users', currentUser.uid), { usedGenerations: increment(3) });
        userData.usedGenerations += 3;
        updateUI();
        loadHistory();
        showNotification('Карточка для WB создана!', 'success');
    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Создать карточку для WB';
    }
};

window.generateOzonCard = async function() {
    if (!currentUser || !userData) return;
    const productName = document.getElementById('ozonProductName').value.trim();
    const brand = document.getElementById('ozonBrand').value.trim();
    const category = document.getElementById('ozonCategory').value;
    const features = document.getElementById('ozonFeatures').value.split(',').map(f => f.trim()).filter(Boolean);
    const files = document.getElementById('ozonPhotos').files;
    if (!productName || files.length === 0) {
        showNotification('Заполните название и загрузите фото', 'error');
        return;
    }
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 3 > maxGen) {
        showNotification('Недостаточно токенов (требуется 3)', 'error');
        return;
    }
    const btn = document.querySelector('[onclick="generateOzonCard()"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';
    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) formData.append('photos', files[i]);
        formData.append('productName', productName);
        formData.append('brand', brand);
        formData.append('category', category);
        formData.append('features', JSON.stringify(features));
        formData.append('platform', 'ozon');

        const response = await fetch('/api/generate-card', {
            method: 'POST',
            body: formData
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        displayCardResults(result, 'ozon');

        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'ozon-card',
            productName,
            result,
            timestamp: new Date().toISOString()
        });
        await updateDoc(doc(db, 'users', currentUser.uid), { usedGenerations: increment(3) });
        userData.usedGenerations += 3;
        updateUI();
        loadHistory();
        showNotification('Карточка для Ozon создана!', 'success');
    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Создать карточку для Ozon';
    }
};

function displayCardResults(result, platform) {
    const container = document.getElementById('cardResults');
    container.style.display = 'block';
    const gallery = document.getElementById('resultImages');
    gallery.innerHTML = '';
    if (result.images && result.images.length) {
        result.images.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = 'Generated';
            img.onclick = () => window.open(url, '_blank');
            gallery.appendChild(img);
        });
    } else {
        gallery.innerHTML = '<p class="text-muted">Изображения не сгенерированы</p>';
    }
    const descList = document.getElementById('resultDescriptions');
    descList.innerHTML = '';
    if (result.descriptions && result.descriptions.length) {
        result.descriptions.forEach((desc, idx) => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.textContent = `Вариант ${idx + 1}: ${desc}`;
            div.onclick = () => {
                navigator.clipboard.writeText(desc);
                showNotification('Описание скопировано!', 'success');
            };
            descList.appendChild(div);
        });
    } else {
        descList.innerHTML = '<p class="text-muted">Описания не сгенерированы</p>';
    }
}

// ----- История -----
async function loadHistory() {
    if (!currentUser) return;
    try {
        const q = query(collection(db, 'users', currentUser.uid, 'generations'), orderBy('timestamp', 'desc'), limit(10));
        const snapshot = await getDocs(q);
        const historyList = document.getElementById('historyList');
        if (snapshot.empty) {
            historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
            return;
        }
        historyList.innerHTML = '';
        snapshot.forEach(doc => {
            const item = doc.data();
            const date = new Date(item.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const typeLabel = item.type === 'wb-card' ? 'WB' : item.type === 'ozon-card' ? 'Ozon' : 'Фото';
            historyList.innerHTML += `
                <div class="history-item">
                    <div>
                        <strong>${item.productName || 'Без названия'}</strong>
                        <span class="history-type">${typeLabel}</span>
                        <div class="history-date">${date}</div>
                    </div>
                    <button class="btn btn-small btn-outline" onclick="viewHistoryItem('${doc.id}')">👁️</button>
                </div>
            `;
        });
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        document.getElementById('historyList').innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
    }
}

window.viewHistoryItem = async function(docId) {
    if (!currentUser) return;
    try {
        const docSnap = await getDoc(doc(db, 'users', currentUser.uid, 'generations', docId));
        if (docSnap.exists()) {
            const item = docSnap.data();
            if (item.result && item.result.images && item.result.descriptions) {
                displayCardResults(item.result, item.type || 'wb-card');
                document.getElementById('cardResults').scrollIntoView({ behavior: 'smooth' });
            } else {
                showNotification('Не удалось загрузить результат', 'error');
            }
        } else {
            showNotification('Запись не найдена', 'error');
        }
    } catch (error) {
        showNotification('Ошибка загрузки', 'error');
    }
};

// ----- Уведомления -----
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// ----- Инициализация вкладок -----
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

    window.onclick = function(event) {
        const modal = document.getElementById('paymentModal');
        if (event.target === modal) closeModal();
    };
});