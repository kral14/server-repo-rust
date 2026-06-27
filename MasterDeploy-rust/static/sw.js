// MasterDeploy Service Worker - Minimal version (no caching)
// This prevents ERR_FAILED errors by providing a passthrough SW

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Passthrough - do not intercept any fetch requests
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
