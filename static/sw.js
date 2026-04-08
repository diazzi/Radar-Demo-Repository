/*
 * sw.js — Service Worker системы РАДАР
 *
 * Стратегии кэширования:
 *   Статика:  Cache First → быстрая загрузка
 *   API:      Network Only → всегда свежие данные
 *   Страницы: Network First → офлайн-фолбэк
 *
 * Push-уведомления: показывает нативные уведомления при алертах
 */

const CACHE_NAME = 'radar-v2';

const PRECACHE = [
    '/',
    '/login',
    '/static/manifest.json',
    '/static/offline.html',
    'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
];

// ── Install ─────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

// ── Activate ────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch ───────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // SSE и API — только сеть
    if (url.pathname === '/stream' ||
        url.pathname.startsWith('/api/') ||
        url.pathname === '/report') {
        return;
    }

    // Навигация — Network First с офлайн-фолбэком
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match('/static/offline.html'))
        );
        return;
    }

    // Статика — Cache First
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => caches.match('/static/offline.html'))
    );
});

// ── Push ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
    let data = { title: 'РАДАР', body: 'Новое уведомление', tag: 'radar', url: '/' };

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body:    data.body,
        tag:     data.tag,
        icon:    '/pwa/icon/192',
        badge:   '/pwa/icon/96',
        vibrate: [300, 100, 300, 100, 300],
        data:    { url: data.url || '/' },
        actions: [
            { action: 'open', title: '📊 Открыть' },
            { action: 'dismiss', title: 'Закрыть' },
        ],
        requireInteraction: data.tag === 'failure',
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// ── Notification Click ──────────────────────────────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'dismiss') return;

    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                // Если окно уже открыто — фокус на него
                for (const client of windowClients) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Иначе — открыть новое
                return clients.openWindow(url);
            })
    );
});
