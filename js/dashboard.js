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
    originalImageId: null,
    attemptsMade: 0,
    maxAttempts: 5,
    generatedImages: [],       // Массив URL всех фото в этой сессии
    imageIds: []               // Массив ID изображений в Storage
};

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
    if (statHistory) statHistory.textContent = 0;
    
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
function resetGenerationSession() {
    currentGenerationSession = {
        sessionId: null,
        productName: null,
        brand: null,
        category: null,
        price: null,
        features: [],
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
        if (generationInterval) clearInterval(generationInterval);
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

    infoBlock.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
                <strong>${currentGenerationSession.productName}</strong> · 
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

// ----- Генерация карточки товара -----
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
    const featuresInput = document.getElementById('wbFeatures')?.value;
    const features = featuresInput ? featuresInput.split(',').map(f => f.trim()).filter(Boolean) : [];
    const files = fileInput.files;
    
    if (!productName) {
        showNotification('Введите название товара', 'error');
        return;
    }
    if (files.length === 0) {
        showNotification('Выберите хотя бы одно фото', 'error');
        return;
    }

    if (featuresInput && featuresInput.includes('@')) {
        document.getElementById('wbFeatures').value = '';
        showNotification('Пожалуйста, введите характеристики товара, а не email', 'warning');
        return;
    }

    const currentBalance = userData.balance || 0;
    if (currentBalance < 100) {
        showNotification('Недостаточно средств. Требуется 100 ₽', 'error');
        return;
    }

    resetGenerationSession();
    currentGenerationSession.productName = productName;
    currentGenerationSession.brand = brand;
    currentGenerationSession.category = category;
    currentGenerationSession.price = price;
    currentGenerationSession.features = features;

    await performGeneration(files, 0);
};

// ----- Повторная генерация -----
window.regeneratePhoto = async function() {
    if (!currentUser || !userData) return;
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

    await performGeneration(null, nextAttempt);
};

// ----- Общая функция генерации -----
async function performGeneration(files, attempt) {
    const cost = attempt === 0 ? 100 : 15;
    const btn = document.getElementById('generateWBBtn');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="loading"></span> Генерация...';
    }

    showGenerationModal();

    try {
        const formData = new FormData();
        if (files) {
            for (let i = 0; i < files.length; i++) formData.append('photos', files[i]);
        }
        formData.append('productName', currentGenerationSession.productName);
        formData.append('brand', currentGenerationSession.brand || '');
        formData.append('category', currentGenerationSession.category || '');
        formData.append('price', currentGenerationSession.price || '1990');
        formData.append('features', currentGenerationSession.features.join(','));
        formData.append('platform', 'wb');
        formData.append('attempt', attempt);
        if (currentGenerationSession.originalImageId) {
            formData.append('originalImageId', currentGenerationSession.originalImageId);
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

        if (result.originalImageId) {
            currentGenerationSession.originalImageId = result.originalImageId;
        }

        if (result.images && result.images.length) {
            currentGenerationSession.generatedImages.push(result.images[0]);
            currentGenerationSession.imageIds.push(`generated/${result.images[0].split('/').pop()}`);
        }
        
        const newAttemptCount = attempt + 1;
        currentGenerationSession.attemptsMade = newAttemptCount;

        if (attempt === 0) {
            const sessionData = {
                type: 'product-session',
                productName: currentGenerationSession.productName,
                brand: currentGenerationSession.brand,
                category: currentGenerationSession.category,
                price: currentGenerationSession.price,
                features: currentGenerationSession.features,
                attempts: 1,
                totalSpent: cost,
                images: [result.images[0]],
                imageIds: [`generated/${result.images[0].split('/').pop()}`],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            const sessionRef = await addDoc(collection(db, 'users', currentUser.uid, 'generationSessions'), sessionData);
            currentGenerationSession.sessionId = sessionRef.id;
        } 
        else if (currentGenerationSession.sessionId) {
            const sessionRef = doc(db, 'users', currentUser.uid, 'generationSessions', currentGenerationSession.sessionId);
            await updateDoc(sessionRef, {
                attempts: newAttemptCount,
                totalSpent: increment(cost),
                images: currentGenerationSession.generatedImages,
                imageIds: currentGenerationSession.imageIds,
                updatedAt: new Date().toISOString()
            });
        }

        await updateDoc(doc(db, 'users', currentUser.uid), { 
            balance: increment(-cost),
            usedSpent: increment(cost)
        });

        const updatedDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (updatedDoc.exists()) {
            userData = updatedDoc.data();
        }
        updateUI();
        loadHistory();
        
        displayCardResults(result, attempt);
        
        const message = attempt === 0 
            ? '✅ Первое фото готово! Можете сгенерировать ещё за 15 ₽' 
            : `✅ Фото №${attempt + 1} готово! Списано ${cost} ₽`;
        showNotification(message, 'success');

    } catch (error) {
        console.error('Ошибка генерации:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        hideGenerationModal();
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = attempt === 0 
                ? '✨ Создать первое фото (100 ₽)' 
                : '🔄 Сделать ещё (15 ₽)';
        }
        updateRegenerationUI();
    }
}

// ----- ИСПРАВЛЕННАЯ функция отображения результатов -----
function displayCardResults(result, attempt) {
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
        result.images.forEach(url => {
            const existingImages = Array.from(gallery.children).map(img => img.src);
            if (!existingImages.includes(url)) {
                const img = document.createElement('img');
                img.src = url;
                img.alt = `Фото товара`;
                img.onclick = () => window.openLightbox(url);
                gallery.appendChild(img);
            }
        });
    }

    const descList = document.getElementById('resultDescriptions');
    if (descList) {
        descList.remove();
    }

    const unwantedSelectors = [
        '.photo-caption',
        '.result-item',
        '.description-list'
    ];
    
    unwantedSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
    });

    updateRegenerationUI();
}

