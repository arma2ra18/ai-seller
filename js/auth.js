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

let confirmationResult = null;
let currentMode = null;

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

async function getWelcomeBonus() {
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'general'));
        if (settingsDoc.exists()) {
            return settingsDoc.data().welcomeBonus || 500;
        }
    } catch (error) {
        console.warn('Bonus error:', error);
    }
    return 100;
}

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
        messageEl.textContent = '⏳ Отправка кода...';
        messageEl.className = 'auth-message info';

        // Удаляем старый verifier если есть
        if (window.recaptchaVerifier) {
            window.recaptchaVerifier.clear();
            window.recaptchaVerifier = null;
        }

        // Создаём verifier с правильным контейнером
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
            size: 'invisible'
        });

        const appVerifier = window.recaptchaVerifier;
        confirmationResult = await signInWithPhoneNumber(auth, phone, appVerifier);
        
        currentMode = mode;
        
        document.getElementById('codeModal').classList.add('show');
        document.getElementById('verificationCode').value = '';
        
        messageEl.textContent = '✅ Код отправлен! Проверьте SMS';
        messageEl.className = 'auth-message success';
        
    } catch (error) {
        console.error('Phone auth error:', error);
        
        let errorMessage = 'Ошибка при отправке кода';
        if (error.code === 'auth/invalid-phone-number') {
            errorMessage = '❌ Неверный формат номера';
        } else if (error.code === 'auth/quota-exceeded') {
            errorMessage = '❌ Лимит отправок. Попробуйте позже.';
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = '❌ Слишком много попыток';
        } else if (error.message) {
            errorMessage = '❌ Ошибка: ' + error.message;
        }
        
        messageEl.textContent = errorMessage;
        messageEl.className = 'auth-message error';
    }
};

window.verifyPhoneCode = async function() {
    const code = document.getElementById('verificationCode').value.trim();
    const messageEl = document.getElementById('authMessage');
    
    if (!code) {
        alert('Введите код');
        return;
    }
    
    try {
        messageEl.textContent = '⏳ Проверка кода...';
        messageEl.className = 'auth-message info';
        
        const result = await confirmationResult.confirm(code);
        const user = result.user;
        
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        
        if (!userDoc.exists()) {
            const welcomeBonus = await getWelcomeBonus();
            
            await setDoc(userRef, {
                phoneNumber: user.phoneNumber,
                balance: welcomeBonus,
                usedSpent: 0,
                createdAt: new Date().toISOString()
            });
        }
        
        messageEl.textContent = '✅ Успешно! Перенаправляем...';
        messageEl.className = 'auth-message success';
        closeCodeModal();
        
        setTimeout(() => {
            window.location.href = '/news.html';
        }, 1500);
        
    } catch (error) {
        console.error('Verification error:', error);
        
        let errorMessage = '❌ Неверный код';
        if (error.code === 'auth/code-expired') {
            errorMessage = '❌ Код истёк';
        }
        
        messageEl.textContent = errorMessage;
        messageEl.className = 'auth-message error';
    }
};

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
            const welcomeBonus = await getWelcomeBonus();
            
            await setDoc(doc(db, 'users', user.uid), {
                email: user.email,
                displayName: user.displayName,
                balance: welcomeBonus,
                usedSpent: 0,
                createdAt: new Date().toISOString()
            });
        }
        
        messageEl.textContent = '✅ Вход выполнен! Перенаправляем...';
        messageEl.className = 'auth-message success';
        setTimeout(() => window.location.href = '/news.html', 1500);
        
    } catch (error) {
        console.error('Google error:', error);
        messageEl.textContent = '❌ Ошибка входа';
        messageEl.className = 'auth-message error';
    }
};

window.closeCodeModal = function() {
    document.getElementById('codeModal').classList.remove('show');
    document.getElementById('verificationCode').value = '';
};

window.resendPhoneCode = async function() {
    if (!confirmationResult) return;
    
    try {
        await confirmationResult.confirm('');
        alert('Код отправлен повторно');
    } catch (error) {
        alert('Ошибка при повторной отправке');
    }
};

window.logout = async function() {
    await signOut(auth);
    window.location.href = '/login.html';
};

window.onclick = function(event) {
    const codeModal = document.getElementById('codeModal');
    if (event.target === codeModal) closeCodeModal();
};