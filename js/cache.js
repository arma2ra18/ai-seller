// ============================================
// Система кэширования для Firebase
// ============================================

const CACHE_VERSION = '1.0.0';
const CACHE_PREFIX = 'prodiger_cache';

// Конфигурация кэширования
const CACHE_CONFIG = {
    // Данные пользователя - 5 минут
    userData: {
        storage: 'session', // sessionStorage
        ttl: 5 * 60 * 1000, // 5 минут
        key: (uid) => `${CACHE_PREFIX}_user_${uid}`
    },
    
    // Баланс - 30 секунд (часто меняется)
    balance: {
        storage: 'session',
        ttl: 30 * 1000, // 30 секунд
        key: (uid) => `${CACHE_PREFIX}_balance_${uid}`
    },
    
    // Сессии генераций - 2 минуты
    sessions: {
        storage: 'session',
        ttl: 2 * 60 * 1000, // 2 минуты
        key: (uid, page = 1) => `${CACHE_PREFIX}_sessions_${uid}_page_${page}`
    },
    
    // Описания - 5 минут
    descriptions: {
        storage: 'session',
        ttl: 5 * 60 * 1000, // 5 минут
        key: (uid, page = 1) => `${CACHE_PREFIX}_descriptions_${uid}_page_${page}`
    },
    
    // Настройки - 1 час (редко меняются)
    settings: {
        storage: 'local', // localStorage
        ttl: 60 * 60 * 1000, // 1 час
        key: () => `${CACHE_PREFIX}_settings`
    },
    
    // Шаблоны промптов - 1 день
    templates: {
        storage: 'local',
        ttl: 24 * 60 * 60 * 1000, // 1 день
        key: () => `${CACHE_PREFIX}_templates`
    }
};

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

/**
 * Сохранить данные в кэш
 */
function setCache(type, data, identifier = null) {
    try {
        const config = CACHE_CONFIG[type];
        if (!config) return false;
        
        const key = typeof config.key === 'function' 
            ? config.key(identifier)
            : `${CACHE_PREFIX}_${type}`;
        
        const cacheData = {
            version: CACHE_VERSION,
            timestamp: Date.now(),
            data: data,
            ttl: config.ttl
        };
        
        const storage = config.storage === 'local' ? localStorage : sessionStorage;
        storage.setItem(key, JSON.stringify(cacheData));
        
        console.log(`✅ Кэш сохранен: ${type}`, key);
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения кэша:', error);
        return false;
    }
}

/**
 * Получить данные из кэша
 */
function getCache(type, identifier = null) {
    try {
        const config = CACHE_CONFIG[type];
        if (!config) return null;
        
        const key = typeof config.key === 'function'
            ? config.key(identifier)
            : `${CACHE_PREFIX}_${type}`;
        
        const storage = config.storage === 'local' ? localStorage : sessionStorage;
        const cached = storage.getItem(key);
        
        if (!cached) return null;
        
        const cacheData = JSON.parse(cached);
        
        // Проверяем версию
        if (cacheData.version !== CACHE_VERSION) {
            console.log('⚠️ Устаревшая версия кэша, очищаем');
            storage.removeItem(key);
            return null;
        }
        
        // Проверяем срок действия
        const age = Date.now() - cacheData.timestamp;
        if (age > cacheData.ttl) {
            console.log(`⚠️ Кэш истек: ${type} (возраст: ${Math.round(age/1000)}с)`);
            storage.removeItem(key);
            return null;
        }
        
        console.log(`✅ Кэш загружен: ${type} (возраст: ${Math.round(age/1000)}с)`);
        return cacheData.data;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки кэша:', error);
        return null;
    }
}

/**
 * Очистить кэш по типу
 */
function clearCache(type = null, identifier = null) {
    try {
        if (type) {
            const config = CACHE_CONFIG[type];
            if (!config) return false;
            
            const key = typeof config.key === 'function'
                ? config.key(identifier)
                : `${CACHE_PREFIX}_${type}`;
            
            const storage = config.storage === 'local' ? localStorage : sessionStorage;
            storage.removeItem(key);
            console.log(`🗑️ Кэш очищен: ${type}`);
        } else {
            // Очищаем весь кэш приложения
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(CACHE_PREFIX)) {
                    localStorage.removeItem(key);
                }
            });
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith(CACHE_PREFIX)) {
                    sessionStorage.removeItem(key);
                }
            });
            console.log('🗑️ Весь кэш очищен');
        }
        return true;
    } catch (error) {
        console.error('❌ Ошибка очистки кэша:', error);
        return false;
    }
}

/**
 * Получить данные с приоритетом: кэш -> запрос
 */
async function getCachedData(type, fetchFunction, identifier = null, forceRefresh = false) {
    // Если нужны свежие данные - пропускаем кэш
    if (forceRefresh) {
        console.log(`🔄 Принудительное обновление: ${type}`);
        const freshData = await fetchFunction();
        if (freshData) {
            setCache(type, freshData, identifier);
        }
        return freshData;
    }
    
    // Пробуем получить из кэша
    const cached = getCache(type, identifier);
    if (cached) {
        console.log(`📦 Используем кэш: ${type}`);
        return cached;
    }
    
    // Если нет в кэше - запрашиваем
    console.log(`🌐 Запрос к Firebase: ${type}`);
    const freshData = await fetchFunction();
    if (freshData) {
        setCache(type, freshData, identifier);
    }
    return freshData;
}

// ========== СПЕЦИАЛИЗИРОВАННЫЕ ФУНКЦИИ ==========

/**
 * Кэширование данных пользователя
 */
async function cacheUserData(uid, fetchFunction, forceRefresh = false) {
    return getCachedData('userData', fetchFunction, uid, forceRefresh);
}

/**
 * Кэширование баланса
 */
async function cacheBalance(uid, fetchFunction, forceRefresh = false) {
    return getCachedData('balance', fetchFunction, uid, forceRefresh);
}

/**
 * Кэширование сессий генераций
 */
async function cacheSessions(uid, page, fetchFunction, forceRefresh = false) {
    return getCachedData('sessions', fetchFunction, { uid, page }, forceRefresh);
}

/**
 * Кэширование описаний
 */
async function cacheDescriptions(uid, page, fetchFunction, forceRefresh = false) {
    return getCachedData('descriptions', fetchFunction, { uid, page }, forceRefresh);
}

/**
 * Кэширование настроек
 */
async function cacheSettings(fetchFunction, forceRefresh = false) {
    return getCachedData('settings', fetchFunction, null, forceRefresh);
}

// Экспортируем функции
export {
    setCache,
    getCache,
    clearCache,
    getCachedData,
    cacheUserData,
    cacheBalance,
    cacheSessions,
    cacheDescriptions,
    cacheSettings,
    CACHE_CONFIG
};