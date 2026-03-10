// Проверка авторизации и перенаправление на dashboard
import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// Если пользователь уже вошёл, перенаправляем на dashboard
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Меняем текст кнопок с "Регистрация" на "Личный кабинет"
        const registerBtns = document.querySelectorAll('#registerBtn, #heroRegisterBtn');
        registerBtns.forEach(btn => {
            btn.textContent = 'Личный кабинет';
            btn.href = '/dashboard.html';
        });
    }
});

// Плавный скролл к якорям
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
});

// Анимация хедера при скролле
window.addEventListener('scroll', function() {
    const header = document.getElementById('mainHeader');
    if (window.scrollY > 50) {
        header.classList.add('header-scrolled');
    } else {
        header.classList.remove('header-scrolled');
    }
});