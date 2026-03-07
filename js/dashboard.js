import { auth, db } from './firebase.js';
import { doc, getDoc, collection, addDoc, query, orderBy, getDocs, updateDoc, increment, limit } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
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
        showNotification('Лимит исчерпан', 'error');
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
        showNotification('Заполните категорию и название', 'warning');
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
        showNotification('Готово!', 'success');
        
    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
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
    showNotification('Скопировано!', 'success');
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
    alert('Просмотр истории: ' + id);
};

window.generateProductPhoto = async function() {
    if (!currentUser || !userData) return;
    
    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;
    
    if ((userData.usedGenerations || 0) + 2 >= maxGen) {
        showNotification('Недостаточно токенов', 'error');
        return;
    }
    
    const fileInput = document.getElementById('productPhoto');
    if (!fileInput || !fileInput.files[0]) {
        showNotification('Загрузите фото', 'error');
        return;
    }
    
    const prompt = document.getElementById('photoPrompt').value;
    const model = document.getElementById('photoModel').value;
    
    document.getElementById('photoLoading').style.display = 'block';
    document.getElementById('photoResult').style.display = 'none';
    document.getElementById('generatePhotoBtn').disabled = true;
    
    try {
        const productImageBase64 = await fileToBase64(fileInput.files[0]);
        
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                productImage: productImageBase64,
                prompt: prompt,
                model: model
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('generatedImage').src = result.imageUrl;
            document.getElementById('photoResult').style.display = 'block';
            window.lastImageUrl = result.imageUrl;
            
            await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
                type: 'image',
                productName: document.getElementById('productName')?.value || 'Товар',
                imageUrl: result.imageUrl,
                timestamp: new Date().toISOString()
            });
            
            await updateDoc(doc(db, 'users', currentUser.uid), {
                usedGenerations: increment(2)
            });
            
            userData.usedGenerations = (userData.usedGenerations || 0) + 2;
            updateUI();
            showNotification('Фото готово!', 'success');
        }
    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        document.getElementById('photoLoading').style.display = 'none';
        document.getElementById('generatePhotoBtn').disabled = false;
    }
};

window.generateVideo = async function() {
    if (!currentUser || !userData) return;
    
    const maxGen = {
        'start': 30,
        'business': 200,
        'pro': 999999
    }[userData.plan] || 30;
    
    if ((userData.usedGenerations || 0) + 5 >= maxGen) {
        showNotification('Недостаточно токенов (нужно 5)', 'error');
        return;
    }
    
    const fileInput = document.getElementById('videoPhoto');
    if (!fileInput || !fileInput.files[0]) {
        showNotification('Загрузите фото', 'error');
        return;
    }
    
    const videoType = document.getElementById('videoType').value;
    const duration = parseInt(document.getElementById('videoDuration').value);
    const aspectRatio = document.getElementById('videoAspectRatio').value;
    const category = document.getElementById('videoCategory').value;
    const customPrompt = document.getElementById('videoPrompt').value;
    
    let finalPrompt = customPrompt;
    if (!finalPrompt) {
        finalPrompt = promptTemplates[category]?.[videoType] || 'Professional product video';
    }
    
    document.getElementById('videoLoading').style.display = 'block';
    document.getElementById('videoResult').style.display = 'none';
    document.getElementById('generateVideoBtn').disabled = true;
    
    try {
        const productImageBase64 = await fileToBase64(fileInput.files[0]);
        
        const response = await fetch('/api/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                productImage: productImageBase64,
                videoType: videoType,
                duration: duration,
                aspectRatio: aspectRatio,
                customPrompt: finalPrompt
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const videoEl = document.getElementById('generatedVideo');
            videoEl.src = result.videoUrl;
            document.getElementById('videoResult').style.display = 'block';
            window.lastVideoUrl = result.videoUrl;
            
            await addDoc(collection(db, 'users', currentUser.uid, 'generations'), {
                type: 'video',
                productName: document.getElementById('productName')?.value || 'Товар',
                videoUrl: result.videoUrl,
                videoType: videoType,
                timestamp: new Date().toISOString()
            });
            
            await updateDoc(doc(db, 'users', currentUser.uid), {
                usedGenerations: increment(5)
            });
            
            userData.usedGenerations = (userData.usedGenerations || 0) + 5;
            updateUI();
            showNotification('Видео готово!', 'success');
        }
    } catch (error) {
        showNotification('Ошибка: ' + error.message, 'error');
    } finally {
        document.getElementById('videoLoading').style.display = 'none';
        document.getElementById('generateVideoBtn').disabled = false;
    }
};

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });
}

window.downloadImage = function() {
    if (!window.lastImageUrl) return;
    const link = document.createElement('a');
    link.href = window.lastImageUrl;
    link.download = `product-${Date.now()}.jpg`;
    link.click();
};

window.downloadVideo = function() {
    if (!window.lastVideoUrl) return;
    const link = document.createElement('a');
    link.href = window.lastVideoUrl;
    link.download = `video-${Date.now()}.mp4`;
    link.click();
};

window.copyImageUrl = function() {
    if (!window.lastImageUrl) return;
    navigator.clipboard.writeText(window.lastImageUrl);
    showNotification('Ссылка скопирована', 'success');
};

window.copyVideoUrl = function() {
    if (!window.lastVideoUrl) return;
    navigator.clipboard.writeText(window.lastVideoUrl);
    showNotification('Ссылка скопирована', 'success');
};

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; padding: 15px 25px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white; border-radius: 10px; z-index: 1000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

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
    
    document.getElementById('videoCategory')?.addEventListener('change', function() {
        const category = this.value;
        const type = document.getElementById('videoType').value;
        const template = promptTemplates[category]?.[type] || 'Выберите категорию';
        document.getElementById('promptExample').innerHTML = template;
    });
});