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
        console.error('Ошибка загрузки пользователя:', error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

function updateUI() {
    if (!userData) return;
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    const used = userData.usedGenerations || 0;
    const remaining = Math.max(0, maxGen - used);

    document.querySelectorAll('#remainingGenerations, #remainingGenerationsDetail').forEach(el => {
        if (el) el.textContent = remaining;
    });
    document.querySelectorAll('#maxGenerations, #maxGenerationsDetail').forEach(el => {
        if (el) el.textContent = maxGen;
    });
    const usedDetail = document.getElementById('usedGenerationsDetail');
    if (usedDetail) usedDetail.textContent = used;
    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) userEmailEl.textContent = currentUser.email;
    const planNames = { 'start': 'Старт', 'business': 'Бизнес', 'pro': 'Профи' };
    const userPlanEl = document.getElementById('userPlan');
    if (userPlanEl) userPlanEl.textContent = planNames[userData.plan] || 'Старт';
}

function updateStats() {
    const statUser = document.getElementById('statUser');
    if (statUser) statUser.textContent = currentUser.email.split('@')[0];
    const statCards = document.getElementById('statCards');
    if (statCards) statCards.textContent = userData?.usedGenerations || 0;
    const statVideos = document.getElementById('statVideos');
    if (statVideos) statVideos.textContent = 0;
    const statDescriptions = document.getElementById('statDescriptions');
    if (statDescriptions) statDescriptions.textContent = userData?.usedGenerations || 0;
    const statHistory = document.getElementById('statHistory');
    if (statHistory) statHistory.textContent = 0;
    const statBalance = document.getElementById('statBalance');
    if (statBalance) statBalance.textContent = userData?.balance || 30;
    const statNews = document.getElementById('statNews');
    if (statNews) statNews.textContent = 29;
    const statBonus = document.getElementById('statBonus');
    if (statBonus) statBonus.textContent = 0;
}

window.logout = async function() {
    try {
        await signOut(auth);
        window.location.href = '/login.html';
    } catch (error) {
        showNotification('Ошибка выхода', 'error');
    }
};

// Навигация по меню
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', function() {
        const section = this.dataset.section;
        document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(section + '-section');
        if (target) target.classList.add('active');
    });
});

// Генерация карточки для Wildberries
window.generateWBCard = async function() {
    if (!currentUser || !userData) return;

    const fileInput = document.getElementById('wbPhotos');
    if (!fileInput) {
        console.error('❌ Элемент #wbPhotos не найден');
        showNotification('Ошибка: элемент загрузки не найден.', 'error');
        return;
    }
    
    const productName = document.getElementById('wbProductName')?.value.trim();
    const brand = document.getElementById('wbBrand')?.value.trim();
    const category = document.getElementById('wbCategory')?.value;
    const price = document.getElementById('wbPrice')?.value.trim() || '1990';
    const features = document.getElementById('wbFeatures')?.value.split(',').map(f => f.trim()).filter(Boolean);
    const files = fileInput.files;
    
    if (!productName) {
        showNotification('Введите название товара', 'error');
        return;
    }
    if (files.length === 0) {
        showNotification('Выберите хотя бы одно фото', 'error');
        return;
    }

    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 3 > maxGen) {
        showNotification('Недостаточно токенов (требуется 3)', 'error');
        return;
    }

    const btn = document.getElementById('generateWBBtn') || document.querySelector('[onclick="generateWBCard()"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loading"></span> Генерация...';
    }

    try {
        const formData = new FormData();
        for (let i = 0; i < files.length; i++) formData.append('photos', files[i]);
        formData.append('productName', productName);
        formData.append('brand', brand);
        formData.append('category', category);
        formData.append('price', price);
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
        console.error('Ошибка генерации:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✨ Создать карточку для WB';
        }
    }
};

// Аналогично generateOzonCard (опущено для краткости, но в реальном файле должно быть)

// Отображение результатов (работает с любым количеством фото)
function displayCardResults(result, platform) {
    const container = document.getElementById('cardResults');
    if (!container) return;
    container.style.display = 'block';

    const gallery = document.getElementById('resultImages');
    if (gallery) {
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
    }

    const descList = document.getElementById('resultDescriptions');
    if (descList) {
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
}

// ... остальные функции (loadHistory, viewHistoryItem, showPaymentModal, confirmPayment, closeModal, showNotification) остаются без изменений