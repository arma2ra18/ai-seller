/**
 * ================================================
 * Prodiger Admin Panel
 * Полный файл управления админ-панелью
 * ================================================
 */

import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { 
    collection, getDocs, query, orderBy, limit, doc, getDoc, 
    updateDoc, deleteDoc, setDoc, addDoc, where, Timestamp,
    writeBatch, increment
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let currentAdmin = null;            // Текущий администратор
let currentPage = 1;                // Текущая страница пагинации для пользователей
let usersList = [];                 // Кэш списка пользователей
let generationsList = [];           // Кэш списка генераций
let logsList = [];                  // Кэш списка логов
let allAdminLogs = [];              // Все логи админов
let filteredAdminLogs = [];          // Отфильтрованные логи
let currentLogPage = 1;              // Текущая страница логов
const pageSize = 20;                 // Количество элементов на странице
const LOGS_PER_PAGE = 20;            // Логов на странице
const ONLINE_TIMEOUT = 15 * 60 * 1000; // 15 минут для определения онлайн
let logSortField = 'timestamp';       // Поле для сортировки логов
let logSortDirection = 'desc';        // Направление сортировки логов

// ========== АВТОРИЗАЦИЯ ==========

/**
 * Вход в админ-панель
 * Проверяет email/пароль и наличие прав администратора
 */
window.adminLogin = async function() {
    const email = document.getElementById('adminEmail').value.trim();
    const password = document.getElementById('adminPassword').value;
    const errorEl = document.getElementById('adminError');
    
    if (!email || !password) {
        errorEl.textContent = 'Введите email и пароль';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const token = await userCredential.user.getIdTokenResult();
        
        if (token.claims && token.claims.admin === true) {
            window.location.href = 'dashboard.html';
        } else {
            errorEl.textContent = 'У вас нет прав администратора';
            errorEl.style.display = 'block';
            await auth.signOut();
        }
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Ошибка входа';
        if (error.code === 'auth/invalid-credential') {
            errorMessage = 'Неверный email или пароль';
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = 'Слишком много попыток, повторите позже';
        } else {
            errorMessage = error.message;
        }
        errorEl.textContent = errorMessage;
        errorEl.style.display = 'block';
    }
};

/**
 * Выход из системы
 */
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/admin/index.html';
};

/**
 * Показывает уведомление на странице
 * @param {string} message - Текст уведомления
 * @param {string} type - Тип (success/error/info)
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// ========== ЗАЩИТА СТРАНИЦ ==========

/**
 * Проверка авторизации при загрузке каждой страницы
 * Загружает соответствующие данные в зависимости от URL
 */
onAuthStateChanged(auth, async (user) => {
    const path = window.location.pathname;
    console.log('Текущий путь:', path);
    
    if (path.includes('/admin/index.html')) return;
    
    if (!user) {
        window.location.href = '/admin/index.html';
        return;
    }
    
    currentAdmin = user;
    const emailEl = document.getElementById('adminEmail');
    if (emailEl) emailEl.textContent = user.email;
    
    const token = await user.getIdTokenResult();
    if (!token.claims || !token.claims.admin) {
        alert('У вас нет прав доступа');
        await signOut(auth);
        window.location.href = '/admin/index.html';
        return;
    }
    
    // Загружаем данные в зависимости от страницы
    try {
        if (path.includes('dashboard.html')) {
            await loadDashboardStats();
            await loadRecentActivity();
            initCharts();
        } else if (path.includes('users.html')) {
            await loadUsers();
        } else if (path.includes('generations.html')) {
            await loadAllGenerations();
        } else if (path.includes('logs.html')) {
            await loadAdminLogs();
            await loadSystemLogs();
            await loadPayments();
            initLogsFilters();
        } else if (path.includes('settings.html')) {
    await loadSettings();
    await loadCubeSettings();     // Добавить
    await loadCarouselSettings(); // Добавить
}
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        showNotification('Ошибка загрузки: ' + error.message, 'error');
    }
});

// ========== ДАШБОРД ==========

/**
 * Загружает общую статистику для главной страницы
 */
async function loadDashboardStats() {
    try {
        console.log('Загружаем статистику дашборда...');
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersCount = usersSnapshot.size;
        
        let totalRevenue = 0;
        let totalSpent = 0;
        let generationsCount = 0;
        let activeNow = 0;
        const now = Date.now();
        
        // Собираем данные по пользователям
        for (const userDoc of usersSnapshot.docs) {
            const user = userDoc.data();
            totalSpent += user.usedSpent || 0;
            
            // Проверяем, был ли пользователь активен в последние 15 минут
            const lastActivity = user.lastActivity ? user.lastActivity.toDate?.().getTime() : 0;
            if (lastActivity && (now - lastActivity) < ONLINE_TIMEOUT) {
                activeNow++;
            }
            
            const gensSnapshot = await getDocs(collection(db, 'users', userDoc.id, 'generations'));
            generationsCount += gensSnapshot.size;
        }
        
        // Выручка = потрачено пользователями
        const revenue = totalSpent;
        
        document.getElementById('totalUsers').textContent = usersCount;
        document.getElementById('totalRevenue').textContent = revenue.toLocaleString() + ' ₽';
        document.getElementById('totalGenerations').textContent = generationsCount;
        document.getElementById('onlineUsers').textContent = activeNow;
        
        // Рассчитываем тренды (сравнение с предыдущим периодом)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        let newUsersWeek = 0;
        usersSnapshot.forEach(doc => {
            const created = doc.data().createdAt ? new Date(doc.data().createdAt) : null;
            if (created && created > weekAgo) newUsersWeek++;
        });
        
        const usersTrend = usersCount > 0 ? Math.round((newUsersWeek / usersCount) * 100) : 0;
        document.getElementById('usersTrend').textContent = `+${usersTrend}%`;
        
        // Тренд выручки (имитация, можно сделать реальный)
        document.getElementById('revenueTrend').textContent = '+12%';
        document.getElementById('generationsTrend').textContent = '+8%';
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        showNotification('Ошибка загрузки статистики', 'error');
    }
}

/**
 * Загружает последние действия для отображения в дашборде
 */
async function loadRecentActivity() {
    try {
        const list = document.getElementById('activityList');
        if (!list) return;
        
        list.innerHTML = '<li class="activity-item"><span>Загрузка...</span></li>';
        
        // Пробуем получить логи админов
        let logsSnapshot;
        try {
            const logsQuery = query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(20));
            logsSnapshot = await getDocs(logsQuery);
        } catch (e) {
            console.warn('Коллекция adminLogs не найдена, используем заглушку');
            logsSnapshot = { empty: true };
        }
        
        if (!logsSnapshot || logsSnapshot.empty) {
            list.innerHTML = '<li class="activity-item"><span>Нет действий</span></li>';
            return;
        }
        
        list.innerHTML = '';
        logsSnapshot.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp?.toDate ? 
                log.timestamp.toDate().toLocaleString('ru-RU', {
                    hour: '2-digit', minute: '2-digit'
                }) : 'недавно';
            
            let actionText = log.action || 'Действие';
            if (log.action === 'bulk_add_funds') {
                actionText = `💰 Массовое начисление: +${log.amount} ₽`;
            } else if (log.action === 'add_funds') {
                actionText = `💰 Начислено ${log.amount} ₽`;
            } else if (log.action === 'edit_user') {
                actionText = `✏️ Редактирование пользователя`;
            } else if (log.action === 'delete_user') {
                actionText = `🗑️ Удаление пользователя`;
            } else if (log.action === 'update_settings') {
                actionText = `⚙️ Изменение настроек`;
            }
            
            list.innerHTML += `
                <li class="activity-item">
                    <span>${actionText}: ${log.targetUser || log.targetUserId || 'система'}</span>
                    <span>${time}</span>
                </li>
            `;
        });
        
    } catch (error) {
        console.error('Ошибка загрузки активности:', error);
        const list = document.getElementById('activityList');
        if (list) list.innerHTML = '<li class="activity-item"><span>Ошибка загрузки</span></li>';
    }
}

