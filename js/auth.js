import { auth, db } from './firebase.js';
import { 
    signOut,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Переменные для хранения confirmationResult и режима (login/register)
let confirmationResult = null;
let currentMode = null; // 'login' или 'register'

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

// ========== ОТПРАВКА КОДА (для входа или регистрации) ==========
window.sendPhoneCode = async function(mode) {
    const phone = mode === 'login' 
        ? document.getElementById('loginPhone').value.trim()
        : document.getElementById('registerPhone').value.trim();
    
    const messageEl = document.getElementById('authMessage');

    if (!phone) {
        messageEl.textContent = '❌ Введите номер телефона';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        // Инициализируем невидимую reCAPTCHA
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
                'size': 'invisible',
                'callback': () => {}
            });
        }

        // Отправляем код
        const appVerifier = window.recaptchaVerifier;
        confirmationResult = await signInWithPhoneNumber(auth, phone, appVerifier);
        
        // Запоминаем режим (login или register)
        currentMode = mode;
        
        // Показываем модальное окно для ввода кода
        const codeModal = document.getElementById('codeModal');
        if (codeModal) codeModal.classList.add('show');
        
        messageEl.textContent = '✅ Код отправлен! Проверьте SMS';
        messageEl.className = 'auth-message success';
    } catch (error) {
        console.error('Phone auth error:', error);
        messageEl.textContent = '❌ Ошибка: ' + error.message;
        messageEl.className = 'auth-message error';
    }
};

// ========== ПОДТВЕРЖДЕНИЕ КОДА ==========
window.verifyPhoneCode = async function() {
    const code = document.getElementById('verificationCode').value.trim();
    const messageEl = document.getElementById('authMessage');
    
    if (!code) {
        alert('Введите код подтверждения');
        return;
    }
    
    try {
        // Подтверждаем код
        const result = await confirmationResult.confirm(code);
        const user = result.user;
        
        // Если это регистрация (новый пользователь) — создаём запись в Firestore
        if (currentMode === 'register') {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (!userDoc.exists()) {
                await setDoc(doc(db, 'users', user.uid), {
                    phoneNumber: user.phoneNumber,
                    email: user.email || '',
                    displayName: user.displayName || '',
                    plan: 'start',
                    balance: 30,
                    usedGenerations: 0,
                    createdAt: new Date().toISOString()
                });
            }
        }
        
        messageEl.textContent = '✅ Успешно! Перенаправляем...';
        messageEl.className = 'auth-message success';
        closeCodeModal();
        setTimeout(() => window.location.href = '/dashboard.html', 1500);
    } catch (error) {
        console.error('Verification error:', error);
        messageEl.textContent = '❌ Неверный код: ' + error.message;
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
        
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists()) {
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

// ========== УПРАВЛЕНИЕ МОДАЛЬНЫМИ ОКНАМИ ==========
window.closeCodeModal = function() {
    const modal = document.getElementById('codeModal');
    if (modal) modal.classList.remove('show');
};

window.resendPhoneCode = async function() {
    if (!confirmationResult) {
        alert('Сначала запросите код');
        return;
    }
    try {
        // Повторно отправляем код (используем тот же verificationId)
        await confirmationResult.confirm('');
        alert('Код отправлен повторно');
    } catch (error) {
        console.error('Resend error:', error);
        alert('Ошибка при повторной отправке');
    }
};

// ========== ВЫХОД ==========
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/login.html';
};

// Закрытие модального окна по клику вне его
window.onclick = function(event) {
    const codeModal = document.getElementById('codeModal');
    if (event.target === codeModal) closeCodeModal();
};