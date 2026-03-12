import { supabase } from './supabase.js';

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

// ========== ВХОД ПО EMAIL ==========
window.handleEmailLogin = async function() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const messageEl = document.getElementById('authMessage');
    
    if (!email || !password) {
        messageEl.textContent = '❌ Введите email и пароль';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        messageEl.textContent = '⏳ Вход...';
        messageEl.className = 'auth-message info';
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        messageEl.textContent = '✅ Успешно! Перенаправляем...';
        messageEl.className = 'auth-message success';
        
        setTimeout(() => window.location.href = '/news.html', 1500);
    } catch (error) {
        console.error('Login error:', error);
        let errorMessage = 'Ошибка входа';
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Неверный email или пароль';
        } else {
            errorMessage = error.message;
        }
        messageEl.textContent = '❌ ' + errorMessage;
        messageEl.className = 'auth-message error';
    }
};

// ========== РЕГИСТРАЦИЯ ПО EMAIL ==========
window.handleEmailRegister = async function() {
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const messageEl = document.getElementById('authMessage');
    
    if (!email || !password) {
        messageEl.textContent = '❌ Введите email и пароль';
        messageEl.className = 'auth-message error';
        return;
    }

    if (password.length < 6) {
        messageEl.textContent = '❌ Пароль должен быть не менее 6 символов';
        messageEl.className = 'auth-message error';
        return;
    }

    try {
        messageEl.textContent = '⏳ Регистрация...';
        messageEl.className = 'auth-message info';
        
        // Регистрируем пользователя в Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password
        });

        if (error) throw error;

        // Если пользователь создан, добавляем запись в таблицу users с балансом 500
        if (data.user) {
            const { error: insertError } = await supabase
                .from('users')
                .insert({
                    id: data.user.id,
                    email: email,
                    balance: 500,
                    used_spent: 0,
                    created_at: new Date().toISOString()
                });

            if (insertError) {
                console.error('Error inserting user:', insertError);
                // Даже если ошибка вставки, пользователь уже создан в Auth
            }
        }

        messageEl.textContent = '✅ Регистрация успешна! Перенаправляем...';
        messageEl.className = 'auth-message success';
        
        setTimeout(() => window.location.href = '/news.html', 1500);
    } catch (error) {
        console.error('Register error:', error);
        messageEl.textContent = '❌ ' + error.message;
        messageEl.className = 'auth-message error';
    }
};

// ========== ВХОД ЧЕРЕЗ GOOGLE ==========
window.handleGoogleLogin = async function() {
    const messageEl = document.getElementById('authMessage');
    
    try {
        messageEl.textContent = '⏳ Вход через Google...';
        messageEl.className = 'auth-message info';
        
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/news.html'
            }
        });

        if (error) throw error;
        
        // Редирект произойдёт автоматически
    } catch (error) {
        console.error('Google sign-in error:', error);
        messageEl.textContent = '❌ Ошибка входа через Google: ' + error.message;
        messageEl.className = 'auth-message error';
    }
};

// ========== ВЫХОД ==========
window.logout = async function() {
    await supabase.auth.signOut();
    window.location.href = '/login.html';
};

// ========== ОТПРАВКА КОДА (пока отключено - требует Twilio) ==========
window.sendPhoneCode = function(mode) {
    const messageEl = document.getElementById('authMessage');
    messageEl.textContent = '❌ Вход по телефону временно недоступен. Используйте email.';
    messageEl.className = 'auth-message error';
};

// ========== ПОДТВЕРЖДЕНИЕ КОДА (заглушка) ==========
window.verifyPhoneCode = function() {
    const messageEl = document.getElementById('authMessage');
    messageEl.textContent = '❌ Вход по телефону временно недоступен.';
    messageEl.className = 'auth-message error';
};

// ========== ПОВТОРНАЯ ОТПРАВКА КОДА (заглушка) ==========
window.resendPhoneCode = function() {
    const messageEl = document.getElementById('authMessage');
    messageEl.textContent = '❌ Функция недоступна.';
    messageEl.className = 'auth-message error';
};

// ========== ЗАКРЫТИЕ МОДАЛЬНОГО ОКНА ==========
window.closeCodeModal = function() {
    const modal = document.getElementById('codeModal');
    if (modal) modal.classList.remove('show');
};

// ========== СЛЕДИМ ЗА СОСТОЯНИЕМ АВТОРИЗАЦИИ ==========
supabase.auth.onAuthStateChange((event, session) => {
    console.log('Auth event:', event, session?.user?.email);
    
    if (event === 'SIGNED_IN' && session?.user) {
        // Проверяем, есть ли пользователь в таблице users
        (async () => {
            const { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
            
            if (error || !user) {
                // Если нет - создаём
                await supabase
                    .from('users')
                    .insert({
                        id: session.user.id,
                        email: session.user.email,
                        balance: 500,
                        used_spent: 0,
                        created_at: new Date().toISOString()
                    });
            }
        })();
    }
});