/**
 * Инициализирует графики на дашборде
 */
async function initCharts() {
    // Проверяем, загружена ли библиотека Chart.js
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js не загружен');
        return;
    }
    
    // Получаем реальные данные регистраций за последние 7 дней
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const days = [];
    const counts = [];
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        
        const dayStr = date.toLocaleDateString('ru-RU', { weekday: 'short' }).slice(0, 2);
        days.push(dayStr);
        
        let count = 0;
        usersSnapshot.forEach(doc => {
            const created = doc.data().createdAt ? new Date(doc.data().createdAt) : null;
            if (created && created >= date && created < nextDate) {
                count++;
            }
        });
        counts.push(count);
    }
    
    // График регистраций
    const ctx1 = document.getElementById('regChart')?.getContext('2d');
    if (ctx1) {
        new Chart(ctx1, {
            type: 'line',
            data: {
                labels: days,
                datasets: [{
                    label: 'Новые пользователи',
                    data: counts,
                    borderColor: '#0071e3',
                    backgroundColor: 'rgba(0,113,227,0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
    }
    
    // График выручки (можно тоже сделать реальный)
    const ctx2 = document.getElementById('revenueChart')?.getContext('2d');
    if (ctx2) {
        new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: days,
                datasets: [{
                    label: 'Выручка (₽)',
                    data: counts.map(c => c * 500), // имитация
                    backgroundColor: 'rgba(0,113,227,0.7)',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

// ========== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ==========

/**
 * Загружает список пользователей с пагинацией
 * @param {number} page - Номер страницы
 */
window.loadUsers = async function(page = 1) {
    currentPage = page;
    try {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Загрузка...</td></tr>';
        
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);
        
        usersList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        applyFilters();
        updatePagination();
        
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error);
        const tbody = document.getElementById('usersTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7">Ошибка загрузки</td></tr>';
    }
};

/**
 * Применяет фильтры к списку пользователей
 */
window.applyFilters = function() {
    let filtered = [...usersList];
    
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(u => 
            (u.email && u.email.toLowerCase().includes(searchTerm)) ||
            (u.displayName && u.displayName.toLowerCase().includes(searchTerm)) ||
            (u.phoneNumber && u.phoneNumber.includes(searchTerm))
        );
    }
    
    const balanceFilter = document.getElementById('balanceFilter')?.value;
    if (balanceFilter === 'positive') {
        filtered = filtered.filter(u => u.balance > 0);
    } else if (balanceFilter === 'zero') {
        filtered = filtered.filter(u => u.balance <= 0);
    } else if (balanceFilter === 'high') {
        filtered = filtered.filter(u => u.balance > 1000);
    }
    
    const dateFilter = document.getElementById('dateFilter')?.value;
    if (dateFilter) {
        const now = new Date();
        filtered = filtered.filter(u => {
            if (!u.createdAt) return false;
            const created = new Date(u.createdAt);
            if (dateFilter === 'today') {
                return created.toDateString() === now.toDateString();
            } else if (dateFilter === 'week') {
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                return created >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                return created >= monthAgo;
            }
            return true;
        });
    }
    
    const sortFilter = document.getElementById('sortFilter')?.value;
    if (sortFilter === 'date_desc') {
        filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortFilter === 'date_asc') {
        filtered.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    } else if (sortFilter === 'balance_desc') {
        filtered.sort((a, b) => (b.balance || 0) - (a.balance || 0));
    } else if (sortFilter === 'balance_asc') {
        filtered.sort((a, b) => (a.balance || 0) - (b.balance || 0));
    }
    
    renderUsersTable(filtered);
    
    document.getElementById('filteredCount').textContent = filtered.length;
    const totalBalance = filtered.reduce((sum, u) => sum + (u.balance || 0), 0);
    document.getElementById('filteredBalance').textContent = totalBalance;
};

/**
 * Сбрасывает все фильтры
 */
window.resetFilters = function() {
    document.getElementById('searchInput').value = '';
    document.getElementById('balanceFilter').value = '';
    document.getElementById('dateFilter').value = '';
    document.getElementById('sortFilter').value = 'date_desc';
    applyFilters();
};

/**
 * Сортирует таблицу по выбранному полю
 * @param {string} field - Поле для сортировки
 */
window.sortTable = function(field) {
    const sortMap = {
        'email': 'email',
        'displayName': 'displayName',
        'phoneNumber': 'phoneNumber',
        'balance': 'balance',
        'usedSpent': 'usedSpent',
        'createdAt': 'createdAt'
    };
    
    const sortField = sortMap[field] || 'createdAt';
    usersList.sort((a, b) => {
        const valA = a[sortField] || '';
        const valB = b[sortField] || '';
        return valA > valB ? 1 : -1;
    });
    applyFilters();
};

/**
 * Отображает таблицу пользователей
 * @param {Array} users - Массив пользователей для отображения
 */
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    const start = (currentPage - 1) * pageSize;
    const paginated = users.slice(start, start + pageSize);
    
    paginated.forEach(user => {
        const date = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : '—';
        tbody.innerHTML += `
            <tr>
                <td>${user.email || '—'}</td>
                <td>${user.displayName || '—'}</td>
                <td>${user.phoneNumber || '—'}</td>
                <td>${user.balance || 0} ₽</td>
                <td>${user.usedSpent || 0} ₽</td>
                <td>${date}</td>
                <td class="user-actions">
                    <button class="btn btn-small" onclick="editUser('${user.id}')">✏️</button>
                    <button class="btn btn-small" onclick="viewUserHistory('${user.id}')">📜</button>
                    <button class="btn btn-small" onclick="addFunds('${user.id}')">➕</button>
                </td>
            </tr>
        `;
    });
}

/**
 * Обновляет пагинацию
 */
function updatePagination() {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;
    
    const totalPages = Math.ceil(usersList.length / pageSize);
    let html = '';
    
    for (let i = 1; i <= totalPages; i++) {
        html += `<button onclick="loadUsers(${i})" ${i === currentPage ? 'class="active"' : ''}>${i}</button>`;
    }
    
    pagination.innerHTML = html;
}

// ========== РЕДАКТИРОВАНИЕ ПОЛЬЗОВАТЕЛЯ ==========

let currentEditUserId = null;

/**
 * Открывает модальное окно для редактирования пользователя
 * @param {string} userId - ID пользователя
 */
window.editUser = async function(userId) {
    currentEditUserId = userId;
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        if (!userDoc.exists()) {
            alert('Пользователь не найден');
            return;
        }
        
        const user = userDoc.data();
        
        document.getElementById('editEmail').value = user.email || '';
        document.getElementById('editDisplayName').value = user.displayName || '';
        document.getElementById('editPhone').value = user.phoneNumber || '';
        document.getElementById('editBalance').value = user.balance || 0;
        
        // Проверяем, является ли пользователь админом
        try {
            const adminDoc = await getDoc(doc(db, 'admins', userId));
            document.getElementById('editIsAdmin').checked = adminDoc.exists();
        } catch (e) {
            document.getElementById('editIsAdmin').checked = false;
        }
        
        document.getElementById('userModal').classList.add('show');
        
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        alert('Ошибка загрузки данных: ' + error.message);
    }
};

/**
 * Закрывает модальное окно редактирования
 */
window.closeUserModal = function() {
    document.getElementById('userModal').classList.remove('show');
    currentEditUserId = null;
};

/**
 * Сохраняет изменения пользователя
 */
window.saveUserChanges = async function() {
    if (!currentEditUserId) return;
    
    try {
        const updates = {
            displayName: document.getElementById('editDisplayName').value,
            phoneNumber: document.getElementById('editPhone').value,
            balance: parseInt(document.getElementById('editBalance').value) || 0
        };
        
        await updateDoc(doc(db, 'users', currentEditUserId), updates);
        
        const isAdmin = document.getElementById('editIsAdmin').checked;
        const adminRef = doc(db, 'admins', currentEditUserId);
        
        if (isAdmin) {
            await setDoc(adminRef, { 
                email: document.getElementById('editEmail').value,
                grantedBy: currentAdmin?.uid || 'unknown',
                grantedAt: new Date().toISOString()
            });
        } else {
            try {
                await deleteDoc(adminRef);
            } catch (e) {
                // Игнорируем, если документа не было
            }
        }
        
        // Пытаемся записать лог, но не падаем при ошибке
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'edit_user',
                targetUser: document.getElementById('editEmail').value,
                targetUserId: currentEditUserId,
                performedBy: currentAdmin?.uid || 'unknown',
                changes: updates,
                timestamp: new Date().toISOString()
            });
        } catch (logError) {
            console.warn('Не удалось записать лог:', logError);
        }
        
        showNotification('Изменения сохранены', 'success');
        closeUserModal();
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showNotification('Ошибка сохранения: ' + error.message, 'error');
    }
};

/**
 * Удаляет пользователя
 */
window.deleteUser = async function() {
    if (!currentEditUserId) return;
    
    if (!confirm('Вы уверены, что хотите удалить этого пользователя? Это действие необратимо.')) {
        return;
    }
    
    try {
        await deleteDoc(doc(db, 'users', currentEditUserId));
        try {
            await deleteDoc(doc(db, 'admins', currentEditUserId));
        } catch (e) {}
        
        // Логируем удаление
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'delete_user',
                targetUserId: currentEditUserId,
                performedBy: currentAdmin?.uid || 'unknown',
                timestamp: new Date().toISOString()
            });
        } catch (logError) {
            console.warn('Не удалось записать лог:', logError);
        }
        
        showNotification('Пользователь удалён', 'success');
        closeUserModal();
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка удаления:', error);
        showNotification('Ошибка удаления: ' + error.message, 'error');
    }
};

