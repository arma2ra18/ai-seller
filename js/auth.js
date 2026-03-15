import { auth, db } from './firebase.js';
import { 
    signOut,
    GoogleAuthProvider,
    signInWithPopup,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Переменные для хранения confirmationResult и режима (login/register)
let confirmationResult = null;
let currentMode = null;

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
    document.getElementById('authMessage').className = 'auth-message';
};

/**
 * Получает размер бонуса из настроек Firestore
 */
async function getWelcomeBonus() {
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'general'));
        if (settingsDoc.exists()) {
            const bonus = settingsDoc.data().welcomeBonus;
            console.log('📦 Бонус из настроек:', bonus);
            return bonus || 500;
        }
    } catch (error) {
        console.warn('⚠️ Не удалось загрузить настройки бонуса:', error);
    }
    return 100; // Значение по умолчанию
}

/**
 * Очистка reCAPTCHA
 */
function clearRecaptcha() {
    if (window.recaptchaVerifier) {
        try {
            window.recaptchaVerifier.clear();
        } catch (e) {
            console.log('Ошибка при очистке reCAPTCHA:', e);
        }
        window.recaptchaVerifier = null;
    }
    
    // Удаляем старый контейнер, если есть
    const oldContainer = document.getElementById('recaptcha-container');
    if (oldContainer) {
        oldContainer.innerHTML = '';
    }
}

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

    // Простая валидация номера (должен начинаться с + и содержать цифры)
    if (!phone.match(/^\+[0-9]{10,15}$/)) {
        messageEl.textContent = '❌ Неверный формат номера. Используйте +79991234567';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        // Очищаем старую reCAPTCHA
        clearRecaptcha();

        // Ждём немного, чтобы DOM обновился
        await new Promise(resolve => setTimeout(resolve, 100));

        // Создаём новый контейнер для reCAPTCHA
        const containerId = 'recaptcha-container';
        let container = document.getElementById(containerId);
        
        if (!container) {
            // Если контейнера нет, создаём его
            container = document.createElement('div');
            container.id = containerId;
            container.style.position = 'fixed';
            container.style.bottom = '0';
            container.style.right = '0';
            container.style.zIndex = '9999';
            document.body.appendChild(container);
        }

        // Инициализируем reCAPTCHA
        window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
            size: 'invisible',
            callback: () => {
                console.log('✅ reCAPTCHA verified');
            },
            'expired-callback': () => {
                console.log('❌ reCAPTCHA expired');
                messageEl.textContent = '❌ Время сессии истекло. Попробуйте снова.';
                messageEl.className = 'auth-message error';
                clearRecaptcha();
            }
        });

        // Рендерим reCAPTCHA
        await window.recaptchaVerifier.render();
        
        const appVerifier = window.recaptchaVerifier;
        
        // Показываем сообщение о отправке
        messageEl.textContent = '⏳ Отправка кода...';
        messageEl.className = 'auth-message info';
        
        // Отправляем код
        confirmationResult = await signInWithPhoneNumber(auth, phone, appVerifier);
        
        currentMode = mode;
        
        // Показываем модальное окно для ввода кода
        const codeModal = document.getElementById('codeModal');
        if (codeModal) {
            codeModal.classList.add('show');
            // Очищаем поле ввода кода
            document.getElementById('verificationCode').value = '';
        }
        
        messageEl.textContent = '✅ Код отправлен! Проверьте SMS';
        messageEl.className = 'auth-message success';
        
        console.log('📱 Код отправлен на номер:', phone);
        
    } catch (error) {
        console.error('❌ Phone auth error:', error);
        
        // Очищаем reCAPTCHA при ошибке
        clearRecaptcha();
        
        // Человеко-понятные сообщения об ошибках
        let errorMessage = 'Ошибка при отправке кода';
        
        if (error.code === 'auth/invalid-phone-number') {
            errorMessage = '❌ Неверный формат номера телефона';
        } else if (error.code === 'auth/quota-exceeded') {
            errorMessage = '❌ Превышен лимит отправки SMS. Попробуйте позже.';
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = '❌ Слишком много попыток. Попробуйте позже.';
        } else if (error.code === 'auth/network-request-failed') {
            errorMessage = '❌ Ошибка сети. Проверьте подключение.';
        } else if (error.message) {
            errorMessage = '❌ Ошибка: ' + error.message;
        }
        
        messageEl.textContent = errorMessage;
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
    
    if (!code.match(/^\d{6}$/)) {
        alert('Код должен состоять из 6 цифр');
        return;
    }
    
    try {
        console.log('🔐 Verifying code:', code);
        
        messageEl.textContent = '⏳ Проверка кода...';
        messageEl.className = 'auth-message info';
        
        const result = await confirmationResult.confirm(code);
        const user = result.user;
        console.log('✅ User authenticated:', user.uid);
        
        // Всегда создаём/обновляем запись в Firestore
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            console.log('📝 Creating new user in Firestore');
            
            // Получаем актуальный бонус из настроек
            const welcomeBonus = await getWelcomeBonus();
            console.log('🎁 Начисляем бонус:', welcomeBonus);
            
            await setDoc(userRef, {
                phoneNumber: user.phoneNumber,
                email: user.email || '',
                displayName: user.displayName || '',
                plan: 'start',
                balance: welcomeBonus,
                usedSpent: 0,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString()
            });
        } else {
            console.log('📝 User already exists in Firestore');
            // Обновляем последнюю активность
            await setDoc(userRef, { 
                lastActivity: new Date().toISOString(),
                phoneNumber: user.phoneNumber // обновляем номер, если изменился
            }, { merge: true });
        }
        
        messageEl.textContent = '✅ Успешно! Перенаправляем...';
        messageEl.className = 'auth-message success';
        closeCodeModal();
        
        // Очищаем reCAPTCHA после успешного входа
        clearRecaptcha();
        
        // Небольшая задержка перед редиректом
        setTimeout(() => {
            window.location.href = '/news.html';
        }, 1500);
        
    } catch (error) {
        console.error('❌ Verification error:', error);
        
        // Детальный разбор ошибки
        let errorMessage = 'Ошибка подтверждения';
        if (error.code === 'auth/invalid-verification-code') {
            errorMessage = '❌ Неверный код. Попробуйте ещё раз.';
        } else if (error.code === 'auth/code-expired') {
            errorMessage = '❌ Код истёк. Запросите новый.';
        } else if (error.message) {
            errorMessage = '❌ Ошибка: ' + error.message;
        }
        
        messageEl.textContent = errorMessage;
        messageEl.className = 'auth-message error';
        
        // Не очищаем confirmationResult, чтобы можно было попробовать снова
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
            // Получаем актуальный бонус из настроек
            const welcomeBonus = await getWelcomeBonus();
            console.log('🎁 Начисляем бонус (Google):', welcomeBonus);
            
            await setDoc(doc(db, 'users', user.uid), {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                plan: 'start',
                balance: welcomeBonus,
                usedSpent: 0,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString()
            });
        } else {
            // Обновляем последнюю активность
            await setDoc(doc(db, 'users', user.uid), { 
                lastActivity: new Date().toISOString() 
            }, { merge: true });
        }
        
        messageEl.textContent = '✅ Вход выполнен! Перенаправляем...';
        messageEl.className = 'auth-message success';
        
        // Очищаем reCAPTCHA если была
        clearRecaptcha();
        
        setTimeout(() => window.location.href = '/news.html', 1500);
        
    } catch (error) {
        console.error('❌ Google sign-in error:', error);
        
        let errorMessage = 'Ошибка входа через Google';
        if (error.code === 'auth/popup-closed-by-user') {
            errorMessage = '❌ Окно входа было закрыто';
        } else if (error.code === 'auth/cancelled-popup-request') {
            errorMessage = '❌ Запрос отменён';
        } else if (error.message) {
            errorMessage = '❌ Ошибка: ' + error.message;
        }
        
        messageEl.textContent = errorMessage;
        messageEl.className = 'auth-message error';
    }
};

