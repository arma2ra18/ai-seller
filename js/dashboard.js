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

// ----- Навигация по меню -----
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

// ----- Генерация для Wildberries -----
window.generateWBCard = async function() {
    if (!currentUser || !userData) return;

    const fileInput = document.getElementById('wbPhotos');
    if (!fileInput) {
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

// ----- Генерация для Ozon -----
window.generateOzonCard = async function() {
    // Аналогично WB (с другими ID), для краткости можно не повторять
    // ... (здесь должен быть код)
};

// ----- Отображение результатов -----
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
                // Используем глобальную функцию openLightbox
                img.onclick = () => window.openLightbox(url);
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

// ----- Лайтбокс (глобальные функции) -----
window.openLightbox = function(imageUrl) {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = imageUrl;
    lightbox.classList.add('show');
    document.body.style.overflow = 'hidden';
};

window.closeLightbox = function() {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;
    lightbox.classList.remove('show');
    document.body.style.overflow = '';
};

// Закрытие по Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.closeLightbox();
    }
});

// ----- История -----
async function loadHistory() {
    if (!currentUser) return;
    try {
        const q = query(collection(db, 'users', currentUser.uid, 'generations'), orderBy('timestamp', 'desc'), limit(10));
        const snapshot = await getDocs(q);
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
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
        console.error('Ошибка загрузки истории:', error);
        showNotification('Ошибка загрузки', 'error');
    }
};

// ----- Пополнение баланса -----
let currentPlan = null;

window.showPaymentModal = function() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.classList.add('show');
    const title = document.getElementById('modalTitle');
    if (title) title.textContent = 'Пополнение баланса';
    const desc = document.getElementById('modalDescription');
    if (desc) desc.innerHTML = 'Выберите один из тарифов ниже.';
    const planSpan = document.getElementById('selectedPlanName');
    if (planSpan) planSpan.textContent = '—';
    const amount = document.getElementById('modalAmount');
    if (amount) amount.textContent = '0 ₽';
};

window.selectPlan = function(plan) {
    const plans = {
        'start': { name: 'Старт', price: 990 },
        'business': { name: 'Бизнес', price: 2990 },
        'pro': { name: 'Профи', price: 9900 }
    };
    currentPlan = plan;

    const title = document.getElementById('modalTitle');
    if (title) title.textContent = 'Оформление подписки';
    const planSpan = document.getElementById('selectedPlanName');
    if (planSpan) planSpan.textContent = plans[plan].name;
    const amount = document.getElementById('modalAmount');
    if (amount) amount.textContent = `${plans[plan].price} ₽`;
    const modal = document.getElementById('paymentModal');
    if (modal) modal.classList.add('show');
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
            console.error('Ошибка при активации:', error);
            showNotification('Ошибка при активации', 'error');
        }
    }, 2000);
};

window.closeModal = function() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.classList.remove('show');
    currentPlan = null;
};

// ----- Уведомления -----
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// Закрытие модалки по клику вне её
window.onclick = function(event) {
    const modal = document.getElementById('paymentModal');
    if (event.target === modal) closeModal();
};