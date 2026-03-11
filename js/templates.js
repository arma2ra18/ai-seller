// ============================================
// Система шаблонов для генерации карточек
// ============================================

import { cacheSettings } from './cache.js';

// Доступные шаблоны
export const TEMPLATES = {
    'premium': {
        id: 'premium',
        name: 'Премиум',
        icon: '💎',
        description: 'Элегантный дизайн с золотыми акцентами',
        preview: 'premium-preview.jpg',
        colors: {
            primary: '#0071e3',
            secondary: '#f5b041',
            accent: '#9b5ef0',
            background: '#0a0a0c',
            text: '#ffffff'
        },
        fonts: {
            title: 'Inter, sans-serif',
            price: 'Montserrat, sans-serif',
            features: 'Roboto, sans-serif'
        },
        layout: 'centered',
        animation: 'fade'
    },
    
    'minimal': {
        id: 'minimal',
        name: 'Минимализм',
        icon: '⚪',
        description: 'Чистый дизайн без лишних деталей',
        preview: 'minimal-preview.jpg',
        colors: {
            primary: '#ffffff',
            secondary: '#a0a0a0',
            accent: '#0071e3',
            background: '#1c1c1e',
            text: '#ffffff'
        },
        fonts: {
            title: 'SF Pro Display, sans-serif',
            price: 'SF Pro Text, sans-serif',
            features: 'SF Pro Text, sans-serif'
        },
        layout: 'left',
        animation: 'slide'
    },
    
    'bold': {
        id: 'bold',
        name: 'Смелый',
        icon: '🔥',
        description: 'Яркие цвета и крупные акценты',
        preview: 'bold-preview.jpg',
        colors: {
            primary: '#ff453a',
            secondary: '#ffd60a',
            accent: '#30d158',
            background: '#000000',
            text: '#ffffff'
        },
        fonts: {
            title: 'Bebas Neue, cursive',
            price: 'Oswald, sans-serif',
            features: 'Open Sans, sans-serif'
        },
        layout: 'centered',
        animation: 'pulse'
    },
    
    'tech': {
        id: 'tech',
        name: 'Техно',
        icon: '⚡',
        description: 'Футуристический стиль с неоном',
        preview: 'tech-preview.jpg',
        colors: {
            primary: '#00ffff',
            secondary: '#ff00ff',
            accent: '#ffff00',
            background: '#0a0f1f',
            text: '#ffffff'
        },
        fonts: {
            title: 'Orbitron, sans-serif',
            price: 'Rajdhani, sans-serif',
            features: 'Arial, sans-serif'
        },
        layout: 'asymmetric',
        animation: 'glitch'
    },
    
    'elegant': {
        id: 'elegant',
        name: 'Элегантный',
        icon: '✨',
        description: 'Изысканный дизайн с пастельными тонами',
        preview: 'elegant-preview.jpg',
        colors: {
            primary: '#d4b1b1',
            secondary: '#b8a9c9',
            accent: '#a9c9b8',
            background: '#2a2a2e',
            text: '#ffffff'
        },
        fonts: {
            title: 'Playfair Display, serif',
            price: 'Cormorant Garamond, serif',
            features: 'Lato, sans-serif'
        },
        layout: 'centered',
        animation: 'fade'
    },
    
    'custom': {
        id: 'custom',
        name: 'Свой стиль',
        icon: '🎨',
        description: 'Настройте всё под себя',
        preview: null,
        colors: {
            primary: '#0071e3',
            secondary: '#f5b041',
            accent: '#9b5ef0',
            background: '#0a0a0c',
            text: '#ffffff'
        },
        fonts: {
            title: 'Inter, sans-serif',
            price: 'Montserrat, sans-serif',
            features: 'Roboto, sans-serif'
        },
        layout: 'centered',
        animation: 'fade'
    }
};

// Доступные цвета
export const COLOR_PALETTE = [
    { name: 'Синий', value: '#0071e3' },
    { name: 'Золотой', value: '#f5b041' },
    { name: 'Фиолетовый', value: '#9b5ef0' },
    { name: 'Красный', value: '#ff453a' },
    { name: 'Зеленый', value: '#30d158' },
    { name: 'Оранжевый', value: '#ff9f0a' },
    { name: 'Розовый', value: '#ff375f' },
    { name: 'Бирюзовый', value: '#64d2ff' },
    { name: 'Белый', value: '#ffffff' },
    { name: 'Черный', value: '#000000' },
    { name: 'Серый', value: '#8e8e93' }
];

// Доступные шрифты
export const FONTS = [
    { name: 'Inter', value: 'Inter, sans-serif', category: 'sans-serif' },
    { name: 'Montserrat', value: 'Montserrat, sans-serif', category: 'sans-serif' },
    { name: 'Roboto', value: 'Roboto, sans-serif', category: 'sans-serif' },
    { name: 'Open Sans', value: 'Open Sans, sans-serif', category: 'sans-serif' },
    { name: 'Bebas Neue', value: 'Bebas Neue, cursive', category: 'display' },
    { name: 'Oswald', value: 'Oswald, sans-serif', category: 'sans-serif' },
    { name: 'Playfair Display', value: 'Playfair Display, serif', category: 'serif' },
    { name: 'Orbitron', value: 'Orbitron, sans-serif', category: 'display' },
    { name: 'SF Pro Display', value: 'SF Pro Display, sans-serif', category: 'sans-serif' },
    { name: 'SF Pro Text', value: 'SF Pro Text, sans-serif', category: 'sans-serif' }
];

