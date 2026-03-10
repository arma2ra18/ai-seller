import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { 
    collection, getDocs, query, orderBy, limit, doc, getDoc, 
    updateDoc, deleteDoc, setDoc, addDoc, where
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

let currentAdmin = null;
let currentPage = 1;
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
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
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
        } else if (path.includes('users.html')) {
            await loadUsers();
        } else if (path.includes('logs.html')) {
            await loadPayments();
            await loadGenerations();
            await loadAdminLogs();
        }
    } catch (error) {
        console.error('Error loading page data:', error);
        showError('Ошибка загрузки данных: ' + error.message);
    }
});

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'notification error';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

// ========== ВЫХОД ==========
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/admin/index.html';
};

// ========== ДАШБОРД ==========
async function loadDashboardStats() {
    try {
        console.log('Loading dashboard stats...');
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersCount = usersSnapshot.size;
        
        let totalRevenue = 0;
        const paymentsSnapshot = await getDocs(collection(db, 'payments'));
        paymentsSnapshot.forEach(doc => {
            totalRevenue += doc.data().amount || 0;
        });
        
        let totalGenerations = 0;
        for (const userDoc of usersSnapshot.docs) {
            const gensSnapshot = await getDocs(collection(db, 'users', userDoc.id, 'generations'));
            totalGenerations += gensSnapshot.size;
        }
        
        const adminSnapshot = await getDocs(collection(db, 'admins'));
        const adminCount = adminSnapshot.size;
        
        document.getElementById('totalUsers').textContent = usersCount;
        document.getElementById('totalRevenue').textContent = totalRevenue.toLocaleString() + ' ₽';
        document.getElementById('totalGenerations').textContent = totalGenerations;
        document.getElementById('adminCount').textContent = adminCount;
        
        console.log('Stats loaded:', { usersCount, totalRevenue, totalGenerations, adminCount });
        
    } catch (error) {
        console.error('Error loading stats:', error);
        throw error;
    }
}

async function loadRecentActivity() {
    try {
        console.log('Loading recent activity...');
        const list = document.getElementById('activityList');
        if (!list) return;
        
        list.innerHTML = '<li class="activity-item"><span>Загрузка...</span></li>';
        
        const logsQuery = query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(10));
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
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                }) : 'недавно';
            
            list.innerHTML += `
                <li class="activity-item">
                    <span>${log.action || 'Действие'}: ${log.targetUser || log.targetEmail || log.targetUserId || 'система'}</span>
                    <span>${time}</span>
                </li>
            `;
        });
        
    } catch (error) {
        console.error('Error loading activity:', error);
        const list = document.getElementById('activityList');
        if (list) list.innerHTML = '<li class="activity-item"><span>Ошибка загрузки</span></li>';
    }
}

// ========== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ==========
window.loadUsers = async function(page = 1) {
    currentPage = page;
    try {
        console.log('Loading users page', page);
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Загрузка...</td></tr>';
        
        const usersRef = collection(db, 'users');
        const q = query(usersRef, orderBy('createdAt', 'desc'), limit(pageSize));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Нет пользователей</td></tr>';
            return;
        }
        
        const adminSnapshot = await getDocs(collection(db, 'admins'));
        const adminIds = new Set(adminSnapshot.docs.map(doc => doc.id));
        
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const user = doc.data();
            const date = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : 'неизвестно';
            const isAdmin = adminIds.has(doc.id) ? '👑' : '';
            
            tbody.innerHTML += `
                <tr>
                    <td>${user.email || '—'}</td>
                    <td>${user.displayName || '—'}</td>
                    <td>${user.phoneNumber || '—'}</td>
                    <td><span class="badge badge-${user.plan || 'start'}">${user.plan || 'start'} ${isAdmin}</span></td>
                    <td>${user.balance || 0}</td>
                    <td>${user.usedGenerations || 0}</td>
                    <td>${date}</td>
                    <td class="user-actions">
                        <button class="btn btn-small" onclick="editUser('${doc.id}')">✏️</button>
                        <button class="btn btn-small" onclick="addTokens('${doc.id}')">➕</button>
                    </td>
                </tr>
            `;
        });
        
        console.log('Users loaded:', snapshot.size);
        updatePagination();
        
    } catch (error) {
        console.error('Error loading users:', error);
        const tbody = document.getElementById('usersTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">Ошибка загрузки: ' + error.message + '</td></tr>';
    }
};

