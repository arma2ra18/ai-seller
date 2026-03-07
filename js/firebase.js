import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const firebaseConfig = {
    apiKey: "AIzaSyAllWDGr8TKYeqtjgpM9EWWf5hqSfPJqoI",
    authDomain: "ai-seller-prod-4c0c9.firebaseapp.com",
    projectId: "ai-seller-prod-4c0c9",
    storageBucket: "ai-seller-prod-4c0c9.firebasestorage.app",
    messagingSenderId: "951491114415",
    appId: "1:951491114415:web:de94518305c12d56602b5a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);