// Доступные анимации
export const ANIMATIONS = [
    { name: 'Затухание', value: 'fade' },
    { name: 'Скольжение', value: 'slide' },
    { name: 'Масштабирование', value: 'scale' },
    { name: 'Пульсация', value: 'pulse' },
    { name: 'Глитч', value: 'glitch' },
    { name: 'Вращение', value: 'rotate' }
];

// Доступные layouts
export const LAYOUTS = [
    { name: 'По центру', value: 'centered' },
    { name: 'Слева', value: 'left' },
    { name: 'Справа', value: 'right' },
    { name: 'Асимметричный', value: 'asymmetric' }
];

/**
 * Сохранить настройки шаблона пользователя
 */
export async function saveUserTemplate(userId, template) {
    try {
        const templateData = {
            ...template,
            updatedAt: new Date().toISOString()
        };
        
        localStorage.setItem(`template_${userId}`, JSON.stringify(templateData));
        
        console.log('✅ Шаблон сохранен');
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения шаблона:', error);
        return false;
    }
}

/**
 * Загрузить настройки шаблона пользователя
 */
export function loadUserTemplate(userId) {
    try {
        const saved = localStorage.getItem(`template_${userId}`);
        if (saved) {
            return JSON.parse(saved);
        }
        return TEMPLATES.premium; // По умолчанию премиум
    } catch (error) {
        console.error('❌ Ошибка загрузки шаблона:', error);
        return TEMPLATES.premium;
    }
}

/**
 * Сгенерировать CSS для шаблона
 */
export function generateTemplateCSS(template) {
    return `
        /* Динамические стили для шаблона */
        .generated-card {
            --card-primary: ${template.colors.primary};
            --card-secondary: ${template.colors.secondary};
            --card-accent: ${template.colors.accent};
            --card-bg: ${template.colors.background};
            --card-text: ${template.colors.text};
            
            font-family: ${template.fonts.title};
            background: var(--card-bg);
            color: var(--card-text);
        }
        
        .generated-card .card-title {
            font-family: ${template.fonts.title};
            color: var(--card-primary);
        }
        
        .generated-card .card-price {
            font-family: ${template.fonts.price};
            color: var(--card-secondary);
        }
        
        .generated-card .card-features {
            font-family: ${template.fonts.features};
            color: var(--card-text);
        }
        
        /* Анимации */
        ${getAnimationCSS(template.animation)}
        
        /* Layout */
        ${getLayoutCSS(template.layout)}
    `;
}

/**
 * Получить CSS для анимации
 */
function getAnimationCSS(animation) {
    switch(animation) {
        case 'fade':
            return `
                .generated-card {
                    animation: fadeIn 0.5s ease;
                }
            `;
        case 'slide':
            return `
                .generated-card {
                    animation: slideInRight 0.5s ease;
                }
            `;
        case 'scale':
            return `
                .generated-card {
                    animation: scaleIn 0.5s ease;
                }
            `;
        case 'pulse':
            return `
                .generated-card {
                    animation: pulse 2s infinite;
                }
            `;
        case 'glitch':
            return `
                .generated-card {
                    animation: glitch 0.3s infinite;
                }
                
                @keyframes glitch {
                    0% { transform: translate(0); }
                    20% { transform: translate(-2px, 2px); }
                    40% { transform: translate(-2px, -2px); }
                    60% { transform: translate(2px, 2px); }
                    80% { transform: translate(2px, -2px); }
                    100% { transform: translate(0); }
                }
            `;
        case 'rotate':
            return `
                .generated-card {
                    animation: rotateIn 0.5s ease;
                }
                
                @keyframes rotateIn {
                    from {
                        transform: rotate(-10deg) scale(0.9);
                        opacity: 0;
                    }
                    to {
                        transform: rotate(0) scale(1);
                        opacity: 1;
                    }
                }
            `;
        default:
            return '';
    }
}

/**
 * Получить CSS для layout
 */
function getLayoutCSS(layout) {
    switch(layout) {
        case 'centered':
            return `
                .generated-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }
            `;
        case 'left':
            return `
                .generated-card {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    text-align: left;
                }
            `;
        case 'right':
            return `
                .generated-card {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    text-align: right;
                }
            `;
        case 'asymmetric':
            return `
                .generated-card {
                    display: grid;
                    grid-template-columns: 1fr 2fr;
                    gap: 20px;
                }
                
                .generated-card .card-image {
                    grid-column: 1;
                }
                
                .generated-card .card-content {
                    grid-column: 2;
                }
            `;
        default:
            return '';
    }
}