import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit, setDoc
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let currentUser = null;
let userData = null;

// Авторизация
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = '/login.html'; return; }
    currentUser = user;
    await loadUserData();
});

// Загрузка данных пользователя
async function loadUserData() {
    if (!currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            userData = userDoc.data();
            updateUI();
            loadHistory();
            updateStats();
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
        console.error(error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

// Обновление интерфейса
function updateUI() {
    if (!userData) return;
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    const used = userData.usedGenerations || 0;
    const remaining = maxGen - used;

    document.querySelectorAll('#remainingGenerations, #remainingGenerationsDetail').forEach(el => el && (el.textContent = remaining));
    document.querySelectorAll('#maxGenerations, #maxGenerationsDetail').forEach(el => el && (el.textContent = maxGen));
    const usedEl = document.getElementById('usedGenerationsDetail');
    if (usedEl) usedEl.textContent = used;
    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) userEmailEl.textContent = currentUser.email;
    const planNames = { 'start': 'Старт', 'business': 'Бизнес', 'pro': 'Профи' };
    const userPlanEl = document.getElementById('userPlan');
    if (userPlanEl) userPlanEl.textContent = planNames[userData.plan] || 'Старт';
}

// Статистика
function updateStats() {
    document.getElementById('statUser') && (document.getElementById('statUser').textContent = currentUser.email.split('@')[0]);
    document.getElementById('statCards') && (document.getElementById('statCards').textContent = userData?.usedGenerations || 0);
    document.getElementById('statVideos') && (document.getElementById('statVideos').textContent = 0);
    document.getElementById('statDescriptions') && (document.getElementById('statDescriptions').textContent = userData?.usedGenerations || 0);
    document.getElementById('statHistory') && (document.getElementById('statHistory').textContent = 0);
    document.getElementById('statBalance') && (document.getElementById('statBalance').textContent = userData?.balance || 30);
    document.getElementById('statNews') && (document.getElementById('statNews').textContent = 29);
    document.getElementById('statBonus') && (document.getElementById('statBonus').textContent = 0);
}

// Выход
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/login.html';
};

// Навигация по меню
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function() {
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(this.dataset.section + '-section');
        if (target) target.classList.add('active');
    });
});

// Дропзоны
function setupDropzone(dropzoneId, inputId) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;
    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--accent)'; });
    dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border)');
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border)';
        input.files = e.dataTransfer.files;
        updateDropzoneText(dropzone, input);
    });
    input.addEventListener('change', () => updateDropzoneText(dropzone, input));
}

function updateDropzoneText(dropzone, input) {
    dropzone.innerHTML = input.files?.length
        ? `<span>Выбрано: ${Array.from(input.files).map(f => f.name).join(', ')}</span>`
        : '<span>Перетащите файлы или нажмите для выбора</span>';
}

document.addEventListener('DOMContentLoaded', () => {
    setupDropzone('wbDropzone', 'wbPhotos');
    setupDropzone('ozonDropzone', 'ozonPhotos');
    // для фото и видео – если нужно
});

// ----- Генерация WB -----
window.generateWBCard = async function() {
    if (!currentUser || !userData) { showNotification('Ошибка авторизации', 'error'); return; }
    const fileInput = document.getElementById('wbPhotos');
    if (!fileInput) { showNotification('Ошибка: элемент загрузки не найден', 'error'); return; }
    const files = fileInput.files;
    const productName = document.getElementById('wbProductName')?.value.trim();
    const brand = document.getElementById('wbBrand')?.value.trim();
    const category = document.getElementById('wbCategory')?.value;
    const features = document.getElementById('wbFeatures')?.value.split(',').map(f => f.trim()).filter(Boolean);
    if (!productName || files.length === 0) { showNotification('Заполните название и загрузите фото', 'error'); return; }

    const maxGen = { start:30, business:200, pro:999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 3 > maxGen) { showNotification('Недостаточно токенов', 'error'); return; }

    const btn = document.querySelector('[onclick="generateWBCard()"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация...';

    try {
        const formData = new FormData();
        for (let f of files) formData.append('photos', f);
        formData.append('productName', productName);
        formData.append('brand', brand);
        formData.append('category', category);
        formData.append('features', JSON.stringify(features));
        formData.append('platform', 'wb');

        const response = await fetch('/api/generate-card', { method:'POST', body:formData });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        displayCardResults(result, 'wb');

        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), { type:'wb-card', productName, result, timestamp:new Date().toISOString() });
        await updateDoc(doc(db, 'users', currentUser.uid), { usedGenerations:increment(3) });
        userData.usedGenerations += 3;
        updateUI();
        loadHistory();
        showNotification('Карточка создана!', 'success');
    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Создать карточку для WB';
    }
};

