import { auth, db } from './firebase.js';
import { 
    doc, getDoc, collection, addDoc, query, orderBy, 
    getDocs, updateDoc, increment, limit 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { promptTemplates } from './promptTemplates.js';

let currentUser = null;
let userData = null;

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    currentUser = user;
    await loadUserData();
});

async function loadUserData() {
    if (!currentUser) return;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
            userData = userDoc.data();
            updateUI();
            loadHistory();
        }
    } catch (error) {
        console.error('Error loading user:', error);
    }
}

function updateUI() {
    if (!userData) return;
    
    document.getElementById('userEmail').textContent = currentUser.email;
    
    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;
    
    const used = userData.usedGenerations || 0;
    const remaining = Math.max(0, maxGen - used);
    
    document.getElementById('usedGenerations').textContent = used;
    document.getElementById('maxGenerations').textContent = maxGen;
    document.getElementById('remainingGenerations').textContent = remaining;
    
    const progress = (used / maxGen) * 100;
    document.getElementById('generationProgress').style.width = `${Math.min(progress, 100)}%`;
    
    const planNames = { 'start': 'Старт', 'business': 'Бизнес', 'pro': 'Профи' };
    document.getElementById('userPlan').textContent = planNames[userData.plan] || 'Старт';
    
    if (userData.plan !== 'start') {
        document.getElementById('advancedTab').disabled = false;
    }
}

window.generate = async function() {
    if (!currentUser || !userData) return;
    
    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;
    
    if ((userData.usedGenerations || 0) >= maxGen) {
        alert('Лимит исчерпан');
        return;
    }
    
    const data = {
        category: document.getElementById('category').value,
        productName: document.getElementById('productName').value,
        features: document.getElementById('features').value.split(',').map(f => f.trim()),
        audience: document.getElementById('audience').value,
        keywords: document.getElementById('keywords').value.split(',').map(k => k.trim())
    };
    
    if (!data.category || !data.productName) {
        alert('Заполните категорию и название');
        return;
    }
    
    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Генерация...';
    
    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        displayResults(result);
        
        await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
            type: 'text',
            productName: data.productName,
            result: result,
            timestamp: new Date().toISOString()
        });
        
        await updateDoc(doc(db, 'users', currentUser.uid), {
            usedGenerations: increment(1)
        });
        
        userData.usedGenerations = (userData.usedGenerations || 0) + 1;
        updateUI();
        alert('Готово!');
        
    } catch (error) {
        alert('Ошибка: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '✨ Сгенерировать текст (1 токен)';
    }
};

function displayResults(result) {
    document.getElementById('resultsSection').style.display = 'block';
    
    const namesList = document.getElementById('namesList');
    namesList.innerHTML = '';
    if (result.names) {
        result.names.forEach(name => {
            namesList.innerHTML += `<div class="result-item" onclick="copyText(this)">${name}</div>`;
        });
    }
    
    document.getElementById('descriptionText').textContent = result.description || '';
    
    const specsTable = document.getElementById('specsTable');
    specsTable.innerHTML = '';
    if (result.specs) {
        Object.entries(result.specs).forEach(([key, value]) => {
            specsTable.innerHTML += `<tr><td><strong>${key}</strong></td><td>${value || '—'}</td></tr>`;
        });
    }
}

window.copyText = function(element) {
    navigator.clipboard.writeText(element.textContent);
    alert('Скопировано!');
};

async function loadHistory() {
    if (!currentUser) return;
    
    try {
        const q = query(
            collection(db, 'users', currentUser.uid, 'generations'),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        
        const snapshot = await getDocs(q);
        const historyList = document.getElementById('historyList');
        
        if (snapshot.empty) {
            historyList.innerHTML = '<p>История пуста</p>';
            return;
        }
        
        historyList.innerHTML = '';
        snapshot.forEach(doc => {
            const item = doc.data();
            const date = new Date(item.timestamp).toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
            
            historyList.innerHTML += `
                <div class="history-item">
                    <div><strong>${item.productName || 'Фото'}</strong> <div class="history-date">${date}</div></div>
                    <button class="btn btn-small" onclick="viewHistoryItem('${doc.id}')">👁️</button>
                </div>
            `;
        });
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

window.viewHistoryItem = async function(id) {
    // Здесь можно реализовать просмотр конкретной записи
    alert('Просмотр истории: ' + id);
};

// Остальные функции (generateProductPhoto, generateVideo и т.д.) можно оставить,
// но для них тоже нужно будет исправить импорты (storage и т.д.) аналогично.
// Пока оставим заготовки.

window.generateProductPhoto = async function() {
    alert('Генерация фото временно отключена для отладки');
};

window.generateVideo = async function() {
    alert('Генерация видео временно отключена для отладки');
};

// Инициализация вкладок
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });
    
    document.querySelectorAll('.result-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const resultId = this.dataset.result;
            document.querySelectorAll('.result-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.result-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(`${resultId}-result`).classList.add('active');
        });
    });
});