// ========== УПРАВЛЕНИЕ МОДАЛЬНЫМИ ОКНАМИ ==========
window.closeCodeModal = function() {
    const modal = document.getElementById('codeModal');
    if (modal) {
        modal.classList.remove('show');
    }
    // Очищаем поле ввода
    document.getElementById('verificationCode').value = '';
};

window.resendPhoneCode = async function() {
    if (!confirmationResult) {
        alert('Сначала запросите код');
        return;
    }
    
    const messageEl = document.getElementById('authMessage');
    
    try {
        messageEl.textContent = '⏳ Повторная отправка...';
        messageEl.className = 'auth-message info';
        
        // Повторно отправляем код (используем тот же confirmationResult)
        await confirmationResult.confirm('');
        alert('Код отправлен повторно');
        
        messageEl.textContent = '✅ Код отправлен повторно';
        messageEl.className = 'auth-message success';
        
    } catch (error) {
        console.error('❌ Resend error:', error);
        
        if (error.code === 'auth/too-many-requests') {
            messageEl.textContent = '❌ Слишком много попыток. Попробуйте позже.';
        } else {
            messageEl.textContent = '❌ Ошибка при повторной отправке';
        }
        messageEl.className = 'auth-message error';
    }
};

// ========== ВЫХОД ==========
window.logout = async function() {
    try {
        await signOut(auth);
        // Очищаем reCAPTCHA при выходе
        clearRecaptcha();
        window.location.href = '/login.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
};

// Закрытие модального окна по клику вне его
window.onclick = function(event) {
    const codeModal = document.getElementById('codeModal');
    if (event.target === codeModal) {
        closeCodeModal();
    }
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    // Очищаем reCAPTCHA при загрузке
    clearRecaptcha();
    
    // Добавляем обработчик для поля ввода кода (Enter)
    const codeInput = document.getElementById('verificationCode');
    if (codeInput) {
        codeInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                verifyPhoneCode();
            }
        });
    }
});