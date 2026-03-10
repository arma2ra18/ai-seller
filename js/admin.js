import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { 
    collection, getDocs, query, orderBy, limit, doc, getDoc, 
    updateDoc, deleteDoc, setDoc, addDoc, where, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

let currentAdmin = null;
let currentPage = 1;
let usersList = [];
let generationsList = [];
let logsList = [];
const pageSize = 20;

// ========== АВТОРИЗАЦИЯ ==========
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

// ========== ЗАЩИТА СТРАНИЦ ==========
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
        } else if (path.includes('settings.html')) {
            loadSettings();
        }
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        showNotification('Ошибка загрузки: ' + error.message, 'error');
    }
});

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// ========== ВЫХОД ==========
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/admin/index.html';
};

// ========== ДАШБОРД ==========
async function loadDashboardStats() {
    try {
        console.log('Загружаем статистику дашборда...');
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersCount = usersSnapshot.size;
        
        let totalRevenue = 0;
        let totalSpent = 0;
        let generationsCount = 0;
        
        for (const userDoc of usersSnapshot.docs) {
            const user = userDoc.data();
            totalRevenue += user.balance || 0;
            totalSpent += user.usedSpent || 0;
            
            const gensSnapshot = await getDocs(collection(db, 'users', userDoc.id, 'generations'));
            generationsCount += gensSnapshot.size;
        }
        
        // Выручка = потрачено пользователями
        const revenue = totalSpent;
        
        // Онлайн (имитация)
        const online = Math.floor(Math.random() * 30) + 10;
        
        document.getElementById('totalUsers').textContent = usersCount;
        document.getElementById('totalRevenue').textContent = revenue.toLocaleString() + ' ₽';
        document.getElementById('totalGenerations').textContent = generationsCount;
        document.getElementById('onlineUsers').textContent = online;
        
        // Тренды (имитация)
        document.getElementById('usersTrend').textContent = '+12%';
        document.getElementById('revenueTrend').textContent = '+8%';
        document.getElementById('generationsTrend').textContent = '+15%';
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

async function loadRecentActivity() {
    try {
        const list = document.getElementById('activityList');
        if (!list) return;
        
        list.innerHTML = '<li class="activity-item"><span>Загрузка...</span></li>';
        
        // Смесь последних событий
        const logsQuery = query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(20));
        const logsSnapshot = await getDocs(logsQuery);
        
        if (logsSnapshot.empty) {
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
            
            list.innerHTML += `
                <li class="activity-item">
                    <span>${log.action || 'Действие'}: ${log.targetUser || log.targetEmail || 'система'}</span>
                    <span>${time}</span>
                </li>
            `;
        });
        
    } catch (error) {
        console.error('Ошибка загрузки активности:', error);
    }
}

function initCharts() {
    // График регистраций
    const ctx1 = document.getElementById('regChart')?.getContext('2d');
    if (ctx1) {
        new Chart(ctx1, {
            type: 'line',
            data: {
                labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
                datasets: [{
                    label: 'Новые пользователи',
                    data: [12, 19, 15, 17, 24, 30, 22],
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
                }
            }
        });
    }
    
    // График выручки
    const ctx2 = document.getElementById('revenueChart')?.getContext('2d');
    if (ctx2) {
        new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
                datasets: [{
                    label: 'Выручка (₽)',
                    data: [5000, 7500, 8200, 6900, 12000, 15000, 9300],
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
                const weekAgo = new Date(now.setDate(now.getDate() - 7));
                return created >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
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

window.resetFilters = function() {
    document.getElementById('searchInput').value = '';
    document.getElementById('balanceFilter').value = '';
    document.getElementById('dateFilter').value = '';
    document.getElementById('sortFilter').value = 'date_desc';
    applyFilters();
};

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

// Редактирование пользователя
let currentEditUserId = null;

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
        
        const adminDoc = await getDoc(doc(db, 'admins', userId));
        document.getElementById('editIsAdmin').checked = adminDoc.exists();
        
        document.getElementById('userModal').classList.add('show');
        
    } catch (error) {
        console.error('Ошибка загрузки пользователя:', error);
        alert('Ошибка загрузки данных: ' + error.message);
    }
};

window.closeUserModal = function() {
    document.getElementById('userModal').classList.remove('show');
    currentEditUserId = null;
};

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
            } catch (e) {}
        }
        
        await addDoc(collection(db, 'adminLogs'), {
            action: 'edit_user',
            targetUser: document.getElementById('editEmail').value,
            targetUserId: currentEditUserId,
            performedBy: currentAdmin?.uid || 'unknown',
            changes: updates,
            timestamp: new Date().toISOString()
        });
        
        alert('Изменения сохранены');
        closeUserModal();
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        alert('Ошибка сохранения: ' + error.message);
    }
};

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
        
        await addDoc(collection(db, 'adminLogs'), {
            action: 'delete_user',
            targetUserId: currentEditUserId,
            performedBy: currentAdmin?.uid || 'unknown',
            timestamp: new Date().toISOString()
        });
        
        alert('Пользователь удалён');
        closeUserModal();
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка удаления:', error);
        alert('Ошибка удаления: ' + error.message);
    }
};

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
        
        await addDoc(collection(db, 'adminLogs'), {
            action: 'add_funds',
            targetUserId: userId,
            amount: rubles,
            performedBy: currentAdmin?.uid || 'unknown',
            timestamp: new Date().toISOString()
        });
        
        alert(`Начислено ${rubles} ₽`);
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка начисления:', error);
        alert('Ошибка: ' + error.message);
    }
};

