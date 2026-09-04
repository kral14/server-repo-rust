// MasterDeploy Service Worker Auto-Unregister
// Bu köhnə service worker-i brauzerdən təmizləyir ki, network və reload xətaları yaratmasın.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        self.registration.unregister().then(() => {
            return self.clients.matchAll();
        }).then((clients) => {
            clients.forEach(client => {
                if (client.navigate) {
                    client.navigate(client.url);
                }
            });
        })
    );
});
