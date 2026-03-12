import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// Функция для обновления кнопок в зависимости от статуса авторизации
function updateAuthButtons(user) {
    const authButtonsContainer = document.getElementById('authButtons');
    const heroCta = document.getElementById('heroCta');
    
    if (!authButtonsContainer) return;

    if (user) {
        // Пользователь авторизован
        authButtonsContainer.innerHTML = `
            <a href="/news.html" class="btn btn-outline">Личный кабинет</a>
        `;
        if (heroCta) {
            heroCta.innerHTML = `
                <a href="/news.html" class="btn btn-large btn-gold">Личный кабинет</a>
                <a href="#features" class="btn btn-large btn-outline">Узнать больше</a>
            `;
        }
    } else {
        // Пользователь не авторизован
        authButtonsContainer.innerHTML = `
            <a href="/login.html" class="btn btn-outline">Войти</a>
            <a href="/login.html" class="btn btn-gold">Регистрация</a>
        `;
        if (heroCta) {
            heroCta.innerHTML = `
                <a href="/login.html" class="btn btn-large btn-gold">Регистрация</a>
                <a href="#features" class="btn btn-large btn-outline">Узнать больше</a>
            `;
        }
    }
}

// Следим за состоянием авторизации
onAuthStateChanged(auth, (user) => {
    updateAuthButtons(user);
});

// Плавный скролл к якорям
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

// Анимация хедера при скролле
window.addEventListener('scroll', function() {
    const header = document.getElementById('mainHeader');
    if (!header) return;
    
    if (window.scrollY > 50) {
        header.classList.add('header-scrolled');
    } else {
        header.classList.remove('header-scrolled');
    }
});

// Обработка ошибок
window.addEventListener('error', function(e) {
    console.log('Поймана ошибка:', e.message);
});