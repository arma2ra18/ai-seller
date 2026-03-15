import { auth, db } from './firebase.js';
import {
    doc, getDoc, collection, addDoc, query, orderBy,
    getDocs, updateDoc, increment, limit, setDoc, deleteDoc,
    where, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { 
    onAuthStateChanged, 
    signOut,
    updateProfile, 
    updateEmail, 
    updatePassword, 
    deleteUser,
    reauthenticateWithCredential,
    EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let currentUser = null;
let userData = null;

// Переменные для модального окна загрузки
let generationInterval;
let generationStartTime;

// Переменные для пополнения (в рублях)
let selectedRubles = 0;

// Текущая сессия генерации (группа карточек)
let currentGenerationSession = {
    sessionId: null,           // ID сессии в Firestore
    productName: null,
    brand: null,
    category: null,
    price: null,
    features: [],
    platform: 'wb',            // wb или ozon
    originalImageId: null,     // ID исходного изображения в Storage
    attemptsMade: 0,
    maxAttempts: 5,
    generatedImages: [],       // Массив URL всех фото в этой сессии
    imageIds: []               // Массив ID изображений в Storage
};

// Для страницы истории (все сессии)
let allSessions = [];
let currentHistoryPage = 1;
const HISTORY_PER_PAGE = 10;

// Следим за состоянием авторизации
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;
    await loadUserData();
    
    // Получаем текущий путь страницы
    const path = window.location.pathname;
    console.log('Текущая страница:', path);
    
    // Загружаем историю ТОЛЬКО если есть элемент historyList на странице
    const historyList = document.getElementById('historyList');
    
    if (historyList) {
        if (path.includes('history.html')) {
            console.log('Загружаем всю историю...');
            await loadAllHistory();
        } else {
            console.log('Загружаем последние 10 записей...');
            await loadRecentHistory();
        }
    } else {
        console.log('На этой странице нет истории, пропускаем загрузку');
    }
});

// Загрузка данных пользователя из Firestore
async function loadUserData() {
    if (!currentUser) return;
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            userData = userDoc.data();
            updateUI();
            updateStats();
        } else {
            await setDoc(doc(db, 'users', currentUser.uid), {
                email: currentUser.email || '',
                displayName: currentUser.displayName || '',
                phoneNumber: currentUser.phoneNumber || '',
                balance: 500,
                usedSpent: 0,
                createdAt: new Date().toISOString()
            });
            await loadUserData();
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

// Обновление интерфейса
function updateUI() {
    if (!userData) return;
    
    const currentBalance = userData.balance || 0;

    const balanceSelectors = [
        '#remainingGenerations',
        '#remainingGenerationsDetail',
        '#sidebarBalance'
    ];
    
    balanceSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            if (el) el.textContent = currentBalance;
        });
    });

    const userEmailEl = document.getElementById('userEmail');
    if (userEmailEl) {
        userEmailEl.textContent = currentUser.email || currentUser.phoneNumber || 'Пользователь';
    }
}

// Обновление плиток статистики
function updateStats() {
    const statUser = document.getElementById('statUser');
    if (statUser) {
        if (currentUser.email) {
            statUser.textContent = currentUser.email.split('@')[0];
        } else if (currentUser.phoneNumber) {
            const phone = currentUser.phoneNumber;
            statUser.textContent = phone ? 'Пользователь ' + phone.slice(-4) : 'Пользователь';
        } else {
            statUser.textContent = 'Пользователь';
        }
    }
    
    const statCards = document.getElementById('statCards');
    if (statCards) statCards.textContent = userData?.usedSpent || 0;
    
    const statVideos = document.getElementById('statVideos');
    if (statVideos) statVideos.textContent = 0;
    
    const statDescriptions = document.getElementById('statDescriptions');
    if (statDescriptions) statDescriptions.textContent = 0;
    
    const statHistory = document.getElementById('statHistory');
    if (statHistory) statHistory.textContent = allSessions.length || 0;
    
    const statBalance = document.getElementById('statBalance');
    if (statBalance) statBalance.textContent = userData?.balance || 0;
    
    const statNews = document.getElementById('statNews');
    if (statNews) statNews.textContent = 5;
    
    const statBonus = document.getElementById('statBonus');
    if (statBonus) statBonus.textContent = 0;
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
        if (target) {
            target.classList.add('active');
            if (section === 'settings') {
                loadSettingsData();
            }
        }
    });
});

// ----- Обновление информации о выбранных файлах -----
window.updateFileInfo = function(inputId, infoId) {
    const input = document.getElementById(inputId);
    const info = document.getElementById(infoId);
    if (!input || !info) return;
    if (input.files.length === 0) {
        info.textContent = input.multiple ? 'Файлы не выбраны' : 'Файл не выбран';
    } else {
        const names = Array.from(input.files).map(f => f.name).join(', ');
        info.textContent = names.length > 50 ? names.substring(0, 50) + '…' : names;
    }
};

