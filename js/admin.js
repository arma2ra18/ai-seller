import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { 
    collection, getDocs, query, orderBy, limit, doc, getDoc, 
    updateDoc, deleteDoc, where, writeBatch
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
    document.getElementById('adminEmail').textContent = user.email;
    
    const token = await user.getIdTokenResult();
    if (!token.claims || !token.claims.admin) {
        alert('У вас нет прав доступа');
        await signOut(auth);
        window.location.href = '/admin/index.html';
    }
    
    // Загружаем данные в зависимости от страницы
    if (path.includes('dashboard.html')) {
        loadDashboardStats();
        loadRecentActivity();
    } else if (path.includes('users.html')) {
        loadUsers();
    } else if (path.includes('logs.html')) {
        loadPayments();
        loadGenerations();
        loadAdminLogs();
    }
});

// ========== ВЫХОД ==========
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/admin/index.html';
};

// ========== ДАШБОРД ==========
async function loadDashboardStats() {
    try {
        // Собираем статистику
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersCount = usersSnapshot.size;
        
        // Подсчёт выручки (из коллекции payments)
        let totalRevenue = 0;
        const paymentsSnapshot = await getDocs(collection(db, 'payments'));
        paymentsSnapshot.forEach(doc => {
            totalRevenue += doc.data().amount || 0;
        });
        
        // Подсчёт генераций
        let totalGenerations = 0;
        for (const userDoc of usersSnapshot.docs) {
            const gensSnapshot = await getDocs(collection(db, 'users', userDoc.id, 'generations'));
            totalGenerations += gensSnapshot.size;
        }
        
        // Подсчёт админов
        const adminSnapshot = await getDocs(collection(db, 'admins'));
        const adminCount = adminSnapshot.size;
        
        document.getElementById('totalUsers').textContent = usersCount;
        document.getElementById('totalRevenue').textContent = totalRevenue.toLocaleString() + ' ₽';
        document.getElementById('totalGenerations').textContent = totalGenerations;
        document.getElementById('adminCount').textContent = adminCount;
        
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadRecentActivity() {
    try {
        // Смесь последних действий (платежи, генерации, логи админов)
        const list = document.getElementById('activityList');
        list.innerHTML = '';
        
        // Берём последние 10 записей из adminLogs
        const logsQuery = query(collection(db, 'adminLogs'), orderBy('timestamp', 'desc'), limit(10));
        const logsSnapshot = await getDocs(logsQuery);
        
        logsSnapshot.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp?.toDate().toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            }) || 'недавно';
            
            list.innerHTML += `
                <li class="activity-item">
                    <span>${log.action}: ${log.targetUser || log.targetEmail || 'система'}</span>
                    <span>${time}</span>
                </li>
            `;
        });
        
    } catch (error) {
        console.error('Error loading activity:', error);
    }
}

// ========== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ==========
window.loadUsers = async function(page = 1) {
    currentPage = page;
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, orderBy('createdAt', 'desc'), limit(pageSize));
        const snapshot = await getDocs(q);
        
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';
        
        // Загружаем список админов для проверки
        const adminSnapshot = await getDocs(collection(db, 'admins'));
        const adminIds = new Set(adminSnapshot.docs.map(doc => doc.id));
        
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
        
        // Простая пагинация (можно доработать)
        updatePagination();
        
    } catch (error) {
        console.error('Error loading users:', error);
        document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="8">Ошибка загрузки</td></tr>';
    }
};

function updatePagination() {
    // Здесь можно добавить сложную логику пагинации, пока просто заглушка
    const pagination = document.getElementById('pagination');
    if (pagination) {
        pagination.innerHTML = `
            <button onclick="loadUsers(${currentPage-1})" ${currentPage <= 1 ? 'disabled' : ''}>←</button>
            <span>Страница ${currentPage}</span>
            <button onclick="loadUsers(${currentPage+1})">→</button>
        `;
    }
}

// Редактирование пользователя
let currentEditUserId = null;