// ----- Генерация Ozon (аналогично) -----
window.generateOzonCard = async function() {
    // аналогично WB, поменять platform и id
    showNotification('Функция в разработке', 'info');
};

// ----- Отображение результатов -----
function displayCardResults(result, platform) {
    const container = document.getElementById('cardResults');
    if (!container) return;
    container.style.display = 'block';
    const gallery = document.getElementById('resultImages');
    if (gallery) {
        gallery.innerHTML = '';
        if (result.images?.length) result.images.forEach(url => {
            const img = document.createElement('img');
            img.src = url; img.alt = ''; img.onclick = () => window.open(url);
            gallery.appendChild(img);
        });
        else gallery.innerHTML = '<p class="text-muted">Нет изображений</p>';
    }
    const descList = document.getElementById('resultDescriptions');
    if (descList) {
        descList.innerHTML = '';
        if (result.descriptions?.length) result.descriptions.forEach((desc, i) => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.textContent = `Вариант ${i+1}: ${desc}`;
            div.onclick = () => { navigator.clipboard.writeText(desc); showNotification('Скопировано!', 'success'); };
            descList.appendChild(div);
        });
        else descList.innerHTML = '<p class="text-muted">Нет описаний</p>';
    }
}

// ----- История -----
async function loadHistory() {
    if (!currentUser) return;
    try {
        const q = query(collection(db, 'users', currentUser.uid, 'generations'), orderBy('timestamp', 'desc'), limit(10));
        const snapshot = await getDocs(q);
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
        if (snapshot.empty) { historyList.innerHTML = '<p class="text-muted">История пуста</p>'; return; }
        historyList.innerHTML = '';
        snapshot.forEach(doc => {
            const item = doc.data();
            const date = new Date(item.timestamp).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
            const type = item.type === 'wb-card' ? 'WB' : item.type === 'ozon-card' ? 'Ozon' : 'Фото';
            historyList.innerHTML += `<div class="history-item"><div><strong>${item.productName || 'Без названия'}</strong><span class="history-type">${type}</span><div class="history-date">${date}</div></div><button class="btn btn-small btn-outline" onclick="viewHistoryItem('${doc.id}')">👁️</button></div>`;
        });
    } catch (error) { console.error(error); }
}

window.viewHistoryItem = async function(id) {
    if (!currentUser) return;
    try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid, 'generations', id));
        if (snap.exists()) {
            const item = snap.data();
            if (item.result) displayCardResults(item.result, item.type);
            else showNotification('Нет данных', 'error');
        }
    } catch (error) { showNotification('Ошибка загрузки', 'error'); }
};

// ----- Пополнение баланса -----
let currentPlan = null;
window.showPaymentModal = function() {
    document.getElementById('paymentModal')?.classList.add('show');
    document.getElementById('selectedPlanName').textContent = '—';
    document.getElementById('modalAmount').textContent = '0 ₽';
};
window.selectPlan = function(plan) {
    const plans = { start:{name:'Старт',price:990}, business:{name:'Бизнес',price:2990}, pro:{name:'Профи',price:9900} };
    currentPlan = plan;
    document.getElementById('selectedPlanName').textContent = plans[plan].name;
    document.getElementById('modalAmount').textContent = `${plans[plan].price} ₽`;
    document.getElementById('paymentModal')?.classList.add('show');
};
window.confirmPayment = function() {
    if (!currentPlan) { showNotification('Выберите тариф', 'warning'); return; }
    const tokens = { start:30, business:200, pro:999999 }[currentPlan];
    showNotification('Оплата обрабатывается...', 'info');
    setTimeout(async () => {
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), { plan:currentPlan, balance:tokens, usedGenerations:userData.usedGenerations||0 });
            userData.plan = currentPlan;
            userData.balance = tokens;
            updateUI();
            showNotification(`Тариф "${currentPlan}" активирован!`, 'success');
            closeModal();
        } catch (error) { showNotification('Ошибка', 'error'); }
    }, 1500);
};
window.closeModal = function() {
    document.getElementById('paymentModal')?.classList.remove('show');
    currentPlan = null;
};

// Уведомления
function showNotification(msg, type = 'info') {
    const n = document.createElement('div');
    n.className = `notification ${type}`;
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}

// Закрытие модалки по клику вне
window.onclick = function(e) {
    const modal = document.getElementById('paymentModal');
    if (e.target === modal) closeModal();
};