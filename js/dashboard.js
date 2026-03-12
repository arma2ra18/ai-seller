import { supabase } from './supabase.js';
import { TEMPLATES, applyTemplateToResults } from './templates.js';

let currentUser = null;
let userData = null;
let activeTemplate = null;

// Переменные для модального окна загрузки
let generationInterval;
let generationStartTime;

// Текущая сессия генерации (группа карточек)
let currentGenerationSession = {
    sessionId: null,
    productName: null,
    brand: null,
    category: null,
    price: null,
    features: [],
    originalImageId: null,
    attemptsMade: 0,
    maxAttempts: 5,
    generatedImages: []
};

// Для страницы истории (все сессии)
let allSessions = [];
let currentHistoryPage = 1;
const HISTORY_PER_PAGE = 10;

// ========== АВТОРИЗАЦИЯ ==========
supabase.auth.onAuthStateChanged(async (event, session) => {
    if (!session) {
        window.location.href = '/login.html';
        return;
    }
    
    currentUser = session.user;
    await loadUserData();
    loadActiveTemplate();
    
    // Получаем текущий путь страницы
    const path = window.location.pathname;
    console.log('Текущая страница:', path);
    
    // Загружаем историю только если это не страница новостей
    if (!path.includes('news.html')) {
        if (path.includes('history.html')) {
            console.log('Загружаем всю историю...');
            await loadAllHistory();
        } else {
            console.log('Загружаем последние 10 записей...');
            await loadRecentHistory();
        }
    } else {
        console.log('Страница новостей, историю не загружаем');
    }
});

// ========== ЗАГРУЗКА АКТИВНОГО ШАБЛОНА ==========
function loadActiveTemplate() {
    try {
        const saved = localStorage.getItem('activeTemplate');
        const savedForUser = localStorage.getItem(`template_${currentUser?.id}`);
        
        if (saved) {
            activeTemplate = JSON.parse(saved);
        } else if (savedForUser) {
            activeTemplate = JSON.parse(savedForUser);
        } else {
            activeTemplate = TEMPLATES.premium;
        }
        
        console.log('🎨 Активный шаблон загружен:', activeTemplate.name);
    } catch (error) {
        console.error('Ошибка загрузки шаблона:', error);
    }
}

// ========== ЗАГРУЗКА ДАННЫХ ПОЛЬЗОВАТЕЛЯ ==========
async function loadUserData() {
    if (!currentUser) return;
    
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error) throw error;
        
        userData = user;
        updateUI();
        updateStats();
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        showNotification('Ошибка загрузки данных', 'error');
    }
}

// ========== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==========
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
        userEmailEl.textContent = currentUser.email || 'Пользователь';
    }
}

// ========== ОБНОВЛЕНИЕ СТАТИСТИКИ ==========
function updateStats() {
    const statUser = document.getElementById('statUser');
    if (statUser) {
        statUser.textContent = currentUser.email?.split('@')[0] || 'Пользователь';
    }
    
    const statCards = document.getElementById('statCards');
    if (statCards) statCards.textContent = userData?.used_spent || 0;
    
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

// ========== ВЫХОД ==========
window.logout = async function() {
    await supabase.auth.signOut();
    window.location.href = '/login.html';
};

// ========== НАВИГАЦИЯ ПО МЕНЮ ==========
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

// ========== ОБНОВЛЕНИЕ ИНФОРМАЦИИ О ФАЙЛАХ ==========
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

// ========== СБРОС СЕССИИ ==========
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
        generatedImages: []
    };
}

// ========== МОДАЛЬНОЕ ОКНО ЗАГРУЗКИ ==========
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

// ========== УВЕДОМЛЕНИЯ ==========
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

// ========== ОБНОВЛЕНИЕ UI ПОВТОРНЫХ ГЕНЕРАЦИЙ ==========
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

// ========== ГЕНЕРАЦИЯ КАРТОЧКИ ==========
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

