import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const firebaseConfig = {
    apiKey: "GOOGLE_API_KEY",
    authDomain: "prodiger-cc1c5.firebaseapp.com",
    projectId: "prodiger-cc1c5",
    storageBucket: "prodiger-cc1c5.firebasestorage.app",
    messagingSenderId: "349251703485",
    appId: "1:349251703485:web:9bca36800ec5d6c16c9dd4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);