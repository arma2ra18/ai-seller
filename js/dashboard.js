import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit, setDoc
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let currentUser = null;
let userData = null;

// Следим за авторизацией
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

// Обновление интерфейса (баланс, тариф)
function updateUI() {
    if (!userData) return;
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    const used = userData.usedGenerations || 0;
    const remaining = Math.max(0, maxGen - used);

    // Обновляем все элементы с балансом
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

// Обновление плиток статистики
function updateStats() {
    document.getElementById('statUser').textContent = currentUser.email.split('@')[0];
    document.getElementById('statCards').textContent = userData?.usedGenerations || 0;
    document.getElementById('statVideos').textContent = 0;
    document.getElementById('statDescriptions').textContent = userData?.usedGenerations || 0;
    document.getElementById('statHistory').textContent = 0;
    document.getElementById('statBalance').textContent = userData?.balance || 30;
    document.getElementById('statNews').textContent = 29;
    document.getElementById('statBonus').textContent = 0;
}

// Выход
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

// ----- Настройка дропзон -----
function setupDropzone(dropzoneId, inputId) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    if (!dropzone || !input) return;

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--accent)';
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'var(--border)';
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border)';
        input.files = e.dataTransfer.files;
        const names = Array.from(e.dataTransfer.files).map(f => f.name).join(', ');
        dropzone.innerHTML = `<span>Выбрано: ${names}</span>`;
    });
    input.addEventListener('change', () => {
        if (input.files.length > 0) {
            const names = Array.from(input.files).map(f => f.name).join(', ');
            dropzone.innerHTML = `<span>Выбрано: ${names}</span>`;
        } else {
            dropzone.innerHTML = '<span>Перетащите файлы или нажмите для выбора</span>';
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupDropzone('wbDropzone', 'wbPhotos');
    setupDropzone('ozonDropzone', 'ozonPhotos');
    setupDropzone('photoDropzone', 'productPhoto');
    setupDropzone('videoDropzone', 'videoPhoto');
});

// ----- Генерация карточки для Wildberries -----
window.generateWBCard = async function() {
    if (!currentUser || !userData) return;

    const productName = document.getElementById('wbProductName')?.value.trim();
    const brand = document.getElementById('wbBrand')?.value.trim();
    const category = document.getElementById('wbCategory')?.value;
    const features = document.getElementById('wbFeatures')?.value.split(',').map(f => f.trim()).filter(Boolean);
    const fileInput = document.getElementById('wbPhotos');
    
    if (!fileInput) {
        showNotification('Ошибка: элемент загрузки не найден', 'error');
        return;
    }
    
    const files = fileInput.files;
    
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
        console.error('Ошибка генерации:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Создать карточку для WB';
    }
};

// ----- Генерация карточки для Ozon -----
window.generateOzonCard = async function() {
    if (!currentUser || !userData) return;

    const productName = document.getElementById('ozonProductName')?.value.trim();
    const brand = document.getElementById('ozonBrand')?.value.trim();
    const category = document.getElementById('ozonCategory')?.value;
    const features = document.getElementById('ozonFeatures')?.value.split(',').map(f => f.trim()).filter(Boolean);
    const fileInput = document.getElementById('ozonPhotos');
    
    if (!fileInput) {
        showNotification('Ошибка: элемент загрузки не найден', 'error');
        return;
    }
    
    const files = fileInput.files;
    
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
        console.error('Ошибка генерации:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Создать карточку для Ozon';
    }
};

// ----- Генерация фото (заглушка) -----
window.generateProductPhoto = async function() {
    showNotification('Функция генерации фото находится в разработке', 'info');
};

// ----- Генерация видео (реальная) -----
window.generateVideo = async function() {
    if (!currentUser || !userData) return;

    const fileInput = document.getElementById('videoPhoto');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showNotification('Загрузите фото товара', 'error');
        return;
    }

    const videoType = document.getElementById('videoType')?.value || 'standard';
    const prompt = document.getElementById('videoPrompt')?.value || '';
    const resolution = document.getElementById('videoResolution')?.value || '512P';

    // Проверка баланса (видео = 5 токенов)
    const maxGen = { 'start': 30, 'business': 200, 'pro': 999999 }[userData.plan] || 30;
    if ((userData.usedGenerations || 0) + 5 > maxGen) {
        showNotification('Недостаточно токенов (требуется 5)', 'error');
        return;
    }

    const btn = document.querySelector('[onclick="generateVideo()"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Генерация видео... (2-5 минут)';

    try {
        const formData = new FormData();
        formData.append('videoPhoto', fileInput.files[0]);
        formData.append('videoType', videoType);
        formData.append('prompt', prompt);
        formData.append('resolution', resolution);

        const response = await fetch('/api/generate-video', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }

        const result = await response.json();
        
        // Отображаем видео в блоке результатов
        displayVideoResult(result);

        // Сохраняем в историю
        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'video',
            productName: document.getElementById('ozonProductName')?.value || 
                        document.getElementById('wbProductName')?.value || 'Видео',
            videoUrl: result.videoUrl,
            videoType: videoType,
            prompt: prompt,
            timestamp: new Date().toISOString()
        });

        // Списание токенов
        await updateDoc(doc(db, 'users', currentUser.uid), { usedGenerations: increment(5) });
        userData.usedGenerations += 5;
        updateUI();
        loadHistory();
        
        showNotification('Видео успешно сгенерировано!', 'success');

    } catch (error) {
        console.error('Video generation error:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '✨ Сгенерировать видео (5 токенов)';
    }
};

// Функция для отображения видео
function displayVideoResult(result) {
    const container = document.getElementById('cardResults');
    container.style.display = 'block';
    
    // Очищаем предыдущие результаты
    const gallery = document.getElementById('resultImages');
    const descList = document.getElementById('resultDescriptions');
    
    if (gallery) {
        gallery.innerHTML = '';
        // Для видео показываем placeholder с видео
        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-container';
        videoContainer.innerHTML = `
            <video controls style="width: 100%; max-width: 500px; border-radius: 12px;">
                <source src="${result.videoUrl}" type="video/mp4">
                Ваш браузер не поддерживает видео.
            </video>
            <p class="text-muted" style="margin-top: 10px;">Длительность: ${result.duration} сек</p>
        `;
        gallery.appendChild(videoContainer);
    }
    
    if (descList) {
        descList.innerHTML = `
            <div class="result-item" onclick="downloadVideo('${result.videoUrl}')">
                📥 Скачать видео
            </div>
            <div class="result-item" onclick="copyVideoUrl('${result.videoUrl}')">
                🔗 Копировать ссылку
            </div>
        `;
    }
}

// Вспомогательные функции
window.downloadVideo = function(url) {
    const link = document.createElement('a');
    link.href = url;
    link.download = `video-${Date.now()}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.copyVideoUrl = function(url) {
    navigator.clipboard.writeText(url);
    showNotification('Ссылка скопирована', 'success');
};

// Отображение результатов карточки
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
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
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
                const resultsSection = document.getElementById('cardResults');
                if (resultsSection) resultsSection.scrollIntoView({ behavior: 'smooth' });
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

// ----- Пополнение баланса и подписка -----
let currentPlan = null;
let currentPrice = 0;

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
    currentPrice = plans[plan].price;

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
    currentPrice = 0;
};

// ----- Уведомления -----
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// Закрытие модального окна по клику вне его
window.onclick = function(event) {
    const modal = document.getElementById('paymentModal');
    if (event.target === modal) closeModal();
};