// ----- Загрузка сгруппированной истории -----
async function loadHistory() {
    if (!currentUser) return;
    try {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        let sessionsSnapshot;
        try {
            const sessionsQuery = query(
                collection(db, 'users', currentUser.uid, 'generationSessions'), 
                orderBy('createdAt', 'desc'), 
                limit(20)
            );
            sessionsSnapshot = await getDocs(sessionsQuery);
        } catch (e) {
            console.warn('Коллекция generationSessions не найдена, используем старую историю');
            const oldQuery = query(collection(db, 'users', currentUser.uid, 'generations'), orderBy('timestamp', 'desc'), limit(20));
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
                        productName: item.productName,
                        attempts: 1,
                        images: item.result?.images || [],
                        timestamp: item.timestamp
                    };
                } else {
                    groupedByProduct[key].attempts++;
                    if (item.result?.images) {
                        groupedByProduct[key].images.push(...item.result.images);
                    }
                }
            });
            
            displayGroupedHistory(Object.values(groupedByProduct));
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
        
        displayGroupedHistory(sessions);

    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
    }
}

// ----- Отображение сгруппированной истории -----
function displayGroupedHistory(sessions) {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';

    sessions.forEach(session => {
        const date = new Date(session.createdAt || session.timestamp).toLocaleString('ru-RU', { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        
        const images = session.images || [];
        const previewImages = images.slice(0, 3).map(url => 
            `<img src="${url}" class="history-thumb" onclick="event.stopPropagation(); viewHistorySession('${session.id}')" title="Фото ${images.indexOf(url) + 1}">`
        ).join('');
        
        const moreBadge = images.length > 3 ? `<span class="more-badge">+${images.length - 3}</span>` : '';

        historyList.innerHTML += `
            <div class="history-item" onclick="viewHistorySession('${session.id}')">
                <div class="history-item-header">
                    <div>
                        <strong>${session.productName || 'Без названия'}</strong>
                        <span class="history-type">${session.attempts || 1} фото</span>
                        <div class="history-date">${date}</div>
                    </div>
                    <div class="history-cost">${session.totalSpent || session.attempts * 100} ₽</div>
                </div>
                <div class="history-thumbnails">
                    ${previewImages}
                    ${moreBadge}
                </div>
            </div>
        `;
    });
}

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
                originalImageId: null,
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

// ----- Уведомления -----
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

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