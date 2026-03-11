const fs = require('fs');

// Создаем папку css
if (!fs.existsSync('css')) {
    fs.mkdirSync('css');
    console.log('Папка css создана');
}

// Создаем файлы
const files = [
    'main.css',
    '00-variables.css',
    '01-base.css',
    '02-animations.css',
    '03-components.css',
    '04-header.css',
    '05-footer.css',
    '06-home-hero.css',
    '07-home-stats.css',
    '08-home-features.css',
    '09-home-how-it-works.css',
    '10-home-carousel.css',
    '11-home-reviews.css',
    '12-auth.css',
    '13-dashboard-common.css',
    '14-dashboard-balance.css',
    '15-dashboard-generate.css',
    '16-dashboard-description.css',
    '17-dashboard-history.css',
    '18-dashboard-description-history.css',
    '19-dashboard-settings.css',
    '20-admin.css',
    '21-utilities.css',
    '22-legacy.css'
];

files.forEach(file => {
    const filePath = `css/${file}`;
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `/* ${file.replace('.css', '')} */\n`);
        console.log(`Создан: ${file}`);
    }
});

console.log('Готово!');