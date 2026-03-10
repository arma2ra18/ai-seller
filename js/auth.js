import { auth, db } from './firebase.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    RecaptchaVerifier,
    signInWithPhoneNumber
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Переменные для хранения confirmationResult (телефон)
let confirmationResult = null;

// Переключение вкладок
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

// ========== EMAIL/ПАРОЛЬ (существующий код) ==========
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

// ========== ВХОД ЧЕРЕЗ GOOGLE ==========
window.handleGoogleLogin = async function() {
    const provider = new GoogleAuthProvider();
    const messageEl = document.getElementById('authMessage');
    
    try {
        messageEl.textContent = '⏳ Вход через Google...';
        messageEl.className = 'auth-message info';
        
        // Используем popup для простоты (работает и на мобильных)
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        // Проверяем, есть ли пользователь в Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
            // Создаём запись для нового пользователя
            await setDoc(doc(db, 'users', user.uid), {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                plan: 'start',
                balance: 30,
                usedGenerations: 0,
                createdAt: new Date().toISOString()
            });
        }
        
        messageEl.textContent = '✅ Вход выполнен! Перенаправляем...';
        messageEl.className = 'auth-message success';
        setTimeout(() => window.location.href = '/dashboard.html', 1500);
    } catch (error) {
        console.error('Google sign-in error:', error);
        messageEl.textContent = '❌ Ошибка входа через Google: ' + error.message;
        messageEl.className = 'auth-message error';
    }
};

// ========== ВХОД ПО ТЕЛЕФОНУ ==========
window.handlePhoneLogin = function() {
    // Показываем модальное окно для ввода номера
    const modal = document.getElementById('phoneModal');
    if (modal) modal.classList.add('show');
    
    // Инициализируем reCAPTCHA
    if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
            'size': 'normal',
            'callback': () => {
                console.log('reCAPTCHA solved');
            }
        });
    }
};

window.closePhoneModal = function() {
    const modal = document.getElementById('phoneModal');
    if (modal) modal.classList.remove('show');
};

window.closeCodeModal = function() {
    const modal = document.getElementById('codeModal');
    if (modal) modal.classList.remove('show');
};

// Отправка кода на номер телефона
window.sendPhoneCode = async function() {
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    const messageEl = document.getElementById('authMessage');
    
    if (!phoneNumber) {
        alert('Введите номер телефона');
        return;
    }
    
    try {
        const appVerifier = window.recaptchaVerifier;
        confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
        
        // Закрываем модальное окно с номером и открываем окно для кода
        closePhoneModal();
        const codeModal = document.getElementById('codeModal');
        if (codeModal) codeModal.classList.add('show');
        
        messageEl.textContent = '✅ Код отправлен! Проверьте SMS';
        messageEl.className = 'auth-message success';
    } catch (error) {
        console.error('Phone sign-in error:', error);
        messageEl.textContent = '❌ Ошибка: ' + error.message;
        messageEl.className = 'auth-message error';
        
        // Сбрасываем reCAPTCHA
        if (window.recaptchaVerifier) {
            window.recaptchaVerifier.clear();
            window.recaptchaVerifier = null;
        }
    }
};

// Подтверждение кода из SMS
window.verifyPhoneCode = async function() {
    const code = document.getElementById('verificationCode').value.trim();
    const messageEl = document.getElementById('authMessage');
    
    if (!code) {
        alert('Введите код подтверждения');
        return;
    }
    
    try {
        const result = await confirmationResult.confirm(code);
        const user = result.user;
        
        // Проверяем, есть ли пользователь в Firestore
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
            // Создаём запись для нового пользователя
            await setDoc(doc(db, 'users', user.uid), {
                phoneNumber: user.phoneNumber,
                plan: 'start',
                balance: 30,
                usedGenerations: 0,
                createdAt: new Date().toISOString()
            });
        }
        
        messageEl.textContent = '✅ Вход выполнен! Перенаправляем...';
        messageEl.className = 'auth-message success';
        closeCodeModal();
        setTimeout(() => window.location.href = '/dashboard.html', 1500);
    } catch (error) {
        console.error('Verification error:', error);
        messageEl.textContent = '❌ Неверный код: ' + error.message;
        messageEl.className = 'auth-message error';
    }
};

// Повторная отправка кода
window.resendPhoneCode = async function() {
    if (!confirmationResult) {
        alert('Сначала запросите код');
        return;
    }
    
    try {
        // Повторно отправляем код (используем тот же verificationId)
        await confirmationResult.confirm('');
    } catch (error) {
        console.error('Resend error:', error);
    }
};

// ========== ОБЩИЕ ФУНКЦИИ ==========
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