// ----- Сброс сессии генерации -----
function resetGenerationSession(platform = 'wb') {
    currentGenerationSession = {
        sessionId: null,
        productName: null,
        brand: null,
        category: null,
        price: null,
        features: [],
        platform: platform,
        originalImageId: null,
        attemptsMade: 0,
        maxAttempts: 5,
        generatedImages: [],
        imageIds: []
    };
}

// ----- Модальное окно загрузки -----
function showGenerationModal() {
    const modal = document.getElementById('generationModal');
    if (modal) {
        modal.classList.add('show');
        const progressFill = document.getElementById('generationProgress');
        if (progressFill) progressFill.style.width = '0%';
        const timerEl = document.getElementById('generationTimer');
        if (timerEl) timerEl.textContent = '0 сек.';
        generationStartTime = Date.now();
        
        // Очищаем предыдущий интервал, если есть
        if (generationInterval) {
            clearInterval(generationInterval);
            generationInterval = null;
        }
        
        // Запускаем новый
        generationInterval = setInterval(updateGenerationTimer, 1000);
    }
}

function hideGenerationModal() {
    const modal = document.getElementById('generationModal');
    if (modal) {
        modal.classList.remove('show');
        if (generationInterval) {
            clearInterval(generationInterval);
            generationInterval = null;
        }
    }
}

function updateGenerationTimer() {
    const elapsed = Math.floor((Date.now() - generationStartTime) / 1000);
    const timerEl = document.getElementById('generationTimer');
    if (timerEl) timerEl.textContent = `${elapsed} сек.`;
    const progressFill = document.getElementById('generationProgress');
    if (progressFill) {
        const max = 70;
        const percent = Math.min(100, (elapsed / max) * 100);
        progressFill.style.width = percent + '%';
    }
}