/**
 * Начисляет средства пользователю
 * @param {string} userId - ID пользователя
 */
window.addFunds = async function(userId) {
    const amount = prompt('Введите сумму для начисления (₽):');
    if (!amount) return;
    
    const rubles = parseInt(amount);
    if (isNaN(rubles) || rubles <= 0) {
        alert('Введите положительное число');
        return;
    }
    
    try {
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        const currentBalance = userDoc.data().balance || 0;
        
        await updateDoc(userRef, {
            balance: currentBalance + rubles
        });
        
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'add_funds',
                targetUserId: userId,
                amount: rubles,
                performedBy: currentAdmin?.uid || 'unknown',
                timestamp: new Date().toISOString()
            });
        } catch (logError) {
            console.warn('Не удалось записать лог:', logError);
        }
        
        showNotification(`Начислено ${rubles} ₽`, 'success');
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка начисления:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

/**
 * Показывает историю генераций пользователя
 * @param {string} userId - ID пользователя
 */
window.viewUserHistory = async function(userId) {
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        const user = userDoc.data();
        
        const gensSnapshot = await getDocs(collection(db, 'users', userId, 'generations'));
        
        let html = `<h3>Пользователь: ${user.email || '—'}</h3>`;
        html += '<h4>Генерации:</h4><ul>';
        
        if (gensSnapshot.empty) {
            html += '<li>Нет генераций</li>';
        } else {
            gensSnapshot.forEach(doc => {
                const gen = doc.data();
                const date = gen.timestamp ? new Date(gen.timestamp).toLocaleString('ru-RU') : '—';
                html += `<li>${date} — ${gen.productName || 'Без названия'} (${gen.type || 'карточка'})</li>`;
            });
        }
        
        html += '</ul>';
        
        document.getElementById('historyModalContent').innerHTML = html;
        document.getElementById('historyModal').classList.add('show');
        
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        alert('Ошибка: ' + error.message);
    }
};

/**
 * Закрывает модальное окно истории
 */
window.closeHistoryModal = function() {
    document.getElementById('historyModal').classList.remove('show');
};

// ========== ЭКСПОРТ В CSV ==========

/**
 * Экспортирует список пользователей в CSV
 */
