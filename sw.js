const CACHE_NAME = 'prodiger-v1';
const API_CACHE_NAME = 'prodiger-api-v1';

// Ресурсы для кэширования при установке
const urlsToCache = [
  '/',
  '/news.html',
  '/balance.html',
  '/generate.html',
  '/description.html',
  '/history.html',
  '/description-history.html',
  '/settings.html',
  '/login.html',
  '/offline.html',
  '/styles/main.css',
  '/styles/00-variables.css',
  '/styles/01-base.css',
  '/styles/02-animations.css',
  '/styles/03-components.css',
  '/styles/04-header.css',
  '/styles/05-footer.css',
  '/styles/06-home-hero.css',
  '/styles/07-home-stats.css',
  '/styles/08-home-features.css',
  '/styles/09-home-how-it-works.css',
  '/styles/10-home-carousel.css',
  '/styles/11-home-reviews.css',
  '/styles/12-auth.css',
  '/styles/13-dashboard-common.css',
  '/styles/14-dashboard-balance.css',
  '/styles/15-dashboard-generate.css',
  '/styles/16-dashboard-description.css',
  '/styles/17-dashboard-history.css',
  '/styles/18-dashboard-description-history.css',
  '/styles/19-dashboard-settings.css',
  '/styles/20-admin.css',
  '/styles/21-utilities.css',
  '/styles/22-legacy.css',
  '/js/firebase.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/main.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js'
];

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker установлен');
  
  // Принудительная активация
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Кэширование ресурсов');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Ошибка кэширования:', error);
      })
  );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', event => {
  console.log('Service Worker активирован');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE_NAME) {
            console.log('Удаление старого кэша:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Немедленно получаем контроль над страницами
      return self.clients.claim();
    })
  );
});

// Стратегия кэширования: Stale-While-Revalidate для страниц
// Network First для API, Cache First для статики
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Для API запросов - сеть или офлайн-заглушка
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Кэшируем успешные ответы API
          const responseClone = response.clone();
          caches.open(API_CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Если сеть недоступна, пытаемся вернуть из кэша
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Если нет в кэше, показываем офлайн-страницу для навигационных запросов
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
            return new Response('Нет соединения', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
        })
    );
    return;
  }
  
  // Для статических ресурсов (CSS, JS, изображения) - Cache First
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Обновляем кэш в фоне
          fetch(event.request).then(response => {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response);
            });
          });
          return cachedResponse;
        }
        return fetch(event.request).then(response => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }
  
  // Для HTML страниц - Stale-While-Revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            // Обновляем кэш
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResponse.clone());
            });
            return networkResponse;
          })
          .catch(() => {
            // Если сеть недоступна и нет в кэше, показываем офлайн-страницу
            return caches.match('/offline.html');
          });
        
        // Возвращаем кэшированную версию сразу, или ждем сеть
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
  
  // Для всего остального - Network First с fallback на кэш
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Кэшируем успешные ответы
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Обработка пуш-уведомлений (для будущих обновлений)
self.addEventListener('push', event => {
  const data = event.data.json();
  
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});