function updatePagination() {
    const pagination = document.getElementById('pagination');
    if (pagination) {
        pagination.innerHTML = `
            <button onclick="loadUsers(${currentPage-1})" ${currentPage <= 1 ? 'disabled' : ''}>← Назад</button>
            <span> Страница ${currentPage} </span>
            <button onclick="loadUsers(${currentPage+1})">Вперёд →</button>
        `;
    }
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
        document.getElementById('editPlan').value = user.plan || 'start';
        document.getElementById('editBalance').value = user.balance || 0;
        
        const adminDoc = await getDoc(doc(db, 'admins', userId));
        document.getElementById('editIsAdmin').checked = adminDoc.exists();
        
        document.getElementById('userModal').classList.add('show');
        
    } catch (error) {
        console.error('Error loading user for edit:', error);
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
            plan: document.getElementById('editPlan').value,
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
            await deleteDoc(adminRef);
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
        console.error('Error saving user:', error);
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
        await deleteDoc(doc(db, 'admins', currentEditUserId));
        
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
        console.error('Error deleting user:', error);
        alert('Ошибка удаления: ' + error.message);
    }
};

window.addTokens = async function(userId) {
    const amount = prompt('Введите количество токенов для начисления:');
    if (!amount) return;
    
    const tokens = parseInt(amount);
    if (isNaN(tokens) || tokens <= 0) {
        alert('Введите положительное число');
        return;
    }
    
    try {
        const userRef = doc(db, 'users', userId);
        const userDoc = await getDoc(userRef);
        const currentBalance = userDoc.data().balance || 0;
        
        await updateDoc(userRef, {
            balance: currentBalance + tokens
        });
        
        await addDoc(collection(db, 'adminLogs'), {
            action: 'add_tokens',
            targetUserId: userId,
            amount: tokens,
            performedBy: currentAdmin?.uid || 'unknown',
            timestamp: new Date().toISOString()
        });
        
        alert(`Начислено ${tokens} токенов`);
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Error adding tokens:', error);
        alert('Ошибка: ' + error.message);
    }
};