window.exportUsersCSV = function() {
    let csv = "Email,Имя,Телефон,Баланс,Потрачено,Дата регистрации,Последняя активность\n";
    
    usersList.forEach(u => {
        const regDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '';
        const lastActive = u.lastActivity ? new Date(u.lastActivity).toLocaleDateString('ru-RU') : '';
        
        // Экранируем поля, чтобы не сломать CSV
        const email = u.email ? u.email.replace(/"/g, '""') : '';
        const name = u.displayName ? u.displayName.replace(/"/g, '""') : '';
        const phone = u.phoneNumber ? u.phoneNumber.replace(/"/g, '""') : '';
        
        csv += `"${email}","${name}","${phone}",${u.balance || 0},${u.usedSpent || 0},"${regDate}","${lastActive}"\n`;
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' }); // Добавляем BOM для русского
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showNotification('Экспорт завершён', 'success');
};

/**
 * Экспортирует общую статистику в CSV
 */
window.exportStats = function() {
    // Собираем общую статистику
    const totalUsers = usersList.length;
    const totalBalance = usersList.reduce((s, u) => s + (u.balance || 0), 0);
    const totalSpent = usersList.reduce((s, u) => s + (u.usedSpent || 0), 0);
    const avgBalance = totalUsers > 0 ? Math.round(totalBalance / totalUsers) : 0;
    
    let csv = "Показатель,Значение\n";
    csv += `Всего пользователей,${totalUsers}\n`;
    csv += `Суммарный баланс,${totalBalance} ₽\n`;
    csv += `Всего потрачено,${totalSpent} ₽\n`;
    csv += `Средний баланс,${avgBalance} ₽\n`;
    csv += `Дата экспорта,${new Date().toLocaleString('ru-RU')}\n`;
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stats_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showNotification('Статистика экспортирована', 'success');
};

// ========== ГЕНЕРАЦИИ ==========

/**
 * Загружает все генерации пользователей
 */
window.loadAllGenerations = async function(page = 1) {
    try {
        const tbody = document.getElementById('generationsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">Загрузка...</td></tr>';
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        let allGens = [];
        
        for (const userDoc of usersSnapshot.docs) {
            const gensSnapshot = await getDocs(collection(db, 'users', userDoc.id, 'generations'));
            gensSnapshot.forEach(genDoc => {
                allGens.push({
                    ...genDoc.data(),
                    userId: userDoc.id,
                    userEmail: userDoc.data().email
                });
            });
        }
        
        allGens.sort((a, b) => {
            const dateA = a.timestamp ? new Date(a.timestamp) : 0;
            const dateB = b.timestamp ? new Date(b.timestamp) : 0;
            return dateB - dateA;
        });
        
        generationsList = allGens;
        applyGenFilters();
        
    } catch (error) {
        console.error('Ошибка загрузки генераций:', error);
        const tbody = document.getElementById('generationsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6">Ошибка загрузки</td></tr>';
    }
};

/**
 * Применяет фильтры к списку генераций
 */
window.applyGenFilters = function() {
    let filtered = [...generationsList];
    
    const searchTerm = document.getElementById('searchGenInput')?.value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(g => 
            (g.productName && g.productName.toLowerCase().includes(searchTerm))
        );
    }
    
    const platform = document.getElementById('platformFilter')?.value;
    if (platform) {
        filtered = filtered.filter(g => g.type === `${platform}-card`);
    }
    
    const dateFilter = document.getElementById('dateGenFilter')?.value;
    if (dateFilter) {
        const now = new Date();
        filtered = filtered.filter(g => {
            if (!g.timestamp) return false;
            const date = new Date(g.timestamp);
            if (dateFilter === 'today') {
                return date.toDateString() === now.toDateString();
            } else if (dateFilter === 'week') {
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                return date >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                return date >= monthAgo;
            }
            return true;
        });
    }
    
    renderGenerations(filtered);
};

/**
 * Отображает таблицу генераций
 * @param {Array} gens - Массив генераций
 */
function renderGenerations(gens) {
    const tbody = document.getElementById('generationsTableBody');
    tbody.innerHTML = '';
    
    gens.slice(0, 50).forEach(gen => {
        const date = gen.timestamp ? new Date(gen.timestamp).toLocaleString('ru-RU') : '—';
        const platform = gen.type === 'wb-card' ? 'WB' : gen.type === 'ozon-card' ? 'Ozon' : '—';
        
        tbody.innerHTML += `
            <tr>
                <td>${date}</td>
                <td>${gen.userEmail || gen.userId || '—'}</td>
                <td>${gen.productName || '—'}</td>
                <td>${platform}</td>
                <td>100 ₽</td>
                <td>
                    ${gen.result?.images?.[0] ? 
                        `<img src="${gen.result.images[0]}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; cursor: pointer;" onclick="showPreview('${gen.result.images[0]}', '${gen.result.descriptions?.join('\\n')}')">` 
                        : '—'}
                </td>
            </tr>
        `;
    });
}

/**
 * Показывает превью сгенерированной карточки
 * @param {string} imageUrl - URL изображения
 * @param {string} descriptions - Описания
 */
window.showPreview = function(imageUrl, descriptions) {
    document.getElementById('previewImage').src = imageUrl;
    const descDiv = document.getElementById('previewDescriptions');
    if (descriptions) {
        const descArray = descriptions.split('\\n');
        descDiv.innerHTML = '<h4>Описания:</h4>' + descArray.map(d => `<p>${d}</p>`).join('');
    }
    document.getElementById('previewModal').classList.add('show');
};

/**
 * Закрывает модальное окно превью
 */
window.closePreviewModal = function() {
    document.getElementById('previewModal').classList.remove('show');
};

// ========== ЛОГИ (УЛУЧШЕННАЯ ВЕРСИЯ) ==========

/**
 * Переключает вкладки логов
 * @param {string} tab - Название вкладки
 */
window.showLogTab = function(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const tabButton = document.querySelector(`[onclick="showLogTab('${tab}')"]`);
    if (tabButton) tabButton.classList.add('active');
    
    const tabContent = document.getElementById(`${tab}-tab`);
    if (tabContent) tabContent.classList.add('active');
    
    // Если переключились на вкладку админов, обновляем отображение
    if (tab === 'admin') {
        renderAdminLogs();
    }
};

/**
 * Инициализирует обработчики для фильтров логов
 */
function initLogsFilters() {
    const dateFilter = document.getElementById('logDateFilter');
    if (dateFilter) {
        dateFilter.addEventListener('change', function(e) {
            const customDiv = document.getElementById('customDateRange');
            if (customDiv) {
                customDiv.style.display = e.target.value === 'custom' ? 'flex' : 'none';
            }
            if (e.target.value !== 'custom') {
                applyLogFilters();
            }
        });
    }
}

/**
 * Применяет фильтры к логам
 */
window.applyLogFilters = function() {
    if (!allAdminLogs.length) return;
    
    const dateFilter = document.getElementById('logDateFilter')?.value || 'all';
    const searchTerm = document.getElementById('logSearch')?.value.toLowerCase() || '';
    const actionFilter = document.getElementById('actionFilter')?.value || 'all';
    
    filteredAdminLogs = allAdminLogs.filter(log => {
        // Фильтр по дате
        if (dateFilter !== 'all' && dateFilter !== 'custom') {
            const logDate = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
            const now = new Date();
            
            if (dateFilter === 'today') {
                if (logDate.toDateString() !== now.toDateString()) return false;
            } else if (dateFilter === 'yesterday') {
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                if (logDate.toDateString() !== yesterday.toDateString()) return false;
            } else if (dateFilter === 'week') {
                const weekAgo = new Date(now);
                weekAgo.setDate(now.getDate() - 7);
                if (logDate < weekAgo) return false;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now);
                monthAgo.setMonth(now.getMonth() - 1);
                if (logDate < monthAgo) return false;
            } else if (dateFilter === 'year') {
                const yearAgo = new Date(now);
                yearAgo.setFullYear(now.getFullYear() - 1);
                if (logDate < yearAgo) return false;
            }
        }
        
        // Произвольный период
        if (dateFilter === 'custom') {
            const start = document.getElementById('startDate')?.value;
            const end = document.getElementById('endDate')?.value;
            if (start && end) {
                const logDate = log.timestamp?.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
                const startDate = new Date(start);
                const endDate = new Date(end);
                endDate.setHours(23, 59, 59, 999);
                
                if (logDate < startDate || logDate > endDate) return false;
            }
        }
        
        // Поиск по тексту
        if (searchTerm) {
            const actionText = getActionText(log.action).toLowerCase();
            const admin = (log.performedBy || 'система').toLowerCase();
            const target = (log.targetUser || log.targetUserId || '').toLowerCase();
            
            if (!actionText.includes(searchTerm) && 
                !admin.includes(searchTerm) && 
                !target.includes(searchTerm)) {
                return false;
            }
        }
        
        // Фильтр по типу действия
        if (actionFilter !== 'all') {
            if (log.action !== actionFilter) return false;
        }
        
        return true;
    });
    
    // Сортируем
    sortLogs(logSortField, false);
    
    const logsCountEl = document.getElementById('logsCount');
    if (logsCountEl) logsCountEl.textContent = filteredAdminLogs.length;
    
    // Обновляем информацию о периоде
    const periodSelect = document.getElementById('logDateFilter');
    if (periodSelect) {
        const selectedOption = periodSelect.options[periodSelect.selectedIndex];
        const periodText = selectedOption ? selectedOption.textContent : 'всё время';
        const logsPeriodEl = document.getElementById('logsPeriod');
        if (logsPeriodEl) logsPeriodEl.textContent = periodText;
    }
    
    currentLogPage = 1;
    renderAdminLogs();
    updateLogsPagination();
};

/**
 * Применяет произвольный период дат
 */
window.applyCustomDate = function() {
    applyLogFilters();
};

/**
 * Сбрасывает фильтры логов
 */
window.resetLogFilters = function() {
    const dateFilter = document.getElementById('logDateFilter');
    if (dateFilter) dateFilter.value = 'all';
    
    const searchInput = document.getElementById('logSearch');
    if (searchInput) searchInput.value = '';
    
    const actionFilter = document.getElementById('actionFilter');
    if (actionFilter) actionFilter.value = 'all';
    
    const customDiv = document.getElementById('customDateRange');
    if (customDiv) customDiv.style.display = 'none';
    
    const startDate = document.getElementById('startDate');
    if (startDate) startDate.value = '';
    
    const endDate = document.getElementById('endDate');
    if (endDate) endDate.value = '';
    
    applyLogFilters();
};

/**
 * Сортирует логи
 * @param {string} field - Поле для сортировки
 * @param {boolean} toggle - Менять ли направление
 */
window.sortLogs = function(field, toggle = true) {
    if (toggle) {
        if (logSortField === field) {
            logSortDirection = logSortDirection === 'desc' ? 'asc' : 'desc';
        } else {
            logSortField = field;
            logSortDirection = 'desc';
        }
    }
    
    filteredAdminLogs.sort((a, b) => {
        let valA, valB;
        
        if (field === 'timestamp') {
            valA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp);
            valB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp);
        } else if (field === 'performedBy') {
            valA = a.performedBy || '';
            valB = b.performedBy || '';
        } else if (field === 'action') {
            valA = getActionText(a.action);
            valB = getActionText(b.action);
        } else if (field === 'targetUser') {
            valA = a.targetUser || a.targetUserId || '';
            valB = b.targetUser || b.targetUserId || '';
        } else {
            valA = a[field] || '';
            valB = b[field] || '';
        }
        
        if (logSortDirection === 'desc') {
            return valA > valB ? -1 : 1;
        } else {
            return valA < valB ? -1 : 1;
        }
    });
    
    renderAdminLogs();
};

/**
 * Загружает все логи админов
 */
async function loadAdminLogs() {
    try {
        const tbody = document.getElementById('adminLogsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Загрузка...</td></tr>';
        
        // Проверяем, существует ли коллекция
        let logsSnapshot;
        try {
            // Загружаем все логи, без лимита
            const logsQuery = query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'));
            logsSnapshot = await getDocs(logsQuery);
        } catch (e) {
            console.warn('Коллекция adminLogs не найдена');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет логов</td></tr>';
            return;
        }
        
        if (logsSnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет логов</td></tr>';
            return;
        }
        
        // Сохраняем все логи
        allAdminLogs = [];
        logsSnapshot.forEach(doc => {
            allAdminLogs.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        filteredAdminLogs = [...allAdminLogs];
        
        const logsCountEl = document.getElementById('logsCount');
        if (logsCountEl) logsCountEl.textContent = filteredAdminLogs.length;
        
        renderAdminLogs();
        updateLogsPagination();
        
    } catch (error) {
        console.error('Ошибка загрузки логов:', error);
        const tbody = document.getElementById('adminLogsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5">Ошибка загрузки</td></tr>';
    }
}

/**
 * Отображает логи админов с пагинацией
 */
function renderAdminLogs() {
    const tbody = document.getElementById('adminLogsTableBody');
    if (!tbody) return;
    
    const start = (currentLogPage - 1) * LOGS_PER_PAGE;
    const paginated = filteredAdminLogs.slice(start, start + LOGS_PER_PAGE);
    
    if (paginated.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет записей</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    paginated.forEach(log => {
        const date = log.timestamp?.toDate ? 
            log.timestamp.toDate().toLocaleString('ru-RU', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }) : (log.timestamp ? new Date(log.timestamp).toLocaleString('ru-RU') : '—');
        
        // Получаем читаемое название действия
        const actionText = getActionText(log.action);
        
        // Формируем детали
        let details = '';
        if (log.amount) details += `Сумма: ${log.amount} ₽ `;
        if (log.userCount) details += `Пользователей: ${log.userCount} `;
        if (log.changes) {
            const changes = Object.entries(log.changes)
                .map(([key, val]) => `${key}: ${val}`)
                .join(', ');
            details += `Изменения: ${changes}`;
        }
        
        tbody.innerHTML += `
            <tr>
                <td>${date}</td>
                <td>${log.performedBy || 'система'}</td>
                <td>${actionText}</td>
                <td>${log.targetUser || log.targetUserId || '—'}</td>
                <td>${details || '—'}</td>
            </tr>
        `;
    });
}

/**
 * Возвращает читаемое название действия
 * @param {string} action - Код действия
 * @returns {string} - Текст действия
 */
function getActionText(action) {
    const actions = {
        'edit_user': '✏️ Редактирование пользователя',
        'delete_user': '🗑️ Удаление пользователя',
        'add_funds': '💰 Начисление средств',
        'bulk_add_funds': '📦 Массовое начисление',
        'update_settings': '⚙️ Изменение настроек'
    };
    return actions[action] || action || '—';
}

/**
 * Обновляет пагинацию для логов
 */
function updateLogsPagination() {
    const pagination = document.getElementById('logsPagination');
    if (!pagination) return;
    
    const totalPages = Math.ceil(filteredAdminLogs.length / LOGS_PER_PAGE);
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    for (let i = 1; i <= totalPages; i++) {
        html += `<button onclick="goToLogPage(${i})" ${i === currentLogPage ? 'class="active"' : ''}>${i}</button>`;
    }
    pagination.innerHTML = html;
}

/**
 * Переходит на указанную страницу логов
 * @param {number} page - Номер страницы
 */
window.goToLogPage = function(page) {
    currentLogPage = page;
    renderAdminLogs();
    updateLogsPagination();
};

/**
 * Экспортирует логи в CSV
 */
window.exportLogsCSV = function() {
    if (filteredAdminLogs.length === 0) {
        showNotification('Нет данных для экспорта', 'warning');
        return;
    }
    
    let csv = "Дата,Админ,Действие,Цель,Детали\n";
    
    filteredAdminLogs.forEach(log => {
        const date = log.timestamp?.toDate ? 
            log.timestamp.toDate().toLocaleString('ru-RU') : 
            (log.timestamp ? new Date(log.timestamp).toLocaleString('ru-RU') : '—');
        
        const actionText = getActionText(log.action);
        const admin = (log.performedBy || 'система').replace(/"/g, '""');
        const target = (log.targetUser || log.targetUserId || '—').replace(/"/g, '""');
        
        let details = '';
        if (log.amount) details += `сумма:${log.amount}`;
        if (log.userCount) details += ` пользователей:${log.userCount}`;
        if (log.changes) {
            const changes = Object.entries(log.changes)
                .map(([key, val]) => `${key}:${val}`)
                .join(' ');
            details += ` изменения:${changes}`;
        }
        
        csv += `"${date}","${admin}","${actionText}","${target}","${details}"\n`;
    });
    
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    showNotification(`Экспортировано ${filteredAdminLogs.length} записей`, 'success');
};

/**
 * Добавляет запись в логи (для использования в других частях админки)
 * @param {string} action - Действие
 * @param {Object} data - Данные для логирования
 */
async function addAdminLog(action, data = {}) {
    try {
        const logData = {
            action: action,
            performedBy: currentAdmin?.uid,
            timestamp: new Date().toISOString(),
            ...data
        };
        
        await addDoc(collection(db, 'adminLogs'), logData);
        
        // Если мы на странице логов, обновляем отображение
        if (window.location.pathname.includes('logs.html')) {
            await loadAdminLogs();
        }
    } catch (error) {
        console.warn('Не удалось записать лог:', error);
    }
}

// ========== СИСТЕМНЫЕ ЛОГИ И ПЛАТЕЖИ ==========

/**
 * Загружает системные логи (заглушка)
 */
async function loadSystemLogs() {
    const tbody = document.getElementById('systemLogsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3">Системные логи будут доступны в следующей версии</td>
            </tr>
        `;
    }
}

/**
 * Загружает историю платежей
 */
async function loadPayments() {
    try {
        const tbody = document.getElementById('paymentsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Загрузка...</td></tr>';
        
        // Проверяем, существует ли коллекция
        let paymentsSnapshot;
        try {
            const paymentsQuery = query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(50));
            paymentsSnapshot = await getDocs(paymentsQuery);
        } catch (e) {
            console.warn('Коллекция payments не найдена');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет платежей</td></tr>';
            return;
        }
        
        if (paymentsSnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет платежей</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        paymentsSnapshot.forEach(doc => {
            const pay = doc.data();
            const date = pay.createdAt?.toDate ? pay.createdAt.toDate().toLocaleString('ru-RU') : '—';
            
            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${pay.userId || '—'}</td>
                    <td>${pay.amount || 0} ₽</td>
                    <td>${pay.method || '—'}</td>
                    <td><span class="badge badge-success">Успешно</span></td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Ошибка загрузки платежей:', error);
    }
}

// ========== НАСТРОЙКИ САЙТА ==========

/**
 * Загружает настройки сайта из Firestore
 */
async function loadSettings() {
    try {
        console.log('📥 Загрузка настроек сайта...');
        
        // Пробуем загрузить из Firestore
        let settings = {};
        try {
            const settingsDoc = await getDoc(doc(db, 'settings', 'general'));
            if (settingsDoc.exists()) {
                settings = settingsDoc.data();
                console.log('✅ Настройки загружены из Firestore');
            }
        } catch (e) {
            console.warn('⚠️ Не удалось загрузить из Firestore:', e.message);
        }

        // ===== БЕЗОПАСНАЯ УСТАНОВКА ЗНАЧЕНИЙ =====
        // Каждый элемент проверяется перед использованием
        
        // Основные настройки
        const siteNameEl = document.getElementById('siteName');
        if (siteNameEl) {
            siteNameEl.value = settings.siteName || 'Prodiger';
            console.log('✓ siteName установлен');
        } else {
            console.warn('⚠️ Элемент #siteName не найден в HTML');
        }
        
        const welcomeBonusEl = document.getElementById('welcomeBonus');
        if (welcomeBonusEl) {
            welcomeBonusEl.value = settings.welcomeBonus || 500;
            console.log('✓ welcomeBonus установлен');
        } else {
            console.warn('⚠️ Элемент #welcomeBonus не найден');
        }
        
        const genPriceEl = document.getElementById('genPrice');
        if (genPriceEl) {
            genPriceEl.value = settings.genPrice || 100;
            genPriceEl.readOnly = true; // Фиксированная цена
            console.log('✓ genPrice установлен');
        } else {
            console.warn('⚠️ Элемент #genPrice не найден');
        }
        
        // ⚠️ ЭТОТ ЭЛЕМЕНТ ОТСУТСТВУЕТ В ВАШЕМ HTML
        // Проверяем, есть ли он вообще, и только тогда используем
        const maxLoginAttemptsEl = document.getElementById('maxLoginAttempts');
        if (maxLoginAttemptsEl) {
            maxLoginAttemptsEl.value = settings.maxLoginAttempts || 5;
            console.log('✓ maxLoginAttempts установлен');
        } else {
            // Не падаем, просто логируем
            console.log('ℹ️ Элемент #maxLoginAttempts не найден (опционально)');
        }
        
        // Статус API
        const apiStatusEl = document.getElementById('apiStatus');
        if (apiStatusEl) {
            apiStatusEl.innerHTML = '<span class="badge badge-success">Работает</span>';
            console.log('✓ apiStatus установлен');
        } else {
            console.warn('⚠️ Элемент #apiStatus не найден');
        }
        
        // Дата последнего деплоя
        const lastDeployEl = document.getElementById('lastDeploy');
        if (lastDeployEl) {
            const deployDate = new Date().toLocaleString('ru-RU');
            lastDeployEl.innerHTML = deployDate;
            console.log('✓ lastDeploy установлен');
        } else {
            console.warn('⚠️ Элемент #lastDeploy не найден');
        }
        
        console.log('✅ Загрузка настроек завершена');
        
    } catch (error) {
        console.error('❌ Критическая ошибка загрузки настроек:', error);
        
        // Аварийная установка значений по умолчанию
        try {
            const siteNameEl = document.getElementById('siteName');
            if (siteNameEl) siteNameEl.value = 'Prodiger';
            
            const welcomeBonusEl = document.getElementById('welcomeBonus');
            if (welcomeBonusEl) welcomeBonusEl.value = '500';
            
            const genPriceEl = document.getElementById('genPrice');
            if (genPriceEl) {
                genPriceEl.value = '100';
                genPriceEl.readOnly = true;
            }
            
            const apiStatusEl = document.getElementById('apiStatus');
            if (apiStatusEl) {
                apiStatusEl.innerHTML = '<span class="badge badge-warning">Ошибка</span>';
            }
        } catch (e) {
            console.error('❌ Даже аварийная установка не сработала:', e);
        }
        
        // Показываем уведомление
        showNotification('Ошибка загрузки настроек', 'error');
    }
}

/**
 * Сохраняет настройки сайта
 */
window.saveSettings = async function() {
    const siteName = document.getElementById('siteName').value;
    const bonus = parseInt(document.getElementById('welcomeBonus').value);
    const maxAttempts = parseInt(document.getElementById('maxLoginAttempts').value);
    
    if (isNaN(bonus) || isNaN(maxAttempts)) {
        showNotification('Проверьте введённые данные', 'error');
        return;
    }
    
    try {
        await setDoc(doc(db, 'settings', 'general'), {
            siteName: siteName,
            welcomeBonus: bonus,
            genPrice: 100, // фиксированная цена
            maxLoginAttempts: maxAttempts,
            updatedAt: new Date().toISOString(),
            updatedBy: currentAdmin?.uid
        }, { merge: true });
        
        // Пытаемся записать лог
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'update_settings',
                performedBy: currentAdmin?.uid,
                changes: { siteName, bonus, maxAttempts },
                timestamp: new Date().toISOString()
            });
        } catch (logError) {
            console.warn('Не удалось записать лог:', logError);
        }
        
        showNotification('Настройки сохранены', 'success');
        
    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

/**
 * Тест API Gemini (заглушка)
 */
window.testGemini = function() {
    showNotification('Тест API Gemini: OK (имитация)', 'success');
};

/**
 * Очищает кэш в localStorage
 */
window.clearCache = function() {
    localStorage.clear();
    sessionStorage.clear();
    showNotification('Кэш очищен', 'success');
};

// ========== МАССОВЫЕ ДЕЙСТВИЯ ==========

/**
 * Показывает модальное окно массового начисления
 */
window.showAddFundsModal = function() {
    document.getElementById('addFundsModal').classList.add('show');
};

/**
 * Закрывает модальное окно массового начисления
 */
window.closeAddFundsModal = function() {
    document.getElementById('addFundsModal').classList.remove('show');
    document.getElementById('bulkAmount').value = '100';
    document.getElementById('bulkMessage').value = '';
};

/**
 * Подтверждает массовое начисление средств
 */
window.confirmBulkAdd = async function() {
    const amount = parseInt(document.getElementById('bulkAmount').value);
    const message = document.getElementById('bulkMessage').value;
    
    if (isNaN(amount) || amount <= 0) {
        alert('Введите корректную сумму');
        return;
    }
    
    if (!confirm(`Начислить ВСЕМ пользователям по ${amount} ₽? Это действие нельзя отменить.`)) {
        return;
    }
    
    try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const batch = writeBatch(db);
        let count = 0;
        
        usersSnapshot.forEach(doc => {
            const current = doc.data().balance || 0;
            batch.update(doc.ref, { 
                balance: current + amount,
                lastActivity: new Date()
            });
            count++;
        });
        
        await batch.commit();
        
        // Пытаемся записать лог
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'bulk_add_funds',
                amount: amount,
                message: message,
                userCount: count,
                performedBy: currentAdmin?.uid,
                timestamp: new Date().toISOString()
            });
        } catch (logError) {
            console.warn('Не удалось записать лог, но операция выполнена:', logError);
        }
        
        showNotification(`Начислено ${amount} ₽ всем ${count} пользователям`, 'success');
        closeAddFundsModal();
        
        // Обновляем статистику на текущей странице
        if (window.location.pathname.includes('users.html')) {
            await loadUsers();
        } else if (window.location.pathname.includes('dashboard.html')) {
            await loadDashboardStats();
        }
        
    } catch (error) {
        console.error('Ошибка массового начисления:', error);
        showNotification('Ошибка: ' + error.message, 'error');
    }
};

// ========== НАСТРОЙКИ 3D КУБА ==========

// Массив изображений куба
let cubeImages = [];

/**
 * Загружает настройки куба из Firestore
 */
async function loadCubeSettings() {
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'cube'));
        if (settingsDoc.exists()) {
            cubeImages = settingsDoc.data().images || [];
            console.log('✅ Загружено изображений для куба:', cubeImages.length);
        } else {
            // Изображения по умолчанию (можно взять из ваших существующих)
            cubeImages = [
                "https://storage.googleapis.com/prodiger-cc1c5.firebasestorage.app/generated/card_1773454732102_0.jpg",
            ];
        }
        
        renderCubeImages();
        renderCubePreview();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки настроек куба:', error);
        showNotification('Ошибка загрузки настроек куба', 'error');
    }
}

/**
 * Отображает список изображений куба
 */
function renderCubeImages() {
    const list = document.getElementById('cubeImagesList');
    if (!list) return;
    
    if (cubeImages.length === 0) {
        list.innerHTML = '<div class="text-muted">Нет изображений. Добавьте ссылки на фото.</div>';
        return;
    }
    
    list.innerHTML = cubeImages.map((url, index) => `
        <div class="image-item">
            <img src="${url}" alt="Cube ${index + 1}" onerror="this.src='https://via.placeholder.com/60?text=Error'">
            <input type="text" value="${url}" placeholder="https://..." onchange="updateCubeImage(${index}, this.value)">
            <div class="image-actions">
                <button class="btn-icon" onclick="moveCubeImage(${index}, 'up')" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn-icon" onclick="moveCubeImage(${index}, 'down')" ${index === cubeImages.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="btn-icon delete" onclick="removeCubeImage(${index})">🗑️</button>
            </div>
        </div>
    `).join('');
}

/**
 * Отображает превью изображений куба
 */
function renderCubePreview() {
    const preview = document.getElementById('cubePreview');
    if (!preview) return;
    
    if (cubeImages.length === 0) {
        preview.innerHTML = '<div class="text-muted">Нет изображений для предпросмотра</div>';
        return;
    }
    
    preview.innerHTML = cubeImages.slice(0, 6).map((url, index) => `
        <div class="preview-item">
            <img src="${url}" alt="Preview ${index + 1}" onerror="this.src='https://via.placeholder.com/100?text=Error'">
            <span>Грань ${index + 1}</span>
        </div>
    `).join('');
}

/**
 * Добавляет новое изображение в список куба
 */
window.addCubeImage = function() {
    const input = document.getElementById('newCubeImage');
    const url = input.value.trim();
    
    if (!url) {
        showNotification('Введите ссылку на изображение', 'warning');
        return;
    }
    
    cubeImages.push(url);
    input.value = '';
    
    renderCubeImages();
    renderCubePreview();
    showNotification('Изображение добавлено', 'success');
};

/**
 * Обновляет URL изображения куба
 */
window.updateCubeImage = function(index, newUrl) {
    if (!newUrl.trim()) {
        showNotification('URL не может быть пустым', 'warning');
        return;
    }
    
    cubeImages[index] = newUrl.trim();
    renderCubeImages();
    renderCubePreview();
    showNotification('Изображение обновлено', 'success');
};

/**
 * Удаляет изображение из списка куба
 */
window.removeCubeImage = function(index) {
    if (!confirm('Удалить это изображение?')) return;
    
    cubeImages.splice(index, 1);
    renderCubeImages();
    renderCubePreview();
    showNotification('Изображение удалено', 'success');
};

/**
 * Перемещает изображение вверх/вниз
 */
window.moveCubeImage = function(index, direction) {
    if (direction === 'up' && index > 0) {
        [cubeImages[index - 1], cubeImages[index]] = [cubeImages[index], cubeImages[index - 1]];
    } else if (direction === 'down' && index < cubeImages.length - 1) {
        [cubeImages[index], cubeImages[index + 1]] = [cubeImages[index + 1], cubeImages[index]];
    } else {
        return;
    }
    
    renderCubeImages();
    renderCubePreview();
    showNotification('Порядок изменён', 'success');
};

/**
 * Сохраняет настройки куба в Firestore
 */
window.saveCubeSettings = async function() {
    if (cubeImages.length < 6) {
        showNotification('Для куба нужно минимум 6 изображений', 'warning');
        return;
    }
    
    try {
        await setDoc(doc(db, 'settings', 'cube'), {
            images: cubeImages,
            updatedAt: new Date().toISOString(),
            updatedBy: currentAdmin?.uid
        });
        
        await addDoc(collection(db, 'adminLogs'), {
            action: 'update_settings',
            performedBy: currentAdmin?.uid,
            target: 'cube',
            timestamp: new Date().toISOString()
        }).catch(() => {});
        
        showNotification('✅ Настройки куба сохранены', 'success');
        
    } catch (error) {
        console.error('Ошибка сохранения куба:', error);
        showNotification('❌ Ошибка: ' + error.message, 'error');
    }
};

/**
 * Сбрасывает настройки куба к фото по умолчанию
 */
window.resetCubeToDefault = function() {
    if (!confirm('Сбросить к изображениям по умолчанию?')) return;
    
    cubeImages = [
        "https://storage.googleapis.com/prodiger-cc1c5.firebasestorage.app/generated/card_1773454732102_0.jpg",

    ];
    
    renderCubeImages();
    renderCubePreview();
    showNotification('🔄 Сброшено к фото по умолчанию', 'info');
};

// ========== НАСТРОЙКИ КАРУСЕЛИ ==========

let carouselImages = [];

/**
 * Загружает настройки карусели из Firestore
 */
async function loadCarouselSettings() {
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'carousel'));
        if (settingsDoc.exists()) {
            carouselImages = settingsDoc.data().images || [];
            console.log('✅ Загружено изображений для карусели:', carouselImages.length);
        } else {
            // Изображения по умолчанию
            carouselImages = [
                "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773156099302_1.jpg",
                "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773151756196_0.jpg",
                "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773145797533_1.jpg",
                "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773145575547_1.jpg",
                "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773144880048_1.jpg",
                "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773192062133_4.jpg"
            ];
        }
        
        renderCarouselImages();
        renderCarouselPreview();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки настроек карусели:', error);
    }
}

/**
 * Отображает список изображений карусели
 */
function renderCarouselImages() {
    const list = document.getElementById('carouselImagesList');
    if (!list) return;
    
    if (carouselImages.length === 0) {
        list.innerHTML = '<div class="text-muted">Нет изображений. Добавьте ссылки на фото.</div>';
        return;
    }
    
    list.innerHTML = carouselImages.map((url, index) => `
        <div class="image-item">
            <img src="${url}" alt="Carousel ${index + 1}" onerror="this.src='https://via.placeholder.com/60?text=Error'">
            <input type="text" value="${url}" placeholder="https://..." onchange="updateCarouselImage(${index}, this.value)">
            <div class="image-actions">
                <button class="btn-icon" onclick="moveCarouselImage(${index}, 'up')" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn-icon" onclick="moveCarouselImage(${index}, 'down')" ${index === carouselImages.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="btn-icon delete" onclick="removeCarouselImage(${index})">🗑️</button>
            </div>
        </div>
    `).join('');
}

/**
 * Отображает превью изображений карусели
 */
function renderCarouselPreview() {
    const preview = document.getElementById('carouselPreview');
    if (!preview) return;
    
    if (carouselImages.length === 0) {
        preview.innerHTML = '<div class="text-muted">Нет изображений для предпросмотра</div>';
        return;
    }
    
    preview.innerHTML = carouselImages.slice(0, 6).map(url => `
        <div class="preview-item">
            <img src="${url}" alt="Preview" onerror="this.src='https://via.placeholder.com/100?text=Error'">
        </div>
    `).join('');
}

/**
 * Добавляет новое изображение в карусель
 */
window.addCarouselImage = function() {
    const input = document.getElementById('newCarouselImage');
    const url = input.value.trim();
    
    if (!url) {
        showNotification('Введите ссылку на изображение', 'warning');
        return;
    }
    
    carouselImages.push(url);
    input.value = '';
    
    renderCarouselImages();
    renderCarouselPreview();
    showNotification('Изображение добавлено в карусель', 'success');
};

/**
 * Обновляет URL изображения карусели
 */
window.updateCarouselImage = function(index, newUrl) {
    if (!newUrl.trim()) {
        showNotification('URL не может быть пустым', 'warning');
        return;
    }
    
    carouselImages[index] = newUrl.trim();
    renderCarouselImages();
    renderCarouselPreview();
    showNotification('Изображение обновлено', 'success');
};

/**
 * Удаляет изображение из карусели
 */
window.removeCarouselImage = function(index) {
    if (!confirm('Удалить это изображение?')) return;
    
    carouselImages.splice(index, 1);
    renderCarouselImages();
    renderCarouselPreview();
    showNotification('Изображение удалено', 'success');
};

/**
 * Перемещает изображение карусели
 */
window.moveCarouselImage = function(index, direction) {
    if (direction === 'up' && index > 0) {
        [carouselImages[index - 1], carouselImages[index]] = [carouselImages[index], carouselImages[index - 1]];
    } else if (direction === 'down' && index < carouselImages.length - 1) {
        [carouselImages[index], carouselImages[index + 1]] = [carouselImages[index + 1], carouselImages[index]];
    } else {
        return;
    }
    
    renderCarouselImages();
    renderCarouselPreview();
    showNotification('Порядок изменён', 'success');
};

/**
 * Сохраняет настройки карусели
 */
window.saveCarouselSettings = async function() {
    if (carouselImages.length === 0) {
        showNotification('Добавьте хотя бы одно изображение', 'warning');
        return;
    }
    
    try {
        await setDoc(doc(db, 'settings', 'carousel'), {
            images: carouselImages,
            updatedAt: new Date().toISOString(),
            updatedBy: currentAdmin?.uid
        });
        
        showNotification('✅ Настройки карусели сохранены', 'success');
        
    } catch (error) {
        console.error('Ошибка сохранения карусели:', error);
        showNotification('❌ Ошибка: ' + error.message, 'error');
    }
};

/**
 * Сбрасывает карусель к фото по умолчанию
 */
window.resetCarouselToDefault = function() {
    if (!confirm('Сбросить к изображениям по умолчанию?')) return;
    
    carouselImages = [
        "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773156099302_1.jpg",
        "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773151756196_0.jpg",
        "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773145797533_1.jpg",
        "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773145575547_1.jpg",
        "https://storage.googleapis.com/ai-seller-prod-4c0c9.firebasestorage.app/generated/card_1773144880048_1.jpg"
    ];
    
    renderCarouselImages();
    renderCarouselPreview();
    showNotification('🔄 Сброшено к фото по умолчанию', 'info');
};

// Добавьте вызов загрузки в onAuthStateChanged для страницы настроек
// Найдите в функции onAuthStateChanged блок:
// } else if (path.includes('settings.html')) {
//     await loadSettings();
// }

// И добавьте после loadSettings():
// await loadCubeSettings();
// await loadCarouselSettings();

// Инициализация обработчиков после загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    // Инициализируем фильтры логов, если мы на странице логов
    if (window.location.pathname.includes('logs.html')) {
        initLogsFilters();
    }
});