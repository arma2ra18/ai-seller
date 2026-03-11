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
  '/templates.html',
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
  '/styles/23-templates.css',
  '/js/firebase.js',
  '/js/auth.js',
  '/js/dashboard.js',
  '/js/main.js',
  '/js/cache.js',
  '/js/templates.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Montserrat:wght@400;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Bebas+Neue&family=Oswald:wght@400;600;700&family=Playfair+Display:wght@400;600;700&family=Orbitron:wght@400;600;700&display=swap'
];

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker устанавливается');
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Кэширование ресурсов');
        return cache.addAll(urlsToCache).catch(error => {
          console.error('Ошибка кэширования ресурсов:', error);
          // Продолжаем, даже если некоторые ресурсы не закешировались
        });
      })
  );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', event => {
  console.log('Service Worker активируется');
  
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
      return self.clients.claim();
    })
  );
});

// Стратегия кэширования
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Игнорируем chrome-extension запросы
  if (url.protocol === 'chrome-extension:') {
    return;
  }
  
  // Для POST запросов - только сеть, без кэширования
  if (event.request.method === 'POST') {
    event.respondWith(fetch(event.request).catch(error => {
      console.error('Ошибка POST запроса:', error);
      return new Response('Ошибка сети', { status: 503 });
    }));
    return;
  }
  
  // Для API запросов - Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Кэшируем только успешные GET запросы
          if (event.request.method === 'GET' && response.ok) {
            const responseClone = response.clone();
            caches.open(API_CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone).catch(err => {
                console.log('Не удалось закэшировать API ответ');
              });
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
            return new Response('Нет соединения', { status: 503 });
          });
        })
    );
    return;
  }
  
  // Для статических ресурсов - Cache First
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Обновляем кэш в фоне
          fetch(event.request).then(response => {
            if (response.ok) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, response).catch(err => {});
              });
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response.clone()).catch(err => {});
            });
          }
          return response;
        }).catch(() => {
          return new Response('Ресурс не найден', { status: 404 });
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
            if (networkResponse.ok) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone()).catch(err => {});
              });
            }
            return networkResponse;
          })
          .catch(() => {
            return caches.match('/offline.html');
          });
        
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
  
  // Для всего остального - Network First
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (event.request.method === 'GET' && response.ok) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone()).catch(err => {});
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});