// ----- Обновление UI повторных генераций -----
function updateRegenerationUI() {
    const resultsContainer = document.getElementById('cardResults');
    if (!resultsContainer) return;

    let infoBlock = document.getElementById('regenerationInfo');
    if (!infoBlock) {
        infoBlock = document.createElement('div');
        infoBlock.id = 'regenerationInfo';
        infoBlock.className = 'regeneration-info glass';
        resultsContainer.insertBefore(infoBlock, resultsContainer.firstChild);
    }

    const remaining = currentGenerationSession.maxAttempts - currentGenerationSession.attemptsMade;
    const nextCost = 15;
    const platformName = currentGenerationSession.platform === 'wb' ? 'Wildberries' : 'Ozon';
    const platformColor = currentGenerationSession.platform === 'wb' ? '#8b5cf6' : '#009fe3';

    infoBlock.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
                <strong>${currentGenerationSession.productName}</strong> · 
                <span style="color: ${platformColor};">${platformName}</span> · 
                ${currentGenerationSession.attemptsMade}/${currentGenerationSession.maxAttempts} фото
            </div>
            <div>
                Следующая: ${nextCost} ₽ · осталось ${remaining}
            </div>
        </div>
    `;

    let regenBtn = document.getElementById('regenerateBtn');
    if (!regenBtn) {
        regenBtn = document.createElement('button');
        regenBtn.id = 'regenerateBtn';
        regenBtn.className = 'btn btn-primary';
        regenBtn.style.marginTop = '15px';
        regenBtn.onclick = window.regeneratePhoto;
        resultsContainer.appendChild(regenBtn);
    }

    if (remaining > 0) {
        regenBtn.style.display = 'inline-block';
        regenBtn.innerHTML = `🔄 Сделать ещё (${nextCost} ₽)`;
        regenBtn.disabled = false;
    } else {
        regenBtn.style.display = 'none';
    }
}
// Управляем состоянием основной синей кнопки
const mainBtn = document.getElementById(currentGenerationSession.platform === 'wb' ? 'generateWBBtn' : 'generateOzonBtn');
if (mainBtn) {
    if (currentGenerationSession.attemptsMade >= currentGenerationSession.maxAttempts) {
        // Достигнут лимит — кнопка должна создавать НОВУЮ сессию за 100 ₽
        mainBtn.innerHTML = `✨ Создать первое фото для ${currentGenerationSession.platform === 'wb' ? 'Wildberries' : 'Ozon'} (100 ₽)`;
        mainBtn.disabled = false;
        mainBtn.onclick = currentGenerationSession.platform === 'wb' ? window.generateWBCard : window.generateOzonCard;
    } else {
        // Ещё есть попытки — кнопка для повторной генерации за 15 ₽
        mainBtn.innerHTML = `🔄 Сделать ещё (15 ₽)`;
        mainBtn.disabled = false;
        mainBtn.onclick = window.regeneratePhoto;
    }
}

// ----- Генерация карточки для Wildberries -----
window.generateWBCard = async function() {
    await generateCard('wb');
};

// ----- Генерация карточки для Ozon -----
window.generateOzonCard = async function() {
    await generateCard('ozon');
};

// ----- Общая функция генерации -----
async function generateCard(platform) {
    if (!currentUser || !userData) return;

    const inputId = platform === 'wb' ? 'wbPhotos' : 'ozonPhotos';
    const nameId = platform === 'wb' ? 'wbProductName' : 'ozonProductName';
    const brandId = platform === 'wb' ? 'wbBrand' : 'ozonBrand';
    const categoryId = platform === 'wb' ? 'wbCategory' : 'ozonCategory';
    const priceId = platform === 'wb' ? 'wbPrice' : 'ozonPrice';
    const featuresId = platform === 'wb' ? 'wbFeatures' : 'ozonFeatures';
    const btnId = platform === 'wb' ? 'generateWBBtn' : 'generateOzonBtn';

    const fileInput = document.getElementById(inputId);
    
    const productName = document.getElementById(nameId)?.value.trim();
    const brand = document.getElementById(brandId)?.value.trim();
    const category = document.getElementById(categoryId)?.value;
    const price = document.getElementById(priceId)?.value.trim() || '1990';
    const featuresInput = document.getElementById(featuresId)?.value;
    const features = featuresInput ? featuresInput.split(',').map(f => f.trim()).filter(Boolean) : [];
    
    // Проверяем только название товара
    if (!productName) {
        showNotification('Введите название товара', 'error');
        return;
    }

    // Проверяем баланс
    const currentBalance = userData.balance || 0;
    if (currentBalance < 100) {
        showNotification('Недостаточно средств. Требуется 100 ₽', 'error');
        return;
    }

    // Фото не обязательно! Просто передаем что есть (или пустой массив)
    let files = [];
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        files = fileInput.files;
        console.log(`📸 Загружено ${files.length} фото`);
    } else {
        console.log('📝 Фото не загружено, будет генерация по описанию');
    }

    resetGenerationSession(platform);
    currentGenerationSession.productName = productName;
    currentGenerationSession.brand = brand;
    currentGenerationSession.category = category;
    currentGenerationSession.price = price;
    currentGenerationSession.features = features;
    currentGenerationSession.platform = platform;

    await performGeneration(files, 0, platform, btnId);
}

// ----- Повторная генерация -----
window.regeneratePhoto = async function() {
    if (!currentUser || !userData) return;
    
    console.log('🔄 Проверка originalImageId:', currentGenerationSession.originalImageId);
    
    if (!currentGenerationSession.originalImageId) {
        showNotification('Ошибка: нет исходного изображения для повторной генерации', 'error');
        return;
    }

    const nextAttempt = currentGenerationSession.attemptsMade;
    if (nextAttempt >= currentGenerationSession.maxAttempts) {
        showNotification('Достигнут лимит повторных генераций (максимум 5 фото)', 'warning');
        return;
    }

    const cost = 15;
    const currentBalance = userData.balance || 0;
    if (currentBalance < cost) {
        showNotification(`Недостаточно средств. Требуется ${cost} ₽`, 'error');
        return;
    }

    const platform = currentGenerationSession.platform;
    const btnId = platform === 'wb' ? 'generateWBBtn' : 'generateOzonBtn';
    
    await performGeneration(null, nextAttempt, platform, btnId);
};

// ----- Уведомления -----
function showNotification(message, type = 'info') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ----- ОСНОВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ (ЕДИНСТВЕННАЯ) -----
async function performGeneration(files, attempt, platform, btnId) {
    const cost = attempt === 0 ? 100 : 15;
    const btn = document.getElementById(btnId);

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loading"></span> Генерация...';
    }

    showGenerationModal();

    try {
        const formData = new FormData();
        
        // Для повторной генерации (attempt > 0) - файлы не нужны, используем originalImageId
        if (attempt === 0 && files && files.length > 0) {
            // Первая генерация с фото
            for (let i = 0; i < files.length; i++) formData.append('photos', files[i]);
            console.log(`📸 Первая генерация с ${files.length} фото`);
        } else if (attempt === 0) {
            // Первая генерация без фото
            console.log('📝 Первая генерация без фото (по описанию)');
            // Не добавляем фото, API сам поймет
        } else {
            // Повторная генерация - фото не нужно, используем originalImageId
            console.log('🔄 Повторная генерация, используем оригинал:', currentGenerationSession.originalImageId);
            // Не добавляем фото, только originalImageId
        }
        
        formData.append('productName', currentGenerationSession.productName);
        formData.append('brand', currentGenerationSession.brand || '');
        formData.append('category', currentGenerationSession.category || '');
        formData.append('price', currentGenerationSession.price || '1990');
        const color = document.getElementById('wbColor')?.value || '';
        formData.append('color', color);
        formData.append('features', currentGenerationSession.features.join(','));
        formData.append('platform', platform);
        formData.append('attempt', attempt);
        
        // ВАЖНО: всегда передаем originalImageId, если он есть
        if (currentGenerationSession.originalImageId) {
            formData.append('originalImageId', currentGenerationSession.originalImageId);
            console.log('🆔 Передаем originalImageId:', currentGenerationSession.originalImageId);
        }

        const response = await fetch('/api/generate-card', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }
        
        const result = await response.json();
        console.log('✅ Ответ от API:', result);

        // Сохраняем originalImageId если пришел (для первой генерации без фото это важно!)
        if (result.originalImageId) {
            currentGenerationSession.originalImageId = result.originalImageId;
            console.log('💾 Сохранен originalImageId:', result.originalImageId);
        }

        if (result.images && result.images.length) {
            currentGenerationSession.generatedImages.push(result.images[0]);
            currentGenerationSession.imageIds.push(`generated/${result.images[0].split('/').pop()}`);
        }
        
        const newAttemptCount = attempt + 1;
        currentGenerationSession.attemptsMade = newAttemptCount;

        // Сохраняем в Firestore
        if (currentGenerationSession.sessionId) {
            // Обновляем существующую сессию
            const sessionRef = doc(db, 'users', currentUser.uid, 'generationSessions', currentGenerationSession.sessionId);
            await updateDoc(sessionRef, {
                attempts: newAttemptCount,
                totalSpent: increment(cost),
                images: currentGenerationSession.generatedImages,
                imageIds: currentGenerationSession.imageIds,
                // ВАЖНО: сохраняем originalImageId при обновлении
                originalImageId: currentGenerationSession.originalImageId,
                updatedAt: new Date().toISOString()
            });
            console.log('✅ Сессия обновлена:', currentGenerationSession.sessionId);
        } else {
            // Создаём новую сессию
            const sessionData = {
                type: 'product-session',
                productName: currentGenerationSession.productName,
                brand: currentGenerationSession.brand,
                category: currentGenerationSession.category,
                price: currentGenerationSession.price,
                features: currentGenerationSession.features,
                platform: platform,
                attempts: 1,
                totalSpent: cost,
                images: [result.images[0]],
                imageIds: [`generated/${result.images[0].split('/').pop()}`],
                // ВАЖНО: сохраняем originalImageId в новую сессию
                originalImageId: currentGenerationSession.originalImageId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            const sessionRef = await addDoc(collection(db, 'users', currentUser.uid, 'generationSessions'), sessionData);
            currentGenerationSession.sessionId = sessionRef.id;
            console.log('✅ Новая сессия создана:', sessionRef.id);
        }

        // Списываем средства
        await updateDoc(doc(db, 'users', currentUser.uid), { 
            balance: increment(-cost),
            usedSpent: increment(cost)
        });

        const updatedDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (updatedDoc.exists()) {
            userData = updatedDoc.data();
        }
        updateUI();
        
        // Обновляем историю
        const path = window.location.pathname;
        if (path.includes('history.html')) {
            await loadAllHistory();
        } else if (!path.includes('news.html')) {
            await loadRecentHistory();
        }
        
        displayCardResults(result, attempt, platform);
        
        const platformName = platform === 'wb' ? 'Wildberries' : 'Ozon';
        const message = attempt === 0 
            ? `✅ Первое фото для ${platformName} готово! Можете сгенерировать ещё за 15 ₽` 
            : `✅ Фото №${attempt + 1} для ${platformName} готово! Списано ${cost} ₽`;
        showNotification(message, 'success');

    } catch (error) {
        console.error('❌ Ошибка генерации:', error);
        
        let errorMessage = 'Неизвестная ошибка';
        try {
            if (error.message) {
                const parsed = JSON.parse(error.message);
                errorMessage = parsed.error || parsed.message || error.message;
            } else {
                errorMessage = error.message || 'Ошибка соединения';
            }
        } catch {
            errorMessage = error.message || 'Ошибка соединения';
        }
        
        if (errorMessage.includes('API key')) {
            showNotification('❌ Ошибка API ключа', 'error');
        } else if (errorMessage.includes('model')) {
            showNotification('❌ Ошибка модели Gemini', 'error');
        } else if (errorMessage.includes('balance')) {
            showNotification('❌ Недостаточно средств', 'error');
        } else if (errorMessage.includes('500')) {
            showNotification('❌ Ошибка сервера. Попробуйте позже.', 'error');
        } else if (errorMessage.includes('Failed to fetch')) {
            showNotification('❌ Ошибка соединения. Проверьте интернет.', 'error');
        } else {
            showNotification('❌ ' + errorMessage.substring(0, 100), 'error');
        }
    } finally {
        hideGenerationModal();
        if (btn) {
            btn.disabled = false;
            const platformName = platform === 'wb' ? 'Wildberries' : 'Ozon';
            btn.innerHTML = attempt === 0 
                ? `✨ Создать первое фото для ${platformName} (100 ₽)` 
                : '🔄 Сделать ещё (15 ₽)';
        }
        updateRegenerationUI();
    }
}

// ----- Отображение результатов (с сохранением всех фото) -----
function displayCardResults(result, attempt, platform) {
    const container = document.getElementById('cardResults');
    if (!container) return;
    container.style.display = 'block';

    let gallery = document.getElementById('resultImages');
    if (!gallery) {
        gallery = document.createElement('div');
        gallery.id = 'resultImages';
        gallery.className = 'image-gallery';
        container.appendChild(gallery);
    }

    if (result.images && result.images.length) {
        // Используем currentGenerationSession для отображения всех фото сессии
        const allImages = currentGenerationSession.generatedImages || [];
        
        // Очищаем и показываем все
        gallery.innerHTML = '';
        allImages.forEach((url, index) => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = `Фото ${index + 1}`;
            img.onclick = () => window.openLightbox(url);
            gallery.appendChild(img);
        });
    }

    updateRegenerationUI();
}

// ----- Загрузка последних 10 сессий для дашборда -----
async function loadRecentHistory() {
    if (!currentUser) return;
    try {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        let sessionsSnapshot;
        try {
            const sessionsQuery = query(
                collection(db, 'users', currentUser.uid, 'generationSessions'), 
                orderBy('createdAt', 'desc'), 
                limit(10)
            );
            sessionsSnapshot = await getDocs(sessionsQuery);
        } catch (e) {
            console.warn('Коллекция generationSessions не найдена, используем старую историю');
            const oldQuery = query(collection(db, 'users', currentUser.uid, 'generations'), orderBy('timestamp', 'desc'), limit(10));
            const oldSnapshot = await getDocs(oldQuery);
            
            if (oldSnapshot.empty) {
                historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
                return;
            }
            
            const groupedByProduct = {};
            oldSnapshot.forEach(doc => {
                const item = doc.data();
                const key = item.productName || 'Без названия';
                if (!groupedByProduct[key]) {
                    groupedByProduct[key] = {
                        id: doc.id,
                        productName: item.productName,
                        attempts: 1,
                        images: item.result?.images || [],
                        timestamp: item.timestamp,
                        platform: item.platform || 'wb'
                    };
                } else {
                    groupedByProduct[key].attempts++;
                    if (item.result?.images) {
                        groupedByProduct[key].images.push(...item.result.images);
                    }
                }
            });
            
            displayHistory(Object.values(groupedByProduct), true);
            return;
        }

        if (sessionsSnapshot.empty) {
            historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
            return;
        }

        const sessions = [];
        sessionsSnapshot.forEach(doc => {
            sessions.push({ id: doc.id, ...doc.data() });
        });
        
        displayHistory(sessions, true);

    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
    }
}

// ----- Загрузка ВСЕХ сессий для страницы истории -----
async function loadAllHistory() {
    if (!currentUser) return;
    try {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        let sessionsSnapshot;
        try {
            const sessionsQuery = query(
                collection(db, 'users', currentUser.uid, 'generationSessions'), 
                orderBy('createdAt', 'desc')
            );
            sessionsSnapshot = await getDocs(sessionsQuery);
        } catch (e) {
            console.warn('Коллекция generationSessions не найдена, используем старую историю');
            const oldQuery = query(collection(db, 'users', currentUser.uid, 'generations'), orderBy('timestamp', 'desc'));
            const oldSnapshot = await getDocs(oldQuery);
            
            if (oldSnapshot.empty) {
                historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
                return;
            }
            
            const groupedByProduct = {};
            oldSnapshot.forEach(doc => {
                const item = doc.data();
                const key = item.productName || 'Без названия';
                if (!groupedByProduct[key]) {
                    groupedByProduct[key] = {
                        id: doc.id,
                        productName: item.productName,
                        attempts: 1,
                        images: item.result?.images || [],
                        timestamp: item.timestamp,
                        platform: item.platform || 'wb',
                        oldFormat: true
                    };
                } else {
                    groupedByProduct[key].attempts++;
                    if (item.result?.images) {
                        groupedByProduct[key].images.push(...item.result.images);
                    }
                }
            });
            
            allSessions = Object.values(groupedByProduct);
            displayAllHistory();
            return;
        }

        if (sessionsSnapshot.empty) {
            historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
            return;
        }

        allSessions = [];
        sessionsSnapshot.forEach(doc => {
            allSessions.push({ id: doc.id, ...doc.data() });
        });
        
        displayAllHistory();

    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
    }
}

// ----- Отображение истории с пагинацией (для страницы истории) -----
function displayAllHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (allSessions.length === 0) {
        historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
        return;
    }

    // Пагинация
    const start = (currentHistoryPage - 1) * HISTORY_PER_PAGE;
    const paginatedSessions = allSessions.slice(start, start + HISTORY_PER_PAGE);

    historyList.innerHTML = '';
    
    paginatedSessions.forEach(session => {
        const date = new Date(session.createdAt || session.timestamp).toLocaleString('ru-RU', { 
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const images = session.images || [];
        const previewImages = images.slice(0, 3).map((url, idx) => 
            `<img src="${url}" class="history-thumb" onclick="event.stopPropagation(); viewHistorySession('${session.id}')" title="Фото ${idx + 1}">`
        ).join('');
        
        const moreBadge = images.length > 3 ? `<span class="more-badge">+${images.length - 3}</span>` : '';
        const platform = session.platform || 'wb';
        const platformColor = platform === 'wb' ? '#8b5cf6' : '#009fe3';
        const platformName = platform === 'wb' ? 'WB' : 'Ozon';

        historyList.innerHTML += `
            <div class="history-item" onclick="viewHistorySession('${session.id}')">
                <div class="history-item-header">
                    <div>
                        <strong>${session.productName || 'Без названия'}</strong>
                        <span class="history-type" style="color: ${platformColor};">${platformName}</span>
                        <span class="history-type">${session.attempts || 1} фото</span>
                        <div class="history-date">${date}</div>
                    </div>
                    <div class="history-actions">
                        <span class="history-cost">${session.totalSpent || session.attempts * 100} ₽</span>
                        <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); deleteHistorySession('${session.id}')" title="Удалить">🗑️</button>
                    </div>
                </div>
                <div class="history-thumbnails">
                    ${previewImages}
                    ${moreBadge}
                </div>
            </div>
        `;
    });

    // Добавляем пагинацию
    updateHistoryPagination();
}

// ----- Отображение последних 10 (для дашборда) -----
function displayHistory(sessions, isRecent = true) {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (sessions.length === 0) {
        historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
        return;
    }

    historyList.innerHTML = '';
    
    sessions.forEach(session => {
        const date = new Date(session.createdAt || session.timestamp).toLocaleString('ru-RU', { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        
        const images = session.images || [];
        const previewImages = images.slice(0, 3).map((url, idx) => 
            `<img src="${url}" class="history-thumb" onclick="event.stopPropagation(); viewHistorySession('${session.id}')" title="Фото ${idx + 1}">`
        ).join('');
        
        const moreBadge = images.length > 3 ? `<span class="more-badge">+${images.length - 3}</span>` : '';
        const platform = session.platform || 'wb';
        const platformColor = platform === 'wb' ? '#8b5cf6' : '#009fe3';
        const platformName = platform === 'wb' ? 'WB' : 'Ozon';

        historyList.innerHTML += `
            <div class="history-item" onclick="viewHistorySession('${session.id}')">
                <div class="history-item-header">
                    <div>
                        <strong>${session.productName || 'Без названия'}</strong>
                        <span class="history-type" style="color: ${platformColor};">${platformName}</span>
                        <span class="history-type">${session.attempts || 1} фото</span>
                        <div class="history-date">${date}</div>
                    </div>
                    <div class="history-actions">
                        <span class="history-cost">${session.totalSpent || session.attempts * 100} ₽</span>
                    </div>
                </div>
                <div class="history-thumbnails">
                    ${previewImages}
                    ${moreBadge}
                </div>
            </div>
        `;
    });
}

// ----- Пагинация для истории -----
function updateHistoryPagination() {
    const paginationDiv = document.getElementById('historyPagination');
    if (!paginationDiv) return;

    const totalPages = Math.ceil(allSessions.length / HISTORY_PER_PAGE);
    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }

    let paginationHtml = '';
    for (let i = 1; i <= totalPages; i++) {
        paginationHtml += `<button onclick="goToHistoryPage(${i})" class="${i === currentHistoryPage ? 'active' : ''}">${i}</button>`;
    }
    
    paginationDiv.innerHTML = paginationHtml;
}

// ----- Переход на страницу истории -----
window.goToHistoryPage = function(page) {
    currentHistoryPage = page;
    displayAllHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ----- Удаление сессии из истории -----
window.deleteHistorySession = async function(sessionId) {
    if (!currentUser) return;
    
    if (!confirm('Вы уверены, что хотите удалить эту сессию генерации? Это действие необратимо.')) {
        return;
    }
    
    try {
        // Удаляем документ сессии
        await deleteDoc(doc(db, 'users', currentUser.uid, 'generationSessions', sessionId));
        
        // Обновляем списки
        allSessions = allSessions.filter(s => s.id !== sessionId);
        
        // Перенаправляем на первую страницу, если текущая страница стала пустой
        if (allSessions.length > 0) {
            const start = (currentHistoryPage - 1) * HISTORY_PER_PAGE;
            if (start >= allSessions.length) {
                currentHistoryPage = Math.max(1, Math.ceil(allSessions.length / HISTORY_PER_PAGE));
            }
        } else {
            currentHistoryPage = 1;
        }
        
        // Обновляем отображение
        const path = window.location.pathname;
        if (path.includes('history.html')) {
            displayAllHistory();
        } else {
            await loadRecentHistory();
        }
        
        showNotification('Сессия удалена', 'success');
        
    } catch (error) {
        console.error('Ошибка удаления сессии:', error);
        showNotification('Ошибка при удалении: ' + error.message, 'error');
    }
};

// ----- Просмотр сессии из истории -----
window.viewHistorySession = async function(sessionId) {
    if (!currentUser) return;
    try {
        const sessionDoc = await getDoc(doc(db, 'users', currentUser.uid, 'generationSessions', sessionId));
        if (sessionDoc.exists()) {
            const session = sessionDoc.data();
            
            currentGenerationSession = {
                sessionId: sessionId,
                productName: session.productName,
                brand: session.brand,
                category: session.category,
                price: session.price,
                features: session.features || [],
                platform: session.platform || 'wb',
                originalImageId: session.originalImageId || null,
                attemptsMade: session.attempts,
                maxAttempts: 5,
                generatedImages: session.images || []
            };
            
            const container = document.getElementById('cardResults');
            container.style.display = 'block';
            
            let gallery = document.getElementById('resultImages');
            if (!gallery) {
                gallery = document.createElement('div');
                gallery.id = 'resultImages';
                gallery.className = 'image-gallery';
                container.appendChild(gallery);
            }
            
            gallery.innerHTML = '';
            session.images.forEach((url, index) => {
                const img = document.createElement('img');
                img.src = url;
                img.alt = `Фото товара`;
                img.onclick = () => window.openLightbox(url);
                gallery.appendChild(img);
            });
            
            updateRegenerationUI();
            
            const regenBtn = document.getElementById('regenerateBtn');
            if (regenBtn) regenBtn.style.display = 'none';
            
            document.getElementById('cardResults').scrollIntoView({ behavior: 'smooth' });
        } else {
            showNotification('Сессия не найдена', 'error');
        }
    } catch (error) {
        console.error('Ошибка загрузки сессии:', error);
        showNotification('Ошибка загрузки', 'error');
    }
};

// ----- Лайтбокс -----
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

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.closeLightbox();
    }
});

// ----- ПОПОЛНЕНИЕ БАЛАНСА -----
window.showPaymentModal = function() {
    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.classList.add('show');
        selectedRubles = 0;
        document.getElementById('selectedPackageName').textContent = '—';
        document.getElementById('modalAmount').textContent = '0 ₽';
        const customInput = document.getElementById('customRubles');
        if (customInput) {
            customInput.value = 500;
            calculatePrice();
        }
    }
};

window.calculatePrice = function() {
    const rubles = parseInt(document.getElementById('customRubles').value) || 0;
    document.getElementById('selectedPackageName').textContent = `${rubles} ₽`;
    document.getElementById('modalAmount').textContent = `${rubles} ₽`;
    selectedRubles = rubles;
};

window.confirmPayment = function() {
    if (selectedRubles <= 0) {
        showNotification('Введите сумму пополнения', 'warning');
        return;
    }

    (async () => {
        try {
            const newBalance = (userData.balance || 0) + selectedRubles;
            await updateDoc(doc(db, 'users', currentUser.uid), {
                balance: newBalance,
            });
            
            userData.balance = newBalance;
            updateUI();
            
            showNotification(`Баланс пополнен на ${selectedRubles} ₽!`, 'success');
            closeModal();
        } catch (error) {
            console.error('Ошибка при пополнении:', error);
            showNotification('Ошибка при пополнении', 'error');
        }
    })();
};

window.closeModal = function() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.classList.remove('show');
    selectedRubles = 0;
};

// ========== НАСТРОЙКИ ПРОФИЛЯ ==========
function loadSettingsData() {
    if (!currentUser || !userData) return;
    
    const displayNameInput = document.getElementById('displayName');
    if (displayNameInput) {
        displayNameInput.value = currentUser.displayName || '';
    }
    
    const emailInput = document.getElementById('userEmailSettings');
    if (emailInput) {
        emailInput.value = currentUser.email || '';
    }
    
    const phoneInput = document.getElementById('phoneNumber');
    if (phoneInput) {
        phoneInput.value = currentUser.phoneNumber || '';
    }
    
    const createdEl = document.getElementById('accountCreated');
    if (createdEl && userData.createdAt) {
        const date = new Date(userData.createdAt);
        createdEl.textContent = date.toLocaleDateString('ru-RU');
    }
    
    const totalGenEl = document.getElementById('totalGenerations');
    if (totalGenEl) {
        totalGenEl.textContent = (userData.usedSpent || 0) + ' ₽';
    }
    
    if (currentUser.metadata && currentUser.metadata.lastSignInTime) {
        const lastLoginEl = document.getElementById('lastLogin');
        if (lastLoginEl) {
            const date = new Date(currentUser.metadata.lastSignInTime);
            lastLoginEl.textContent = date.toLocaleString('ru-RU');
        }
    }
}

window.updateDisplayName = async function() {
    const newName = document.getElementById('displayName').value.trim();
    if (!newName) {
        showNotification('Введите имя', 'warning');
        return;
    }
    
    try {
        await updateProfile(auth.currentUser, { displayName: newName });
        await updateDoc(doc(db, 'users', currentUser.uid), {
            displayName: newName
        });
        
        currentUser.displayName = newName;
        userData.displayName = newName;
        
        showNotification('Имя обновлено!', 'success');
    } catch (error) {
        console.error('Error updating name:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

window.changeEmail = function() {
    const modal = document.getElementById('emailModal');
    if (modal) modal.classList.add('show');
};

window.closeEmailModal = function() {
    const modal = document.getElementById('emailModal');
    if (modal) {
        modal.classList.remove('show');
        document.getElementById('newEmail').value = '';
        document.getElementById('emailConfirmPassword').value = '';
    }
};

window.confirmEmailChange = async function() {
    const newEmail = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('emailConfirmPassword').value;
    
    if (!newEmail || !password) {
        showNotification('Заполните все поля', 'warning');
        return;
    }
    
    try {
        const credential = EmailAuthProvider.credential(currentUser.email, password);
        await reauthenticateWithCredential(currentUser, credential);
        await updateEmail(currentUser, newEmail);
        await updateDoc(doc(db, 'users', currentUser.uid), {
            email: newEmail
        });
        
        showNotification('Email успешно изменён!', 'success');
        closeEmailModal();
        document.getElementById('userEmailSettings').value = newEmail;
    } catch (error) {
        console.error('Error changing email:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

window.updatePhoneNumber = async function() {
    const newPhone = document.getElementById('phoneNumber').value.trim();
    if (!newPhone) {
        showNotification('Введите номер телефона', 'warning');
        return;
    }
    
    try {
        await updateDoc(doc(db, 'users', currentUser.uid), {
            phoneNumber: newPhone
        });
        
        try {
            await updateProfile(auth.currentUser, { phoneNumber: newPhone });
        } catch (e) {
            console.log('Phone update in Auth failed, saved only in Firestore');
        }
        
        userData.phoneNumber = newPhone;
        showNotification('Номер телефона обновлён!', 'success');
    } catch (error) {
        console.error('Error updating phone:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

window.changePassword = async function() {
    const newPassword = document.getElementById('newPassword').value;
    
    if (!newPassword) {
        showNotification('Введите новый пароль', 'warning');
        return;
    }
    
    if (newPassword.length < 6) {
        showNotification('Пароль должен быть не менее 6 символов', 'warning');
        return;
    }
    
    try {
        await updatePassword(currentUser, newPassword);
        showNotification('Пароль успешно изменён!', 'success');
        document.getElementById('newPassword').value = '';
    } catch (error) {
        console.error('Error changing password:', error);
        if (error.code === 'auth/requires-recent-login') {
            showNotification('Требуется повторный вход. Выйдите и зайдите снова.', 'error');
        } else {
            showNotification('Ошибка: ' + error.message, 'error');
        }
    }
};

window.deleteAccount = async function() {
    if (!confirm('Вы уверены, что хотите удалить аккаунт? Это действие необратимо.')) {
        return;
    }
    
    try {
        await deleteDoc(doc(db, 'users', currentUser.uid));
        await deleteUser(currentUser);
        showNotification('Аккаунт удалён. Перенаправление...', 'info');
        setTimeout(() => window.location.href = '/', 2000);
    } catch (error) {
        console.error('Error deleting account:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

document.addEventListener('DOMContentLoaded', function() {
    const wbFeatures = document.getElementById('wbFeatures');
    if (wbFeatures) wbFeatures.value = '';
});

window.onclick = function(event) {
    const paymentModal = document.getElementById('paymentModal');
    if (event.target === paymentModal) closeModal();
    
    const emailModal = document.getElementById('emailModal');
    if (event.target === emailModal) closeEmailModal();
    
    const generationModal = document.getElementById('generationModal');
    if (event.target === generationModal) hideGenerationModal();
};