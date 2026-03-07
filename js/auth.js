import { auth, db } from './firebase.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

window.showTab = function(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    
    if (tab === 'login') {
        document.querySelector('[onclick="showTab(\'login\')"]').classList.add('active');
        document.getElementById('login-tab').classList.add('active');
    } else {
        document.querySelector('[onclick="showTab(\'register\')"]').classList.add('active');
        document.getElementById('register-tab').classList.add('active');
    }
    document.getElementById('authMessage').textContent = '';
};

window.handleRegister = async function() {
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('registerConfirm').value;
    const messageEl = document.getElementById('authMessage');

    if (!email || !password || !confirm) {
        messageEl.textContent = '❌ Заполните все поля';
        messageEl.className = 'auth-message error';
        return;
    }
    if (password.length < 6) {
        messageEl.textContent = '❌ Пароль должен быть не менее 6 символов';
        messageEl.className = 'auth-message error';
        return;
    }
    if (password !== confirm) {
        messageEl.textContent = '❌ Пароли не совпадают';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        messageEl.textContent = '⏳ Создаем аккаунт...';
        messageEl.className = 'auth-message info';
        
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, 'users', user.uid), {
            email: email,
            plan: 'start',
            balance: 30,
            usedGenerations: 0,
            createdAt: new Date().toISOString()
        });

        messageEl.textContent = '✅ Регистрация успешна! Перенаправляем...';
        messageEl.className = 'auth-message success';
        setTimeout(() => window.location.href = '/dashboard.html', 1500);
    } catch (error) {
        let errorMessage = 'Ошибка регистрации';
        if (error.code === 'auth/email-already-in-use') errorMessage = 'Этот email уже зарегистрирован';
        else if (error.code === 'auth/invalid-email') errorMessage = 'Некорректный email';
        messageEl.textContent = '❌ ' + errorMessage;
        messageEl.className = 'auth-message error';
    }
};

window.handleLogin = async function() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const messageEl = document.getElementById('authMessage');

    if (!email || !password) {
        messageEl.textContent = '❌ Заполните все поля';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        messageEl.textContent = '⏳ Вход...';
        messageEl.className = 'auth-message info';
        await signInWithEmailAndPassword(auth, email, password);
        messageEl.textContent = '✅ Вход выполнен! Перенаправляем...';
        messageEl.className = 'auth-message success';
        setTimeout(() => window.location.href = '/dashboard.html', 1000);
    } catch (error) {
        let errorMessage = 'Ошибка входа';
        if (error.code === 'auth/user-not-found') errorMessage = 'Пользователь не найден';
        else if (error.code === 'auth/wrong-password') errorMessage = 'Неверный пароль';
        messageEl.textContent = '❌ ' + errorMessage;
        messageEl.className = 'auth-message error';
    }
};

window.logout = async function() {
    await signOut(auth);
    window.location.href = '/login.html';
};

window.resetPassword = async function() {
    const email = prompt('Введите ваш email для сброса пароля:');
    if (!email) return;
    try {
        await sendPasswordResetEmail(auth, email);
        alert('Письмо для сброса пароля отправлено на ' + email);
    } catch (error) {
        alert('Ошибка: ' + error.message);
    }
};