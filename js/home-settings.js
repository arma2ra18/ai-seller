// js/home-settings.js
import { db } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Кэшируем настройки, чтобы не дёргать Firestore при каждом обновлении
let cachedCubeImages = null;
let cachedCarouselImages = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

/**
 * Загружает настройки куба из Firestore
 */
export async function getCubeImages() {
    const now = Date.now();
    
    // Используем кэш, если он свежий
    if (cachedCubeImages && (now - lastFetch) < CACHE_TTL) {
        console.log('📦 Используем кэшированные изображения куба');
        return cachedCubeImages;
    }
    
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'cube'));
        
        if (settingsDoc.exists() && settingsDoc.data().images) {
            const images = settingsDoc.data().images;
            // Проверяем, что минимум 6 изображений (для куба)
            if (images.length >= 6) {
                cachedCubeImages = images.slice(0, 6);
                console.log('✅ Загружены изображения куба из Firestore');
            } else {
                // Если меньше 6, используем дефолтные + дополняем повторениями
                const defaultImages = [
                    "https://storage.googleapis.com/prodiger-cc1c5.firebasestorage.app/generated/card_1773454732102_0.jpg",
                ];
                
                // Берём из настроек сколько есть, остальные из дефолтных
                cachedCubeImages = [];
                for (let i = 0; i < 6; i++) {
                    cachedCubeImages.push(images[i] || defaultImages[i % defaultImages.length]);
                }
                console.log('⚠️ Недостаточно изображений куба, дополнено дефолтными');
            }
        } else {
            // Если настроек нет, используем дефолтные
            cachedCubeImages = [
                "https://storage.googleapis.com/prodiger-cc1c5.firebasestorage.app/generated/card_1773454732102_0.jpg",
            ];
            console.log('📸 Используем дефолтные изображения куба');
        }
        
        lastFetch = now;
        return cachedCubeImages;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки изображений куба:', error);
        // В случае ошибки возвращаем дефолтные
        return [
            "https://storage.googleapis.com/prodiger-cc1c5.firebasestorage.app/generated/card_1773454732102_0.jpg",
        ];
    }
}

/**
 * Загружает настройки карусели из Firestore
 */
export async function getCarouselImages() {
    const now = Date.now();
    
    // Используем отдельный кэш для карусели
    if (cachedCarouselImages && (now - lastFetch) < CACHE_TTL) {
        console.log('📦 Используем кэшированные изображения карусели');
        return cachedCarouselImages;
    }
    
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'carousel'));
        
        if (settingsDoc.exists() && settingsDoc.data().images) {
            const images = settingsDoc.data().images;
            cachedCarouselImages = images.length > 0 ? images : getDefaultCarouselImages();
            console.log(`✅ Загружено ${cachedCarouselImages.length} изображений карусели из Firestore`);
        } else {
            cachedCarouselImages = getDefaultCarouselImages();
            console.log('📸 Используем дефолтные изображения карусели');
        }
        
        lastFetch = now;
        return cachedCarouselImages;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки изображений карусели:', error);
        return getDefaultCarouselImages();
    }
}

/**
 * Возвращает дефолтные изображения для карусели
 */
function getDefaultCarouselImages() {
    return [
        "https://storage.googleapis.com/prodiger-cc1c5.firebasestorage.app/generated/card_1773454732102_0.jpg",

    ];
}

/**
 * Принудительно обновляет кэш (можно вызывать после сохранения настроек)
 */
export function clearHomeCache() {
    cachedCubeImages = null;
    cachedCarouselImages = null;
    lastFetch = 0;
    console.log('🔄 Кэш главной страницы очищен');
}