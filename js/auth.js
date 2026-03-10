import { auth, db } from './firebase.js';
import { 
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    GoogleAuthProvider,
    signInWithPopup,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Переменные для хранения данных регистрации и подтверждения
let confirmationResult = null;
let pendingUserData = null;

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

// ========== РЕГИСТРАЦИЯ (НОВАЯ ЛОГИКА) ==========
window.handlePhoneRegistration = async function() {
    const phone = document.getElementById('registerPhone').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('registerConfirm').value;
    const messageEl = document.getElementById('authMessage');

    // Валидация
    if (!phone || !email || !password || !confirm) {
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
        // Инициализируем reCAPTCHA (если ещё не создана)
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
                'size': 'invisible', // делаем невидимой для лучшего UX
                'callback': () => {}
            });
        }

        // Отправляем код на телефон
        const appVerifier = window.recaptchaVerifier;
        confirmationResult = await signInWithPhoneNumber(auth, phone, appVerifier);
        
        // Сохраняем данные для последующего создания аккаунта
        pendingUserData = {
            phone,
            email,
            password
        };
        
        // Показываем модальное окно для ввода кода
        const codeModal = document.getElementById('codeModal');
        if (codeModal) codeModal.classList.add('show');
        
        messageEl.textContent = '✅ Код отправлен! Проверьте SMS';
        messageEl.className = 'auth-message success';
    } catch (error) {
        console.error('Phone registration error:', error);
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
        // Подтверждаем код и получаем пользователя
        const result = await confirmationResult.confirm(code);
        const user = result.user;
        
        // Обновляем профиль пользователя: добавляем email и пароль
        // Важно: телефон уже привязан к аккаунту
        await updateProfile(user, {
            phoneNumber: pendingUserData.phone
        });
        
        // Обновляем email (если нужно)
        if (pendingUserData.email && user.email !== pendingUserData.email) {
            await updateEmail(user, pendingUserData.email);
        }
        
        // Меняем пароль (если нужно)
        if (pendingUserData.password) {
            await updatePassword(user, pendingUserData.password);
        }
        
        // Создаём запись в Firestore
        await setDoc(doc(db, 'users', user.uid), {
            email: pendingUserData.email || user.email || '',
            phoneNumber: pendingUserData.phone || user.phoneNumber || '',
            displayName: user.displayName || '',
            plan: 'start',
            balance: 30,
            usedGenerations: 0,
            createdAt: new Date().toISOString()
        });
        
        messageEl.textContent = '✅ Регистрация успешна! Перенаправляем...';
        messageEl.className = 'auth-message success';
        closeCodeModal();
        setTimeout(() => window.location.href = '/dashboard.html', 1500);
    } catch (error) {
        console.error('Verification error:', error);
        messageEl.textContent = '❌ Неверный код: ' + error.message;
        messageEl.className = 'auth-message error';
    }
};

// ========== ВХОД ПО ТЕЛЕФОНУ ==========
window.handlePhoneLogin = async function() {
    const phoneNumber = document.getElementById('loginPhone').value.trim();
    const password = document.getElementById('loginPassword').value;
    const messageEl = document.getElementById('authMessage');

    if (!phoneNumber || !password) {
        messageEl.textContent = '❌ Заполните все поля';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        // Для входа по телефону с паролем нужно использовать email/password,
        // но телефон может быть связан с email. Упростим: сначала находим пользователя по телефону?
        // Firebase не поддерживает прямой вход по телефону + пароль.
        // Поэтому пока оставим вход только через Google или email/password.
        // В будущем можно реализовать вход по SMS.
        
        // Временное решение: просто показываем, что функция в разработке
        messageEl.textContent = '⏳ Вход по телефону с паролем временно недоступен. Используйте Google.';
        messageEl.className = 'auth-message info';
        
        // Если у вас есть возможность связать телефон с email, можно сделать так:
        // const email = phoneNumber + '@phone.local'; // или искать в БД
        // await signInWithEmailAndPassword(auth, email, password);
        
    } catch (error) {
        console.error('Phone login error:', error);
        messageEl.textContent = '❌ Ошибка: ' + error.message;
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

// ========== ВЫХОД ==========
window.logout = async function() {
    await signOut(auth);
    window.location.href = '/login.html';
};

// ========== СБРОС ПАРОЛЯ ==========
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
    } catch (error) {
        console.error('Resend error:', error);
    }
};

// Закрытие модального окна по клику вне его
window.onclick = function(event) {
    const codeModal = document.getElementById('codeModal');
    if (event.target === codeModal) closeCodeModal();
};