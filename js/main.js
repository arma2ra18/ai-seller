import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Функция для обновления кнопок в зависимости от статуса авторизации
function updateAuthButtons(user) {
    const authButtonsContainer = document.getElementById('authButtons');
    const heroCta = document.getElementById('heroCta');
    
    if (!authButtonsContainer) return;

    if (user) {
        authButtonsContainer.innerHTML = `
            <a href="/dashboard.html" class="btn btn-outline">Личный кабинет</a>
        `;
        if (heroCta) {
            heroCta.innerHTML = `
                <a href="/dashboard.html" class="btn btn-large btn-gold">Личный кабинет</a>
                <a href="#features" class="btn btn-large btn-outline">Узнать больше</a>
            `;
        }
    } else {
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

// Загрузка настроек для куба и карусели
async function loadVisualSettings() {
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'general'));
        if (settingsDoc.exists()) {
            const settings = settingsDoc.data();
            
            // Настройки куба
            if (settings.cubeImages && settings.cubeImages.length > 0) {
                updateCubeImages(settings.cubeImages);
            }
            
            // Настройки карусели
            if (settings.carouselImages && settings.carouselImages.length > 0) {
                updateCarouselImages(settings.carouselImages);
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
    }
}

// Обновление изображений в кубе
function updateCubeImages(images) {
    const faces = document.querySelectorAll('.face img');
    if (faces.length === 0) return;
    
    // Если изображений больше 6, выбираем 6 случайных
    let selectedImages = images;
    if (images.length > 6) {
        // Перемешиваем массив и берём первые 6
        selectedImages = [...images].sort(() => Math.random() - 0.5).slice(0, 6);
    } else if (images.length < 6) {
        // Если меньше 6, дублируем, чтобы заполнить все грани
        selectedImages = [];
        for (let i = 0; i < 6; i++) {
            selectedImages.push(images[i % images.length]);
        }
    }
    
    faces.forEach((img, index) => {
        if (index < selectedImages.length) {
            img.src = selectedImages[index];
            img.alt = `Пример ${index + 1}`;
        }
    });
}

// Обновление изображений в карусели
function updateCarouselImages(images) {
    // Эта функция будет вызвана после того, как карусель инициализирована
    // Переопределяем массив images в существующем скрипте карусели
    if (window.carouselImages && window.updateCarouselTrack) {
        window.carouselImages = images;
        window.updateCarouselTrack();
    } else {
        // Сохраняем для последующего использования
        window.pendingCarouselImages = images;
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

// Загружаем настройки при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    loadVisualSettings();
});