window.searchUsers = async function() {
    const searchTerm = document.getElementById('userSearch').value.toLowerCase();
    if (!searchTerm) {
        loadUsers();
        return;
    }
    
    try {
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);
        
        const filtered = snapshot.docs.filter(doc => {
            const data = doc.data();
            return (data.email && data.email.toLowerCase().includes(searchTerm)) ||
                   (data.displayName && data.displayName.toLowerCase().includes(searchTerm)) ||
                   (data.phoneNumber && data.phoneNumber.includes(searchTerm));
        });
        
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">Ничего не найдено</td></tr>';
            return;
        }
        
        filtered.forEach(doc => {
            const user = doc.data();
            const date = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : 'неизвестно';
            
            tbody.innerHTML += `
                <tr>
                    <td>${user.email || '—'}</td>
                    <td>${user.displayName || '—'}</td>
                    <td>${user.phoneNumber || '—'}</td>
                    <td><span class="badge badge-${user.plan || 'start'}">${user.plan || 'start'}</span></td>
                    <td>${user.balance || 0}</td>
                    <td>${user.usedGenerations || 0}</td>
                    <td>${date}</td>
                    <td class="user-actions">
                        <button class="btn btn-small" onclick="editUser('${doc.id}')">✏️</button>
                        <button class="btn btn-small" onclick="addTokens('${doc.id}')">➕</button>
                    </td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Error searching users:', error);
        alert('Ошибка поиска: ' + error.message);
    }
};

window.exportUsersCSV = function() {
    alert('Функция экспорта будет добавлена позже');
};

// ========== ЛОГИ ==========
let currentLogTab = 'payments';

window.showLogTab = function(tab) {
    currentLogTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    const tabButton = document.querySelector(`[onclick="showLogTab('${tab}')"]`);
    if (tabButton) tabButton.classList.add('active');
    
    const tabContent = document.getElementById(`${tab}-tab`);
    if (tabContent) tabContent.classList.add('active');
};

async function loadPayments() {
    try {
        const tbody = document.getElementById('paymentsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Загрузка...</td></tr>';
        
        const paymentsRef = collection(db, 'payments');
        const q = query(paymentsRef, orderBy('createdAt', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет платежей</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const payment = doc.data();
            const date = payment.createdAt ? 
                (payment.createdAt.toDate ? payment.createdAt.toDate().toLocaleString('ru-RU') : payment.createdAt) 
                : 'неизвестно';
            
            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${payment.userId || '—'}</td>
                    <td>${payment.amount || 0} ₽</td>
                    <td>${payment.tokens || 0}</td>
                    <td><span class="badge badge-success">Успешно</span></td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Error loading payments:', error);
        const tbody = document.getElementById('paymentsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5">Ошибка загрузки: ' + error.message + '</td></tr>';
    }
}

async function loadGenerations() {
    try {
        const tbody = document.getElementById('generationsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Загрузка...</td></tr>';
        
        const usersSnapshot = await getDocs(collection(db, 'users'));
        let generations = [];
        
        for (const userDoc of usersSnapshot.docs) {
            const gensRef = collection(db, 'users', userDoc.id, 'generations');
            const gensSnapshot = await getDocs(query(gensRef, orderBy('timestamp', 'desc'), limit(5)));
            
            gensSnapshot.forEach(genDoc => {
                generations.push({
                    ...genDoc.data(),
                    userId: userDoc.id,
                    userEmail: userDoc.data().email
                });
            });
        }
        
        // Сортируем по дате
        generations.sort((a, b) => {
            const dateA = a.timestamp ? new Date(a.timestamp) : 0;
            const dateB = b.timestamp ? new Date(b.timestamp) : 0;
            return dateB - dateA;
        });
        
        generations = generations.slice(0, 50);
        
        if (generations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Нет генераций</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        generations.forEach(gen => {
            const date = gen.timestamp ? new Date(gen.timestamp).toLocaleString('ru-RU') : 'неизвестно';
            
            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${gen.userEmail || gen.userId || '—'}</td>
                    <td>${gen.productName || '—'}</td>
                    <td>${gen.type || 'генерация'}</td>
                    <td>3</td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Error loading generations:', error);
        const tbody = document.getElementById('generationsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5">Ошибка загрузки: ' + error.message + '</td></tr>';
    }
}

async function loadAdminLogs() {
    try {
        const tbody = document.getElementById('adminLogsTableBody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Загрузка...</td></tr>';
        
        const logsRef = collection(db, 'adminLogs');
        const q = query(logsRef, orderBy('timestamp', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Нет логов</td></tr>';
            return;
        }
        
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const log = doc.data();
            const date = log.timestamp ? new Date(log.timestamp).toLocaleString('ru-RU') : 'неизвестно';
            
            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${log.performedBy || 'система'}</td>
                    <td>${log.action || '—'}</td>
                    <td>${log.targetUser || log.targetUserId || '—'}</td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Error loading admin logs:', error);
        const tbody = document.getElementById('adminLogsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="4">Ошибка загрузки: ' + error.message + '</td></tr>';
    }
}
// Добавьте это временно в конец файла для теста
window.testCollection = async function() {
    try {
        const snapshot = await getDocs(collection(db, 'users'));
        console.log('Всего документов:', snapshot.size);
        snapshot.forEach(doc => console.log('Документ:', doc.id, doc.data()));
    } catch (error) {
        console.error('Ошибка:', error);
    }
};

// Вызовите в консоли браузера: testCollection()