// ========== ПОВТОРНАЯ ГЕНЕРАЦИЯ ==========
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

// ========== ОБЩАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ==========
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
        formData.append('userId', currentUser.id); // Добавляем userId для API
        
        if (currentGenerationSession.originalImageId) {
            formData.append('originalImageId', currentGenerationSession.originalImageId);
        }
        
        if (activeTemplate) {
            formData.append('template', JSON.stringify(activeTemplate));
            console.log('🎨 Отправляем шаблон:', activeTemplate.name);
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
        }
        
        const newAttemptCount = attempt + 1;
        currentGenerationSession.attemptsMade = newAttemptCount;

        // Обновляем или создаём сессию в БД
        if (attempt === 0) {
            const { data: session, error } = await supabase
                .from('generation_sessions')
                .insert({
                    user_id: currentUser.id,
                    product_name: currentGenerationSession.productName,
                    brand: currentGenerationSession.brand,
                    category: currentGenerationSession.category,
                    price: parseInt(currentGenerationSession.price) || 1990,
                    features: currentGenerationSession.features,
                    attempts: 1,
                    total_spent: cost,
                    images: [result.images[0]],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (!error && session) {
                currentGenerationSession.sessionId = session.id;
            }
        } else if (currentGenerationSession.sessionId) {
            await supabase
                .from('generation_sessions')
                .update({
                    attempts: newAttemptCount,
                    total_spent: (await getSessionTotal(currentGenerationSession.sessionId)) + cost,
                    images: currentGenerationSession.generatedImages,
                    updated_at: new Date().toISOString()
                })
                .eq('id', currentGenerationSession.sessionId);
        }

        // Обновляем баланс пользователя
        const { data: updatedUser, error: updateError } = await supabase
            .from('users')
            .update({ 
                balance: userData.balance - cost,
                used_spent: (userData.used_spent || 0) + cost
            })
            .eq('id', currentUser.id)
            .select()
            .single();

        if (!updateError && updatedUser) {
            userData = updatedUser;
        }

        updateUI();
        
        // Обновляем историю
        const path = window.location.pathname;
        if (path.includes('history.html')) {
            await loadAllHistory();
        } else if (!path.includes('news.html')) {
            await loadRecentHistory();
        }
        
        displayCardResults(result);
        
        const message = attempt === 0 
            ? '✅ Первое фото готово! Можете сгенерировать ещё за 15 ₽' 
            : `✅ Фото №${attempt + 1} готово! Списано ${cost} ₽`;
        showNotification(message, 'success');

    } catch (error) {
        console.error('❌ Ошибка генерации:', error);
        showNotification('❌ ' + (error.message || 'Ошибка'), 'error');
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

// Вспомогательная функция для получения суммы сессии
async function getSessionTotal(sessionId) {
    const { data } = await supabase
        .from('generation_sessions')
        .select('total_spent')
        .eq('id', sessionId)
        .single();
    return data?.total_spent || 0;
}

// ========== ОТОБРАЖЕНИЕ РЕЗУЛЬТАТОВ ==========
function displayCardResults(result) {
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
        
        if (activeTemplate) {
            setTimeout(() => {
                applyTemplateToResults(activeTemplate);
            }, 100);
        }
    }

    updateRegenerationUI();
}

// ========== ЗАГРУЗКА ПОСЛЕДНИХ 10 СЕССИЙ ==========
async function loadRecentHistory() {
    if (!currentUser) return;
    
    try {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        const { data: sessions, error } = await supabase
            .from('generation_sessions')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!sessions || sessions.length === 0) {
            historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
            return;
        }

        displayHistory(sessions, true);
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
    }
}