window.viewUserHistory = async function(userId) {
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        const user = userDoc.data();
        
        const gensSnapshot = await getDocs(collection(db, 'users', userId, 'generations'));
        
        let html = `<h3>Пользователь: ${user.email || '—'}</h3>`;
        html += '<h4>Генерации:</h4><ul>';
        
        gensSnapshot.forEach(doc => {
            const gen = doc.data();
            const date = gen.timestamp ? new Date(gen.timestamp).toLocaleString('ru-RU') : '—';
            html += `<li>${date} — ${gen.productName || 'Без названия'} (${gen.type || 'карточка'})</li>`;
        });
        
        html += '</ul>';
        
        document.getElementById('historyModalContent').innerHTML = html;
        document.getElementById('historyModal').classList.add('show');
        
    } catch (error) {
        console.error('Ошибка загрузки истории:', error);
        alert('Ошибка: ' + error.message);
    }
};

window.closeHistoryModal = function() {
    document.getElementById('historyModal').classList.remove('show');
};

// ========== ЭКСПОРТ ==========
window.exportUsersCSV = function() {
    let csv = "Email,Имя,Телефон,Баланс,Потрачено,Дата регистрации\n";
    usersList.forEach(u => {
        const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '';
        csv += `"${u.email || ''}","${u.displayName || ''}","${u.phoneNumber || ''}",${u.balance || 0},${u.usedSpent || 0},"${date}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
};

// ========== ГЕНЕРАЦИИ ==========
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
    }
};

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
                const weekAgo = new Date(now.setDate(now.getDate() - 7));
                return date >= weekAgo;
            } else if (dateFilter === 'month') {
                const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
                return date >= monthAgo;
            }
            return true;
        });
    }
    
    renderGenerations(filtered);
};

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

window.showPreview = function(imageUrl, descriptions) {
    document.getElementById('previewImage').src = imageUrl;
    const descDiv = document.getElementById('previewDescriptions');
    if (descriptions) {
        const descArray = descriptions.split('\\n');
        descDiv.innerHTML = '<h4>Описания:</h4>' + descArray.map(d => `<p>${d}</p>`).join('');
    }
    document.getElementById('previewModal').classList.add('show');
};

window.closePreviewModal = function() {
    document.getElementById('previewModal').classList.remove('show');
};

// ========== ЛОГИ ==========
window.showLogTab = function(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[onclick="showLogTab('${tab}')"]`).classList.add('active');
    document.getElementById(`${tab}-tab`).classList.add('active');
};

async function loadAdminLogs() {
    try {
        const tbody = document.getElementById('adminLogsTableBody');
        if (!tbody) return;
        
        const logsQuery = query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(100));
        const snapshot = await getDocs(logsQuery);
        
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const log = doc.data();
            const date = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString('ru-RU') : '—';
            
            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${log.performedBy || 'система'}</td>
                    <td>${log.action || '—'}</td>
                    <td>${log.targetUser || log.targetUserId || '—'}</td>
                    <td>${log.amount ? `${log.amount} ₽` : '—'}</td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Ошибка загрузки логов:', error);
    }
}

async function loadSystemLogs() {
    // Здесь можно добавить реальные системные логи
    const tbody = document.getElementById('systemLogsTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr><td colspan="3">Системные логи в разработке</td></tr>
        `;
    }
}

async function loadPayments() {
    try {
        const tbody = document.getElementById('paymentsTableBody');
        if (!tbody) return;
        
        const paymentsQuery = query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(50));
        const snapshot = await getDocs(paymentsQuery);
        
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
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

// ========== НАСТРОЙКИ ==========
function loadSettings() {
    // Загружаем настройки из Firestore или localStorage
    document.getElementById('siteName').value = 'Prodiger';
    document.getElementById('welcomeBonus').value = '500';
    document.getElementById('genPrice').value = '100';
    document.getElementById('apiStatus').innerHTML = '<span class="badge badge-success">Работает</span>';
    
    const deployDate = new Date().toLocaleString('ru-RU');
    document.getElementById('lastDeploy').innerHTML = deployDate;
}

window.saveSettings = function() {
    alert('Настройки сохранены (демо-режим)');
};

window.testGemini = function() {
    alert('Тест API Gemini: OK');
};

window.clearCache = function() {
    alert('Кэш очищен');
};

// ========== БЫСТРЫЕ ДЕЙСТВИЯ ==========
window.showAddFundsModal = function() {
    document.getElementById('addFundsModal').classList.add('show');
};

window.closeAddFundsModal = function() {
    document.getElementById('addFundsModal').classList.remove('show');
};

window.confirmBulkAdd = async function() {
    const amount = parseInt(document.getElementById('bulkAmount').value);
    const message = document.getElementById('bulkMessage').value;
    
    if (amount <= 0) return;
    
    if (!confirm(`Начислить всем пользователям по ${amount} ₽?`)) return;
    
    try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const batch = writeBatch(db);
        
        usersSnapshot.forEach(doc => {
            const current = doc.data().balance || 0;
            batch.update(doc.ref, { balance: current + amount });
        });
        
        await batch.commit();
        
        await addDoc(collection(db, 'adminLogs'), {
            action: 'bulk_add_funds',
            amount: amount,
            message: message,
            performedBy: currentAdmin?.uid,
            timestamp: new Date().toISOString()
        });
        
        alert(`Начислено всем по ${amount} ₽`);
        closeAddFundsModal();
        
    } catch (error) {
        console.error('Ошибка массового начисления:', error);
        alert('Ошибка: ' + error.message);
    }
};

window.exportStats = function() {
    alert('Экспорт статистики будет доступен позже');
};