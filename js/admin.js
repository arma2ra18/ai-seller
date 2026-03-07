import { auth, db } from './firebase.js';
import { signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { collection, getDocs, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

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
        let msg = 'Ошибка входа';
        if (error.code === 'auth/user-not-found') msg = 'Пользователь не найден';
        else if (error.code === 'auth/wrong-password') msg = 'Неверный пароль';
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }
};

window.logout = async function() {
    await signOut(auth);
    window.location.href = 'index.html';
};

// Загрузка статистики для dashboard.html
async function loadStats() {
    try {
        const usersSnap = await getDocs(collection(db, 'users'));
        document.getElementById('totalUsers').textContent = usersSnap.size;
        // Заглушки для остальных
        document.getElementById('totalRevenue').textContent = '125 000 ₽';
        document.getElementById('totalGenerations').textContent = '3 456';
        document.getElementById('activeUsers').textContent = '42';
    } catch (error) {
        console.error(error);
    }
}

// Загрузка списка пользователей для users.html
async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    try {
        const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(20));
        const snapshot = await getDocs(q);
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const u = doc.data();
            const date = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'неизвестно';
            tbody.innerHTML += `
                <tr>
                    <td>${u.email || 'нет email'}</td>
                    <td><span style="background:rgba(40,167,69,0.1);padding:4px 8px;border-radius:20px;">${u.plan || 'start'}</span></td>
                    <td>${u.balance || 0}</td>
                    <td>${u.usedGenerations || 0}</td>
                    <td>${date}</td>
                    <td><button class="btn btn-small" onclick="alert('Действие в разработке')">✏️</button></td>
                </tr>
            `;
        });
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6">Ошибка загрузки</td></tr>';
    }
}

// Загрузка последних действий (заглушка)
async function loadActivity() {
    const list = document.getElementById('activityList');
    if (!list) return;
    list.innerHTML = '<li class="activity-item"><span>Пользователь Ivanov оплатил тариф Бизнес</span><span>2 мин назад</span></li>' +
                     '<li class="activity-item"><span>Новый пользователь Petrova зарегистрировался</span><span>15 мин назад</span></li>';
}

// Определяем, какая страница загружена, и вызываем соответствующие функции
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    if (path.includes('dashboard.html')) {
        loadStats();
        loadActivity();
    } else if (path.includes('users.html')) {
        loadUsers();
    }
});

// Экспорт и поиск – заглушки
window.searchUsers = () => alert('Поиск: ' + document.getElementById('userSearch').value);
window.exportUsers = () => alert('Экспорт в CSV');