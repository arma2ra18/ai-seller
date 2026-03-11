// build-css.cjs
const fs = require('fs');
const path = require('path');

// Текущая папка (styles)
const sourceDir = __dirname;
const destDir = __dirname;

console.log('📁 Папка со стилями:', sourceDir);

// Получаем список всех CSS файлов
let allFiles = [];
try {
    allFiles = fs.readdirSync(sourceDir)
        .filter(file => file.endsWith('.css') && file !== 'main.css' && file !== 'build-css.cjs')
        .sort();
    console.log('📋 Найдены CSS файлы:', allFiles.length);
    allFiles.forEach(f => console.log(`   - ${f}`));
} catch (err) {
    console.error('❌ Ошибка чтения папки:', err.message);
    process.exit(1);
}

// Приоритетный порядок (важные файлы должны быть первыми)
const priorityOrder = [
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

// Сортируем файлы: сначала приоритетные, потом остальные по алфавиту
const sortedFiles = [
    ...priorityOrder.filter(f => allFiles.includes(f)),
    ...allFiles.filter(f => !priorityOrder.includes(f)).sort()
];

console.log('\n📊 Порядок сборки:');
sortedFiles.forEach((f, i) => console.log(`   ${i+1}. ${f}`));

let combinedCSS = '';
let totalLines = 0;

// Собираем все файлы
sortedFiles.forEach(file => {
    const filePath = path.join(sourceDir, file);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').length;
        combinedCSS += `/* ========== ${file} (${lines} строк) ========== */\n${content}\n\n`;
        totalLines += lines;
        console.log(`✅ ${file} — ${lines} строк`);
    } catch (err) {
        console.error(`❌ Ошибка чтения ${file}:`, err.message);
    }
});

// Добавляем резервные медиа-запросы на всякий случай
// (если они уже есть в файлах, они продублируются, но это не страшно)
combinedCSS += `
/* ========== ГЛОБАЛЬНАЯ АДАПТАЦИЯ ========== */
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

// Записываем результат
const destPath = path.join(destDir, 'main.css');
fs.writeFileSync(destPath, combinedCSS, 'utf8');

const finalLines = combinedCSS.split('\n').length;

console.log('\n' + '='.repeat(60));
console.log(`📊 ИТОГОВАЯ СТАТИСТИКА:`);
console.log(`📁 Собрано файлов: ${sortedFiles.length}`);
console.log(`📏 Всего строк в новом main.css: ${finalLines}`);
console.log(`📏 Ожидалось строк (из старого main.css): 2663`);
console.log(`📊 Разница: ${finalLines - 2663} строк`);
console.log('='.repeat(60));

if (finalLines < 2663) {
    console.log('\n⚠️  Новый файл меньше старого на', 2663 - finalLines, 'строк');
    console.log('Возможные причины:');
    console.log('1. В некоторых файлах меньше стилей, чем было в старом main.css');
    console.log('2. Какие-то стили были утеряны при разделении');
    console.log('\n💡 Рекомендация:');
    console.log('Откройте старый main.css и новый main.css в редакторе');
    console.log('и сравните, каких блоков не хватает.');
} else if (finalLines > 2663) {
    console.log('\n✅ Новый файл даже больше старого! Возможно, есть дублирование.');
} else {
    console.log('\n✅ Идеально! Количество строк совпадает!');
}