// ========== ЗАГРУЗКА ВСЕХ СЕССИЙ ==========
async function loadAllHistory() {
    if (!currentUser) return;
    
    try {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;

        const { data: sessions, error } = await supabase
            .from('generation_sessions')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!sessions || sessions.length === 0) {
            historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
            return;
        }

        allSessions = sessions;
        displayAllHistory();
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        const historyList = document.getElementById('historyList');
        if (historyList) historyList.innerHTML = '<p class="text-muted">Ошибка загрузки истории</p>';
    }
}

// ========== ОТОБРАЖЕНИЕ ИСТОРИИ С ПАГИНАЦИЕЙ ==========
function displayAllHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (allSessions.length === 0) {
        historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
        return;
    }

    const start = (currentHistoryPage - 1) * HISTORY_PER_PAGE;
    const paginatedSessions = allSessions.slice(start, start + HISTORY_PER_PAGE);

    historyList.innerHTML = '';
    
    paginatedSessions.forEach(session => {
        const date = new Date(session.created_at).toLocaleString('ru-RU', { 
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' 
        });
        
        const images = session.images || [];
        const previewImages = images.slice(0, 3).map((url, idx) => 
            `<img src="${url}" class="history-thumb" onclick="event.stopPropagation(); viewHistorySession('${session.id}')" title="Фото ${idx + 1}">`
        ).join('');
        
        const moreBadge = images.length > 3 ? `<span class="more-badge">+${images.length - 3}</span>` : '';

        historyList.innerHTML += `
            <div class="history-item" onclick="viewHistorySession('${session.id}')">
                <div class="history-item-header">
                    <div>
                        <strong>${session.product_name || 'Без названия'}</strong>
                        <span class="history-type">${session.attempts || 1} фото</span>
                        <div class="history-date">${date}</div>
                    </div>
                    <div class="history-actions">
                        <span class="history-cost">${session.total_spent || session.attempts * 100} ₽</span>
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

    updateHistoryPagination();
}

// ========== ОТОБРАЖЕНИЕ ПОСЛЕДНИХ 10 ==========
function displayHistory(sessions) {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    if (sessions.length === 0) {
        historyList.innerHTML = '<p class="text-muted">История пуста. Сгенерируйте первую карточку!</p>';
        return;
    }

    historyList.innerHTML = '';
    
    sessions.forEach(session => {
        const date = new Date(session.created_at).toLocaleString('ru-RU', { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        
        const images = session.images || [];
        const previewImages = images.slice(0, 3).map((url, idx) => 
            `<img src="${url}" class="history-thumb" onclick="event.stopPropagation(); viewHistorySession('${session.id}')" title="Фото ${idx + 1}">`
        ).join('');
        
        const moreBadge = images.length > 3 ? `<span class="more-badge">+${images.length - 3}</span>` : '';

        historyList.innerHTML += `
            <div class="history-item" onclick="viewHistorySession('${session.id}')">
                <div class="history-item-header">
                    <div>
                        <strong>${session.product_name || 'Без названия'}</strong>
                        <span class="history-type">${session.attempts || 1} фото</span>
                        <div class="history-date">${date}</div>
                    </div>
                    <div class="history-actions">
                        <span class="history-cost">${session.total_spent || session.attempts * 100} ₽</span>
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

// ========== ПАГИНАЦИЯ ==========
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

// ========== ПЕРЕХОД НА СТРАНИЦУ ИСТОРИИ ==========
window.goToHistoryPage = function(page) {
    currentHistoryPage = page;
    displayAllHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ========== УДАЛЕНИЕ СЕССИИ ==========
window.deleteHistorySession = async function(sessionId) {
    if (!currentUser) return;
    
    if (!confirm('Вы уверены, что хотите удалить эту сессию генерации? Это действие необратимо.')) {
        return;
    }
    
    try {
        const { error } = await supabase
            .from('generation_sessions')
            .delete()
            .eq('id', sessionId);

        if (error) throw error;
        
        allSessions = allSessions.filter(s => s.id !== sessionId);
        
        if (allSessions.length > 0) {
            const start = (currentHistoryPage - 1) * HISTORY_PER_PAGE;
            if (start >= allSessions.length) {
                currentHistoryPage = Math.max(1, Math.ceil(allSessions.length / HISTORY_PER_PAGE));
            }
        } else {
            currentHistoryPage = 1;
        }
        
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

// ========== ПРОСМОТР СЕССИИ ==========
window.viewHistorySession = async function(sessionId) {
    if (!currentUser) return;
    
    try {
        const { data: session, error } = await supabase
            .from('generation_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (error || !session) {
            showNotification('Сессия не найдена', 'error');
            return;
        }
        
        currentGenerationSession = {
            sessionId: sessionId,
            productName: session.product_name,
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
        session.images?.forEach((url, index) => {
            const img = document.createElement('img');
            img.src = url;
            img.alt = `Фото товара`;
            img.onclick = () => window.openLightbox(url);
            gallery.appendChild(img);
        });
        
        if (activeTemplate) {
            setTimeout(() => {
                applyTemplateToResults(activeTemplate);
            }, 100);
        }
        
        updateRegenerationUI();
        
        const regenBtn = document.getElementById('regenerateBtn');
        if (regenBtn) regenBtn.style.display = 'none';
        
        document.getElementById('cardResults').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error('Ошибка загрузки сессии:', error);
        showNotification('Ошибка загрузки', 'error');
    }
};

// ========== ЛАЙТБОКС ==========
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

// ========== ПОПОЛНЕНИЕ БАЛАНСА ==========
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
            
            const { error } = await supabase
                .from('users')
                .update({ balance: newBalance })
                .eq('id', currentUser.id);

            if (error) throw error;
            
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
        displayNameInput.value = currentUser.user_metadata?.display_name || '';
    }
    
    const emailInput = document.getElementById('userEmailSettings');
    if (emailInput) {
        emailInput.value = currentUser.email || '';
    }
    
    const phoneInput = document.getElementById('phoneNumber');
    if (phoneInput) {
        phoneInput.value = currentUser.phone || '';
    }
    
    const createdEl = document.getElementById('accountCreated');
    if (createdEl && userData.created_at) {
        const date = new Date(userData.created_at);
        createdEl.textContent = date.toLocaleDateString('ru-RU');
    }
    
    const totalGenEl = document.getElementById('totalGenerations');
    if (totalGenEl) {
        totalGenEl.textContent = (userData.used_spent || 0) + ' ₽';
    }
    
    const lastLoginEl = document.getElementById('lastLogin');
    if (lastLoginEl) {
        const lastSignIn = new Date().toLocaleString('ru-RU');
        lastLoginEl.textContent = lastSignIn;
    }
}

window.updateDisplayName = async function() {
    const newName = document.getElementById('displayName').value.trim();
    if (!newName) {
        showNotification('Введите имя', 'warning');
        return;
    }
    
    try {
        const { error } = await supabase.auth.updateUser({
            data: { display_name: newName }
        });

        if (error) throw error;
        
        await supabase
            .from('users')
            .update({ display_name: newName })
            .eq('id', currentUser.id);
        
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
        const { error } = await supabase.auth.updateUser({
            email: newEmail
        });

        if (error) throw error;
        
        showNotification('Запрос на смену email отправлен! Проверьте почту.', 'success');
        closeEmailModal();
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
        await supabase
            .from('users')
            .update({ phone: newPhone })
            .eq('id', currentUser.id);
        
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
        const { error } = await supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;
        
        showNotification('Пароль успешно изменён!', 'success');
        document.getElementById('newPassword').value = '';
    } catch (error) {
        console.error('Error changing password:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

window.deleteAccount = async function() {
    if (!confirm('Вы уверены, что хотите удалить аккаунт? Это действие необратимо.')) {
        return;
    }
    
    try {
        await supabase
            .from('users')
            .delete()
            .eq('id', currentUser.id);
        
        await supabase.auth.admin.deleteUser(currentUser.id);
        
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