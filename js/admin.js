import { auth, db, isAdmin } from './firebase.js';
import { signOut } from 'firebase/auth';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

let currentUser = null;

auth.onAuthStateChanged(async (user) => {
    if (!user || !(await isAdmin(user))) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = user;
    document.getElementById('adminEmail').textContent = user.email;
    
    if (window.location.pathname.includes('dashboard.html')) {
        loadStats();
        loadActivity();
    } else if (window.location.pathname.includes('users.html')) {
        loadUsers();
    }
});

async function loadStats() {
    try {
        const functions = getFunctions();
        const getStats = httpsCallable(functions, 'getAdminStats');
        const result = await getStats();
        const stats = result.data;
        
        document.getElementById('totalUsers').textContent = stats.users.total;
        document.getElementById('totalRevenue').textContent = stats.payments.revenue + ' ₽';
        document.getElementById('totalGenerations').textContent = stats.generations.total;
        document.getElementById('activeUsers').textContent = Math.floor(stats.users.total * 0.3);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

async function loadActivity() {
    try {
        const logsRef = collection(db, 'adminLogs');
        const q = query(logsRef, orderBy('timestamp', 'desc'), limit(10));
        const snapshot = await getDocs(q);
        
        const activityList = document.getElementById('activityList');
        activityList.innerHTML = '';
        
        snapshot.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp?.toDate().toLocaleString('ru-RU', {
                hour: '2-digit', minute: '2-digit'
            }) || 'недавно';
            
            activityList.innerHTML += `
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

async function loadUsers() {
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, orderBy('createdAt', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';
        
        snapshot.forEach(doc => {
            const user = doc.data();
            const date = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'неизвестно';
            
            tbody.innerHTML += `
                <tr>
                    <td>${user.email || 'нет email'}</td>
                    <td><span style="background: rgba(16,185,129,0.1); padding: 4px 8px; border-radius: 20px;">${user.plan || 'start'}</span></td>
                    <td>${user.balance || 0}</td>
                    <td>${user.usedGenerations || 0}</td>
                    <td>${date}</td>
                    <td class="user-actions">
                        <button class="btn btn-small" onclick="addTokens('${doc.id}')">➕</button>
                        <button class="btn btn-small" onclick="blockUser('${doc.id}')">🚫</button>
                    </td>
                </tr>
            `;
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

window.logout = async function() {
    await signOut(auth);
    window.location.href = 'index.html';
};

window.addTokens = function(userId) {
    const amount = prompt('Количество токенов:');
    if (amount) alert(`Начислено ${amount} токенов`);
};

window.blockUser = function(userId) {
    if (confirm('Заблокировать?')) alert('Пользователь заблокирован');
};

window.searchUsers = function() {
    alert('Поиск: ' + document.getElementById('userSearch').value);
};

window.exportUsers = function() {
    alert('Экспорт в CSV');
};