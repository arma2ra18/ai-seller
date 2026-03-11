// build-css.cjs
const fs = require('fs');
const path = require('path');

// Порядок, в котором нужно собирать файлы
const filesToConcat = [
    'variables.css',
    'base.css',
    'components.css',
    'header-footer.css',
    'home.css',
    'auth.css',
    'dashboard-common.css',
    'dashboard-balance.css',
    'dashboard-generate.css',
    'dashboard-description.css',
    'dashboard-description-history.css',
    'dashboard-settings.css',
    'admin.css'
];

// !!! ВАЖНО: Укажите правильный путь к папке с исходными файлами !!!
// Вариант А: Если файлы в папке styles-src (как я предлагал ранее)
const sourceDir = path.join(__dirname);

// Вариант Б: Если файлы в той же папке, где и скрипт
// const sourceDir = __dirname;

// Вариант В: Если файлы в папке на уровень выше
// const sourceDir = path.join(__dirname);

const destDir = __dirname; // Сохраняем в текущую папку

console.log('📁 Ищем файлы в:', sourceDir);

let combinedCSS = '';
let filesFound = 0;

// Проверяем, существует ли папка с исходниками
if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Папка не найдена: ${sourceDir}`);
    console.log('\n🔍 Возможные варианты:');
    console.log('1. Создайте папку styles-src и переместите туда все CSS файлы');
    console.log('2. Или измените путь в скрипте (раскомментируйте нужный вариант)');
    process.exit(1);
}

// Собираем все стили в одну строку
filesToConcat.forEach(file => {
    const filePath = path.join(sourceDir, file);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        combinedCSS += `/* ===== ${file} ===== */\n${content}\n\n`;
        console.log(`✅ Добавлен: ${file}`);
        filesFound++;
    } catch (err) {
        console.error(`❌ Не найден: ${file} (${err.message})`);
    }
});

if (filesFound === 0) {
    console.error('\n❌ Не найдено ни одного CSS файла!');
    console.log('Проверьте путь:', sourceDir);
    process.exit(1);
}

// Добавляем медиа-запросы (скопируйте их из вашего старого main.css)
// ВАЖНО: Замените этот блок на ваши реальные медиа-запросы
combinedCSS += `
/* ===== АДАПТАЦИЯ ===== */
@media (max-width: 1024px) {
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 768px) {
    .nav .btn-gold {
        display: none;
    }
    .hero .container { flex-direction: column; }
    .stats-grid { grid-template-columns: 1fr; }
    .steps { grid-template-columns: 1fr; }
    .reviews-grid { grid-template-columns: 1fr; }
    .footer-main { grid-template-columns: 1fr; }
    
    .dashboard-wrapper { flex-direction: column; }
    .sidebar {
        width: 100%;
        position: static;
        height: auto;
        border-right: none;
        border-bottom: 1px solid var(--border);
    }
    .sidebar-nav ul { 
        display: flex; 
        flex-wrap: wrap; 
        justify-content: center; 
        gap: 5px; 
    }
    .menu-item { 
        padding: 8px 12px; 
        border-left: none; 
        border-radius: 20px; 
    }
    .main-content { 
        margin-left: 0; 
        padding: 20px; 
        width: 100%; 
    }
    .form-row { flex-direction: column; }
    .image-gallery { grid-template-columns: repeat(2, 1fr); }
    .settings-grid { grid-template-columns: 1fr; }
    .description-grid { grid-template-columns: 1fr; }
    .result-card { position: static; }
}

@media (max-width: 480px) {
    .image-gallery { grid-template-columns: 1fr; }
    .cube { 
        width: 150px; 
        height: 150px; 
    }
    .face { 
        width: 150px; 
        height: 150px; 
    }
    .front { transform: translateZ(75px); }
    .back { transform: rotateY(180deg) translateZ(75px); }
    .right { transform: rotateY(90deg) translateZ(75px); }
    .left { transform: rotateY(-90deg) translateZ(75px); }
    .top { transform: rotateX(90deg) translateZ(75px); }
    .bottom { transform: rotateX(-90deg) translateZ(75px); }
}

/* ===== УТИЛИТЫ ===== */
img, video, iframe { max-width: 100%; height: auto; }
`;

// Записываем итоговый файл
const destPath = path.join(destDir, 'main.css');
fs.writeFileSync(destPath, combinedCSS, 'utf8');

console.log(`\n🎉 Готово! Создан файл: ${destPath}`);
console.log(`📊 Добавлено файлов: ${filesFound} из ${filesToConcat.length}`);
console.log(`📏 Размер: ${(combinedCSS.length / 1024).toFixed(2)} KB`);