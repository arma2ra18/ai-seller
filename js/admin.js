import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword, 
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { 
    collection, getDocs, query, orderBy, limit, doc, getDoc, 
    updateDoc, deleteDoc, setDoc, addDoc
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
            console.log('Загружаем дашборд...');
            await loadDashboardStats();
            await loadRecentActivity();
        } else if (path.includes('users.html')) {
            console.log('Загружаем пользователей...');
            await loadUsers();
        } else if (path.includes('logs.html')) {
            console.log('Загружаем логи...');
            await loadPayments();
            await loadGenerations();
            await loadAdminLogs();
        }
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
        showError('Ошибка загрузки: ' + error.message);
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
        console.log('Загружаем статистику...');
        
        // Проверяем, есть ли коллекция users
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersCount = usersSnapshot.size;
        console.log('Найдено пользователей:', usersCount);
        
        // Платежи (если есть)
        let totalRevenue = 0;
        try {
            const paymentsSnapshot = await getDocs(collection(db, 'payments'));
            paymentsSnapshot.forEach(doc => {
                totalRevenue += doc.data().amount || 0;
            });
        } catch (e) {
            console.log('Коллекция payments не найдена или пуста');
        }
        
        // Генерации (если есть)
        let totalGenerations = 0;
        try {
            for (const userDoc of usersSnapshot.docs) {
                const gensSnapshot = await getDocs(collection(db, 'users', userDoc.id, 'generations'));
                totalGenerations += gensSnapshot.size;
            }
        } catch (e) {
            console.log('Подколлекции generations не найдены');
        }
        
        // Админы
        let adminCount = 0;
        try {
            const adminSnapshot = await getDocs(collection(db, 'admins'));
            adminCount = adminSnapshot.size;
        } catch (e) {
            console.log('Коллекция admins не найдена');
        }
        
        // Обновляем UI
        const totalUsersEl = document.getElementById('totalUsers');
        if (totalUsersEl) totalUsersEl.textContent = usersCount;
        
        const totalRevenueEl = document.getElementById('totalRevenue');
        if (totalRevenueEl) totalRevenueEl.textContent = totalRevenue.toLocaleString() + ' ₽';
        
        const totalGenerationsEl = document.getElementById('totalGenerations');
        if (totalGenerationsEl) totalGenerationsEl.textContent = totalGenerations;
        
        const adminCountEl = document.getElementById('adminCount');
        if (adminCountEl) adminCountEl.textContent = adminCount;
        
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

async function loadRecentActivity() {
    try {
        const list = document.getElementById('activityList');
        if (!list) return;
        
        list.innerHTML = '<li class="activity-item"><span>Загрузка...</span></li>';
        
        try {
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
                        <span>${log.action || 'Действие'}: ${log.targetUser || log.targetEmail || 'система'}</span>
                        <span>${time}</span>
                    </li>
                `;
            });
        } catch (e) {
            console.log('adminLogs не найдены');
            list.innerHTML = '<li class="activity-item"><span>Нет логов</span></li>';
        }
        
    } catch (error) {
        console.error('Ошибка загрузки активности:', error);
    }
}

// ========== УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ==========
window.loadUsers = async function(page = 1) {
    currentPage = page;
    try {
        console.log('🔄 Загрузка пользователей, страница', page);
        
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) {
            console.error('❌ Элемент #usersTableBody не найден');
            return;
        }
        
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">⏳ Загрузка...</td></tr>';
        
        // Пробуем получить коллекцию users
        const usersRef = collection(db, 'users');
        console.log('📁 Ссылка на коллекцию:', usersRef.path);
        
        // Сначала просто проверим, есть ли хоть что-то
        const testSnapshot = await getDocs(usersRef);
        console.log('📊 Всего документов в коллекции:', testSnapshot.size);
        
        if (testSnapshot.empty) {
            console.log('ℹ️ Коллекция users пуста');
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">Нет пользователей</td></tr>';
            return;
        }
        
        // Покажем первые 3 документа в консоль для проверки
        testSnapshot.docs.slice(0, 3).forEach(doc => {
            console.log('📄 Пример документа:', doc.id, doc.data());
        });
        
        // Теперь делаем запрос с сортировкой (если есть поле createdAt)
        let q;
        try {
            q = query(usersRef, orderBy('createdAt', 'desc'), limit(pageSize));
            console.log('🔍 Запрос с сортировкой по createdAt');
        } catch (e) {
            console.log('⚠️ Поле createdAt отсутствует, запрос без сортировки');
            q = query(usersRef, limit(pageSize));
        }
        
        const snapshot = await getDocs(q);
        console.log('✅ Запрос выполнен, документов:', snapshot.size);
        
        // Получаем список админов
        let adminIds = new Set();
        try {
            const adminSnapshot = await getDocs(collection(db, 'admins'));
            adminIds = new Set(adminSnapshot.docs.map(doc => doc.id));
            console.log('👑 Админов найдено:', adminIds.size);
        } catch (e) {
            console.log('Коллекция admins не найдена');
        }
        
        // Строим таблицу
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const user = doc.data();
            const date = user.createdAt 
                ? new Date(user.createdAt).toLocaleDateString('ru-RU') 
                : 'неизвестно';
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
        
        console.log('✅ Таблица построена');
        updatePagination();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки пользователей:', error);
        const tbody = document.getElementById('usersTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center;">Ошибка: ${error.message}</td></tr>`;
        }
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

// ========== РЕДАКТИРОВАНИЕ ПОЛЬЗОВАТЕЛЕЙ ==========
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
            try {
                await deleteDoc(adminRef);
            } catch (e) {
                console.log('Документ админа не найден');
            }
        }
        
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'edit_user',
                targetUser: document.getElementById('editEmail').value,
                targetUserId: currentEditUserId,
                performedBy: currentAdmin?.uid || 'unknown',
                changes: updates,
                timestamp: new Date().toISOString()
            });
        } catch (e) {
            console.log('Логи не сохранились');
        }
        
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
        
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'delete_user',
                targetUserId: currentEditUserId,
                performedBy: currentAdmin?.uid || 'unknown',
                timestamp: new Date().toISOString()
            });
        } catch (e) {}
        
        alert('Пользователь удалён');
        closeUserModal();
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка удаления:', error);
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
        
        try {
            await addDoc(collection(db, 'adminLogs'), {
                action: 'add_tokens',
                targetUserId: userId,
                amount: tokens,
                performedBy: currentAdmin?.uid || 'unknown',
                timestamp: new Date().toISOString()
            });
        } catch (e) {}
        
        alert(`Начислено ${tokens} токенов`);
        loadUsers(currentPage);
        
    } catch (error) {
        console.error('Ошибка начисления:', error);
        alert('Ошибка: ' + error.message);
    }
};

// ========== ЛОГИ ==========
// ... (остальные функции для логов, если нужны)