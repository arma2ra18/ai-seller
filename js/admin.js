import { auth } from './firebase.js';
import { signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// Вход в админку
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
        
        // Проверяем, есть ли у пользователя права администратора
        if (token.claims && token.claims.admin === true) {
            window.location.href = 'dashboard.html';
        } else {
            errorEl.textContent = 'У вас нет прав администратора';
            errorEl.style.display = 'block';
            await auth.signOut(); // разлогиниваем, если нет прав
        }
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Ошибка входа';
        if (error.code === 'auth/user-not-found') {
            errorMessage = 'Пользователь не найден';
        } else if (error.code === 'auth/wrong-password') {
            errorMessage = 'Неверный пароль';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = 'Некорректный email';
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = 'Слишком много попыток, повторите позже';
        }
        errorEl.textContent = errorMessage;
        errorEl.style.display = 'block';
    }
};

// Выход
window.logout = async function() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
};

// Проверка авторизации при загрузке страниц админки
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

onAuthStateChanged(auth, async (user) => {
    const path = window.location.pathname;
    
    // Если это страница входа, пропускаем
    if (path.includes('index.html')) return;
    
    // Для защищённых страниц проверяем права
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    
    const token = await user.getIdTokenResult();
    if (!token.claims || !token.claims.admin) {
        alert('У вас нет прав доступа');
        await signOut(auth);
        window.location.href = 'index.html';
    }
});