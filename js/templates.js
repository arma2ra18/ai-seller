// ============================================
// Система шаблонов для генерации карточек
// ============================================

// Доступные шаблоны с реальными CSS-стилями
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
            text: '#ffffff',
            cardBg: '#1c1c1e'
        },
        fonts: {
            title: "'Inter', sans-serif",
            price: "'Montserrat', sans-serif",
            features: "'Roboto', sans-serif"
        },
        layout: 'centered',
        animation: 'fade',
        cssTemplate: `
            .generated-card {
                background: {{background}};
                color: {{text}};
                border-radius: 24px;
                overflow: hidden;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }
            .generated-card .card-title {
                font-family: {{titleFont}};
                color: {{primary}};
                font-size: 28px;
                font-weight: 700;
                margin-bottom: 15px;
            }
            .generated-card .card-price {
                font-family: {{priceFont}};
                color: {{secondary}};
                font-size: 36px;
                font-weight: 700;
                margin-bottom: 20px;
            }
            .generated-card .card-features {
                font-family: {{featuresFont}};
                color: {{text}};
                list-style: none;
                padding: 0;
            }
            .generated-card .card-features li {
                margin: 10px 0;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .generated-card .card-features li::before {
                content: '✓';
                color: {{accent}};
                font-weight: 700;
                font-size: 18px;
            }
        `
    },
    
    'minimal': {
        id: 'minimal',
        name: 'Минимализм',
        icon: '⚪',
        description: 'Чистый дизайн без лишних деталей',
        colors: {
            primary: '#ffffff',
            secondary: '#a0a0a0',
            accent: '#0071e3',
            background: '#1c1c1e',
            text: '#ffffff',
            cardBg: '#2c2c2e'
        },
        fonts: {
            title: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
            price: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
            features: "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif"
        },
        layout: 'left',
        animation: 'slide',
        cssTemplate: `
            .generated-card {
                background: {{background}};
                color: {{text}};
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            .generated-card .card-title {
                font-family: {{titleFont}};
                color: {{primary}};
                font-size: 24px;
                font-weight: 600;
                margin-bottom: 10px;
            }
            .generated-card .card-price {
                font-family: {{priceFont}};
                color: {{secondary}};
                font-size: 30px;
                font-weight: 600;
                margin-bottom: 15px;
            }
            .generated-card .card-features {
                font-family: {{featuresFont}};
                color: {{text}};
                list-style: none;
                padding: 0;
            }
            .generated-card .card-features li {
                margin: 8px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .generated-card .card-features li::before {
                content: '•';
                color: {{accent}};
                font-weight: 700;
                font-size: 20px;
            }
        `
    },
    
    'bold': {
        id: 'bold',
        name: 'Смелый',
        icon: '🔥',
        description: 'Яркие цвета и крупные акценты',
        colors: {
            primary: '#ff453a',
            secondary: '#ffd60a',
            accent: '#30d158',
            background: '#000000',
            text: '#ffffff',
            cardBg: '#1a1a1a'
        },
        fonts: {
            title: "'Bebas Neue', cursive",
            price: "'Oswald', sans-serif",
            features: "'Open Sans', sans-serif"
        },
        layout: 'centered',
        animation: 'pulse',
        cssTemplate: `
            .generated-card {
                background: {{background}};
                color: {{text}};
                border-radius: 20px;
                overflow: hidden;
                border: 3px solid {{primary}};
                box-shadow: 0 0 30px {{primary}}40;
            }
            .generated-card .card-title {
                font-family: {{titleFont}};
                color: {{primary}};
                font-size: 36px;
                font-weight: 700;
                margin-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 2px;
            }
            .generated-card .card-price {
                font-family: {{priceFont}};
                color: {{secondary}};
                font-size: 42px;
                font-weight: 700;
                margin-bottom: 20px;
                text-shadow: 0 0 20px {{secondary}};
            }
            .generated-card .card-features {
                font-family: {{featuresFont}};
                color: {{text}};
                list-style: none;
                padding: 0;
            }
            .generated-card .card-features li {
                margin: 12px 0;
                display: flex;
                align-items: center;
                gap: 12px;
                font-weight: 600;
            }
            .generated-card .card-features li::before {
                content: '🔥';
                color: {{accent}};
                font-size: 18px;
            }
        `
    },
    
    'tech': {
        id: 'tech',
        name: 'Техно',
        icon: '⚡',
        description: 'Футуристический стиль с неоном',
        colors: {
            primary: '#00ffff',
            secondary: '#ff00ff',
            accent: '#ffff00',
            background: '#0a0f1f',
            text: '#ffffff',
            cardBg: '#111827'
        },
        fonts: {
            title: "'Orbitron', sans-serif",
            price: "'Rajdhani', sans-serif",
            features: "'Arial', sans-serif"
        },
        layout: 'asymmetric',
        animation: 'glitch',
        cssTemplate: `
            .generated-card {
                background: {{background}};
                color: {{text}};
                border-radius: 16px;
                overflow: hidden;
                border: 1px solid {{primary}};
                box-shadow: 0 0 30px {{primary}}60, inset 0 0 30px {{secondary}}40;
                position: relative;
            }
            .generated-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: linear-gradient(90deg, {{primary}}, {{secondary}}, {{accent}});
            }
            .generated-card .card-title {
                font-family: {{titleFont}};
                color: {{primary}};
                font-size: 28px;
                font-weight: 700;
                margin-bottom: 15px;
                text-shadow: 0 0 15px {{primary}};
            }
            .generated-card .card-price {
                font-family: {{priceFont}};
                color: {{secondary}};
                font-size: 36px;
                font-weight: 700;
                margin-bottom: 20px;
                text-shadow: 0 0 15px {{secondary}};
            }
            .generated-card .card-features {
                font-family: {{featuresFont}};
                color: {{text}};
                list-style: none;
                padding: 0;
            }
            .generated-card .card-features li {
                margin: 10px 0;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .generated-card .card-features li::before {
                content: '⚡';
                color: {{accent}};
                font-size: 16px;
            }
        `
    },
    
    'elegant': {
        id: 'elegant',
        name: 'Элегантный',
        icon: '✨',
        description: 'Изысканный дизайн с пастельными тонами',
        colors: {
            primary: '#d4b1b1',
            secondary: '#b8a9c9',
            accent: '#a9c9b8',
            background: '#2a2a2e',
            text: '#ffffff',
            cardBg: '#35353a'
        },
        fonts: {
            title: "'Playfair Display', serif",
            price: "'Cormorant Garamond', serif",
            features: "'Lato', sans-serif"
        },
        layout: 'centered',
        animation: 'fade',
        cssTemplate: `
            .generated-card {
                background: {{background}};
                color: {{text}};
                border-radius: 32px;
                overflow: hidden;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
                border: 1px solid {{primary}}40;
            }
            .generated-card .card-title {
                font-family: {{titleFont}};
                color: {{primary}};
                font-size: 32px;
                font-weight: 700;
                margin-bottom: 15px;
                font-style: italic;
            }
            .generated-card .card-price {
                font-family: {{priceFont}};
                color: {{secondary}};
                font-size: 40px;
                font-weight: 700;
                margin-bottom: 20px;
            }
            .generated-card .card-features {
                font-family: {{featuresFont}};
                color: {{text}};
                list-style: none;
                padding: 0;
            }
            .generated-card .card-features li {
                margin: 12px 0;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .generated-card .card-features li::before {
                content: '✧';
                color: {{accent}};
                font-size: 18px;
            }
        `
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

// Доступные шрифты с реальными примерами
export const FONTS = [
    { 
        name: 'Inter', 
        value: "'Inter', sans-serif", 
        category: 'sans-serif',
        preview: 'Inter — современный гротеск'
    },
    { 
        name: 'Montserrat', 
        value: "'Montserrat', sans-serif", 
        category: 'sans-serif',
        preview: 'Montserrat — геометрический'
    },
    { 
        name: 'Roboto', 
        value: "'Roboto', sans-serif", 
        category: 'sans-serif',
        preview: 'Roboto — нейтральный'
    },
    { 
        name: 'Open Sans', 
        value: "'Open Sans', sans-serif", 
        category: 'sans-serif',
        preview: 'Open Sans — читаемый'
    },
    { 
        name: 'Bebas Neue', 
        value: "'Bebas Neue', cursive", 
        category: 'display',
        preview: 'BEBAS NEUE — ЗАГЛАВНЫЕ'
    },
    { 
        name: 'Oswald', 
        value: "'Oswald', sans-serif", 
        category: 'sans-serif',
        preview: 'OSWALD — Узкий'
    },
    { 
        name: 'Playfair Display', 
        value: "'Playfair Display', serif", 
        category: 'serif',
        preview: 'Playfair Display — с засечками'
    },
    { 
        name: 'Orbitron', 
        value: "'Orbitron', sans-serif", 
        category: 'display',
        preview: 'ORBITRON — футуристический'
    }
];

// Доступные анимации с CSS
export const ANIMATIONS = [
    { 
        name: 'Затухание', 
        value: 'fade',
        css: `
            @keyframes cardFade {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .card-animation {
                animation: cardFade 0.5s ease;
            }
        `
    },
    { 
        name: 'Скольжение', 
        value: 'slide',
        css: `
            @keyframes cardSlide {
                from { 
                    opacity: 0;
                    transform: translateX(30px);
                }
                to { 
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            .card-animation {
                animation: cardSlide 0.5s ease;
            }
        `
    },
    { 
        name: 'Масштабирование', 
        value: 'scale',
        css: `
            @keyframes cardScale {
                from { 
                    opacity: 0;
                    transform: scale(0.9);
                }
                to { 
                    opacity: 1;
                    transform: scale(1);
                }
            }
            .card-animation {
                animation: cardScale 0.5s ease;
            }
        `
    },
    { 
        name: 'Пульсация', 
        value: 'pulse',
        css: `
            @keyframes cardPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.02); }
                100% { transform: scale(1); }
            }
            .card-animation {
                animation: cardPulse 2s infinite;
            }
        `
    },
    { 
        name: 'Глитч', 
        value: 'glitch',
        css: `
            @keyframes cardGlitch {
                0% { transform: translate(0); }
                20% { transform: translate(-2px, 2px); }
                40% { transform: translate(2px, -2px); }
                60% { transform: translate(-2px, -2px); }
                80% { transform: translate(2px, 2px); }
                100% { transform: translate(0); }
            }
            .card-animation {
                animation: cardGlitch 0.3s infinite;
            }
        `
    },
    { 
        name: 'Вращение', 
        value: 'rotate',
        css: `
            @keyframes cardRotate {
                from { 
                    opacity: 0;
                    transform: rotate(-5deg) scale(0.95);
                }
                to { 
                    opacity: 1;
                    transform: rotate(0) scale(1);
                }
            }
            .card-animation {
                animation: cardRotate 0.5s ease;
            }
        `
    }
];

// Доступные layouts
export const LAYOUTS = [
    { 
        name: 'По центру', 
        value: 'centered',
        css: `
            .card-layout {
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
            }
            .card-layout .card-image {
                width: 100%;
                margin-bottom: 20px;
            }
        `
    },
    { 
        name: 'Слева', 
        value: 'left',
        css: `
            .card-layout {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                text-align: left;
            }
            .card-layout .card-image {
                width: 100%;
                margin-bottom: 20px;
            }
        `
    },
    { 
        name: 'Справа', 
        value: 'right',
        css: `
            .card-layout {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                text-align: right;
            }
            .card-layout .card-image {
                width: 100%;
                margin-bottom: 20px;
            }
        `
    },
    { 
        name: 'Асимметричный', 
        value: 'asymmetric',
        css: `
            .card-layout {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
            }
            .card-layout .card-image {
                grid-column: 1;
                width: 100%;
            }
            .card-layout .card-content {
                grid-column: 2;
            }
            @media (max-width: 768px) {
                .card-layout {
                    grid-template-columns: 1fr;
                }
                .card-layout .card-content {
                    grid-column: 1;
                }
            }
        `
    }
];

/**
 * Генерация CSS для шаблона
 */
export function generateTemplateCSS(template) {
    const colors = template.colors;
    const fonts = template.fonts;
    
    // Заменяем плейсхолдеры в CSS-шаблоне
    let css = template.cssTemplate
        .replace(/\{\{background\}\}/g, colors.cardBg || colors.background)
        .replace(/\{\{text\}\}/g, colors.text)
        .replace(/\{\{primary\}\}/g, colors.primary)
        .replace(/\{\{secondary\}\}/g, colors.secondary)
        .replace(/\{\{accent\}\}/g, colors.accent)
        .replace(/\{\{titleFont\}\}/g, fonts.title)
        .replace(/\{\{priceFont\}\}/g, fonts.price)
        .replace(/\{\{featuresFont\}\}/g, fonts.features);
    
    // Добавляем layout
    const layout = LAYOUTS.find(l => l.value === template.layout);
    if (layout) {
        css += layout.css;
    }
    
    // Добавляем анимацию
    const animation = ANIMATIONS.find(a => a.value === template.animation);
    if (animation) {
        css += animation.css;
        css += `.card-animation { animation: ${getAnimationName(template.animation)}; }`;
    }
    
    return css;
}

/**
 * Получить имя анимации
 */
function getAnimationName(animation) {
    const names = {
        'fade': 'cardFade',
        'slide': 'cardSlide',
        'scale': 'cardScale',
        'pulse': 'cardPulse',
        'glitch': 'cardGlitch',
        'rotate': 'cardRotate'
    };
    return names[animation] || 'cardFade';
}

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
        
        // Сохраняем сгенерированный CSS для использования в генерации
        const css = generateTemplateCSS(template);
        localStorage.setItem(`template_css_${userId}`, css);
        
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
        return { ...TEMPLATES.premium };
    } catch (error) {
        console.error('❌ Ошибка загрузки шаблона:', error);
        return { ...TEMPLATES.premium };
    }
}

