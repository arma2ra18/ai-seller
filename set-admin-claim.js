const admin = require('firebase-admin');

// Укажите путь к вашему сервисному аккаунту (скачайте из Firebase Console)
const serviceAccount = require('/prodiger-cc1c5-firebase-adminsdk-fbsvc-b44378187b.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ВСТАВЬТЕ ВАШ UID СЮДА
const uid = 'PxpgJdqDihY3gAaMqqkPZtdqQ2J2';

admin.auth().setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log('✅ Custom claim "admin" установлен!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  });