window.editUser = async function(userId) {
    currentEditUserId = userId;
    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        const user = userDoc.data();
        
        document.getElementById('editEmail').value = user.email || '';
        document.getElementById('editDisplayName').value = user.displayName || '';
        document.getElementById('editPhone').value = user.phoneNumber || '';
        document.getElementById('editPlan').value = user.plan || 'start';
        document.getElementById('editBalance').value = user.balance || 0;
        
        // Проверяем, является ли пользователь админом
        const adminDoc = await getDoc(doc(db, 'admins', userId));
        document.getElementById('editIsAdmin').checked = adminDoc.exists();
        
        document.getElementById('userModal').classList.add('show');
        
    } catch (error) {
        console.error('Error loading user for edit:', error);
        alert('Ошибка загрузки данных');
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
        
        // Управление правами админа
        const isAdmin = document.getElementById('editIsAdmin').checked;
        const adminRef = doc(db, 'admins', currentEditUserId);
        
        if (isAdmin) {
            await setDoc(adminRef, { 
                email: document.getElementById('editEmail').value,
                grantedBy: currentAdmin.uid,
                grantedAt: new Date().toISOString()
            });
        } else {
            await deleteDoc(adminRef);
        }
        
        // Логируем действие
        await addDoc(collection(db, 'adminLogs'), {
            action: 'edit_user',
            targetUser: document.getElementById('editEmail').value,
            targetUserId: currentEditUserId,
            performedBy: currentAdmin.uid,
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
        // Удаляем из Firestore
        await deleteDoc(doc(db, 'users', currentEditUserId));
        // Удаляем из списка админов, если был
        await deleteDoc(doc(db, 'admins', currentEditUserId));
        
        // Логируем
        await addDoc(collection(db, 'adminLogs'), {
            action: 'delete_user',
            targetUserId: currentEditUserId,
            performedBy: currentAdmin.uid,
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
        
        // Логируем
        await addDoc(collection(db, 'adminLogs'), {
            action: 'add_tokens',
            targetUserId: userId,
            amount: tokens,
            performedBy: currentAdmin.uid,
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
    
    document.querySelector(`[onclick="showLogTab('${tab}')"]`).classList.add('active');
    document.getElementById(`${tab}-tab`).classList.add('active');
};

async function loadPayments() {
    try {
        const paymentsRef = collection(db, 'payments');
        const q = query(paymentsRef, orderBy('createdAt', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        
        const tbody = document.getElementById('paymentsTableBody');
        tbody.innerHTML = '';
        
        snapshot.forEach(doc => {
            const payment = doc.data();
            const date = payment.createdAt ? new Date(payment.createdAt).toLocaleString('ru-RU') : 'неизвестно';
            
            // Получаем email пользователя
            let userEmail = 'Неизвестно';
            if (payment.userId) {
                // Можно добавить асинхронную загрузку, но для скорости оставим так
                userEmail = payment.userId;
            }
            
            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${userEmail}</td>
                    <td>${payment.amount || 0} ₽</td>
                    <td>${payment.tokens || 0}</td>
                    <td><span class="badge badge-success">Успешно</span></td>
                </tr>
            `;
        });
        
    } catch (error) {
        console.error('Error loading payments:', error);
    }
}

async function loadGenerations() {
    try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const tbody = document.getElementById('generationsTableBody');
        tbody.innerHTML = '';
        
        let count = 0;
        for (const userDoc of usersSnapshot.docs) {
            if (count >= 50) break;
            
            const gensRef = collection(db, 'users', userDoc.id, 'generations');
            const gensSnapshot = await getDocs(query(gensRef, orderBy('timestamp', 'desc'), limit(10)));
            
            gensSnapshot.forEach(genDoc => {
                if (count >= 50) return;
                const gen = genDoc.data();
                const date = gen.timestamp ? new Date(gen.timestamp).toLocaleString('ru-RU') : 'неизвестно';
                
                tbody.innerHTML += `
                    <tr>
                        <td>${date}</td>
                        <td>${userDoc.data().email || 'Неизвестно'}</td>
                        <td>${gen.productName || '—'}</td>
                        <td>${gen.type || 'генерация'}</td>
                        <td>3</td>
                    </tr>
                `;
                count++;
            });
        }
        
    } catch (error) {
        console.error('Error loading generations:', error);
    }
}

async function loadAdminLogs() {
    try {
        const logsRef = collection(db, 'adminLogs');
        const q = query(logsRef, orderBy('timestamp', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        
        const tbody = document.getElementById('adminLogsTableBody');
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
    }
}