/**
 * Загрузить CSS шаблона
 */
export function loadTemplateCSS(userId) {
    try {
        return localStorage.getItem(`template_css_${userId}`) || '';
    } catch (error) {
        console.error('❌ Ошибка загрузки CSS:', error);
        return '';
    }
}

/**
 * Применить шаблон к элементу
 */
export function applyTemplateToElement(element, template) {
    if (!element) return;
    
    // Применяем цвета как CSS-переменные
    element.style.setProperty('--card-primary', template.colors.primary);
    element.style.setProperty('--card-secondary', template.colors.secondary);
    element.style.setProperty('--card-accent', template.colors.accent);
    element.style.setProperty('--card-bg', template.colors.background);
    element.style.setProperty('--card-text', template.colors.text);
    element.style.setProperty('--card-cardbg', template.colors.cardBg || template.colors.background);
    
    // Применяем шрифты
    const titleEl = element.querySelector('.preview-title');
    const priceEl = element.querySelector('.preview-price');
    const featuresEl = element.querySelector('.preview-features');
    
    if (titleEl) titleEl.style.fontFamily = template.fonts.title;
    if (priceEl) priceEl.style.fontFamily = template.fonts.price;
    if (featuresEl) featuresEl.style.fontFamily = template.fonts.features;
    
    // Применяем layout
    element.className = element.className.replace(/layout-\S+/g, '').trim();
    element.classList.add(`layout-${template.layout}`);
    
    // Применяем анимацию
    element.style.animation = 'none';
    element.offsetHeight; // Trigger reflow
    element.style.animation = '';
    element.classList.add('card-animation');
}