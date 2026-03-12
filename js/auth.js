import { supabase } from './supabase.js'

// Переключение вкладок (оставляем как есть)
window.showTab = function(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'))
    
    if (tab === 'login') {
        document.querySelector('[onclick="showTab(\'login\')"]').classList.add('active')
        document.getElementById('login-tab').classList.add('active')
    } else {
        document.querySelector('[onclick="showTab(\'register\')"]').classList.add('active')
        document.getElementById('register-tab').classList.add('active')
    }
    document.getElementById('authMessage').textContent = ''
}

// ========== ВХОД ПО EMAIL ==========
window.handleEmailLogin = async function() {
    const email = document.getElementById('loginEmail').value.trim()
    const password = document.getElementById('loginPassword').value
    const messageEl = document.getElementById('authMessage')
    
    if (!email || !password) {
        messageEl.textContent = '❌ Введите email и пароль'
        messageEl.className = 'auth-message error'
        return
    }

    try {
        messageEl.textContent = '⏳ Вход...'
        messageEl.className = 'auth-message info'
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        })

        if (error) throw error

        messageEl.textContent = '✅ Успешно! Перенаправляем...'
        messageEl.className = 'auth-message success'
        
        setTimeout(() => window.location.href = '/news.html', 1500)
    } catch (error) {
        console.error('Login error:', error)
        let errorMessage = 'Ошибка входа'
        if (error.message.includes('Invalid login credentials')) {
            errorMessage = 'Неверный email или пароль'
        } else {
            errorMessage = error.message
        }
        messageEl.textContent = '❌ ' + errorMessage
        messageEl.className = 'auth-message error'
    }
}

// ========== РЕГИСТРАЦИЯ ПО EMAIL ==========
window.handleEmailRegister = async function() {
    const email = document.getElementById('registerEmail').value.trim()
    const password = document.getElementById('registerPassword').value
    const messageEl = document.getElementById('authMessage')
    
    if (!email || !password) {
        messageEl.textContent = '❌ Введите email и пароль'
        messageEl.className = 'auth-message error'
        return
    }

    if (password.length < 6) {
        messageEl.textContent = '❌ Пароль должен быть не менее 6 символов'
        messageEl.className = 'auth-message error'
        return
    }

    try {
        messageEl.textContent = '⏳ Регистрация...'
        messageEl.className = 'auth-message info'
        
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password
        })

        if (error) throw error

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
                })

            if (insertError) console.error('Error inserting user:', insertError)
        }

        messageEl.textContent = '✅ Регистрация успешна! Перенаправляем...'
        messageEl.className = 'auth-message success'
        
        setTimeout(() => window.location.href = '/news.html', 1500)
    } catch (error) {
        console.error('Register error:', error)
        messageEl.textContent = '❌ ' + error.message
        messageEl.className = 'auth-message error'
    }
}

// ========== ВХОД ЧЕРЕЗ GOOGLE ==========
window.handleGoogleLogin = async function() {
    const messageEl = document.getElementById('authMessage')
    
    try {
        messageEl.textContent = '⏳ Вход через Google...'
        messageEl.className = 'auth-message info'
        
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/news.html'
            }
        })

        if (error) throw error
        
        // Редирект произойдёт автоматически
    } catch (error) {
        console.error('Google sign-in error:', error)
        messageEl.textContent = '❌ Ошибка входа через Google: ' + error.message
        messageEl.className = 'auth-message error'
    }
}

// ========== ВЫХОД ==========
window.logout = async function() {
    await supabase.auth.signOut()
    window.location.href = '/login.html'
}

// ========== ПРОВЕРКА АВТОРИЗАЦИИ ==========
supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        console.log('User signed in:', session.user)
        // Здесь можно перенаправить, если нужно
    } else if (event === 'SIGNED_OUT') {
        console.log('User signed out')
    }
})