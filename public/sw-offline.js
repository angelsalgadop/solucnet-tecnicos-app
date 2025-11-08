// Service Worker para SolucNet Técnicos - Modo Offline Completo
const CACHE_NAME = 'solucnet-tecnicos-v1.0.0';
const OFFLINE_DATA_STORE = 'solucnet-offline-data';
const SYNC_TAG = 'sync-visitas';

// Recursos críticos para cachear (funcionamiento offline completo)
const CRITICAL_RESOURCES = [
    '/tecnicos_visitas.html',
    '/tecnicos_visitas.js',
    '/serial_scanner_native.js',
    '/login_tecnicos.html',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install: Cachear recursos críticos
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Cacheando recursos críticos');
            return cache.addAll(CRITICAL_RESOURCES);
        }).then(() => {
            console.log('[SW] Service Worker instalado correctamente');
            return self.skipWaiting();
        })
    );
});

// Activate: Limpiar cachés antiguos
self.addEventListener('activate', (event) => {
    console.log('[SW] Activando Service Worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Eliminando caché antigua:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Service Worker activado');
            return self.clients.claim();
        })
    );
});

// Fetch: Estrategia Network-First con fallback a caché
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Solo interceptar requests HTTP/HTTPS
    if (!request.url.startsWith('http')) {
        return;
    }

    // Estrategia diferente según el tipo de recurso
    if (request.method === 'GET') {
        // Para recursos estáticos: Cache-First
        if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/)) {
            event.respondWith(cacheFirst(request));
        }
        // Para HTML y APIs: Network-First con caché como fallback
        else {
            event.respondWith(networkFirst(request));
        }
    } else {
        // POST/PUT/DELETE: Intentar primero online con timeout, si falla guardar para sync
        event.respondWith(
            (async () => {
                try {
                    // Crear AbortController para timeout
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos timeout

                    const response = await fetch(request.clone(), {
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);
                    return response;
                } catch (error) {
                    console.log('[SW] Request falló, guardando para sync:', request.url);
                    console.log('[SW] Error:', error.name, error.message);

                    // Guardar request en IndexedDB para sincronización posterior
                    const requestData = {
                        url: request.url,
                        method: request.method,
                        headers: [...request.headers.entries()],
                        body: await request.clone().text(),
                        timestamp: Date.now()
                    };

                    await saveOfflineRequest(requestData);

                    // Registrar background sync si está disponible
                    if ('sync' in self.registration) {
                        await self.registration.sync.register(SYNC_TAG);
                    }

                    // Devolver respuesta offline
                    return new Response(
                        JSON.stringify({
                            success: false,
                            offline: true,
                            message: 'Datos guardados localmente. Se sincronizarán cuando haya conexión.'
                        }),
                        {
                            status: 200,
                            headers: { 'Content-Type': 'application/json' }
                        }
                    );
                }
            })()
        );
    }
});

// Background Sync: Sincronizar datos cuando se restaure la conexión
self.addEventListener('sync', (event) => {
    console.log('[SW] Background Sync activado:', event.tag);

    if (event.tag === SYNC_TAG) {
        event.waitUntil(syncOfflineData());
    }
});

// Estrategia Cache-First con timeout
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        // Crear AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos timeout

        const networkResponse = await fetch(request, {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        console.error('[SW] Cache-First falló:', error);
        return new Response('Offline', { status: 503 });
    }
}

// Estrategia Network-First con timeout
async function networkFirst(request) {
    try {
        // Crear AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 segundos timeout

        const networkResponse = await fetch(request, {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        console.log('[SW] Network falló, usando caché:', request.url);
        console.log('[SW] Error:', error.name, error.message);

        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        // Si no hay caché y es una página HTML, devolver página offline
        if (request.headers.get('accept').includes('text/html')) {
            return caches.match('/offline.html');
        }

        return new Response('Offline', { status: 503 });
    }
}

// Guardar request offline en IndexedDB
async function saveOfflineRequest(requestData) {
    const db = await openDB();
    const tx = db.transaction('offline-requests', 'readwrite');
    const store = tx.objectStore('offline-requests');
    await store.add(requestData);

    // Notificar a los clientes que hay datos offline pendientes
    notifyClientsOfflineData();
}

// Sincronizar datos offline cuando se restaure conexión
async function syncOfflineData() {
    console.log('[SW] Iniciando sincronización de datos offline...');

    const db = await openDB();
    const tx = db.transaction('offline-requests', 'readwrite');
    const store = tx.objectStore('offline-requests');
    const requests = await store.getAll();

    if (requests.length === 0) {
        console.log('[SW] No hay datos offline para sincronizar');
        return;
    }

    console.log(`[SW] Sincronizando ${requests.length} requests offline...`);

    for (const requestData of requests) {
        try {
            // Reconstruir el request
            const headers = new Headers(requestData.headers);
            const response = await fetch(requestData.url, {
                method: requestData.method,
                headers: headers,
                body: requestData.body || undefined
            });

            if (response.ok) {
                console.log('[SW] Request sincronizada exitosamente:', requestData.url);
                // Eliminar de IndexedDB después de sincronizar
                const deleteTx = db.transaction('offline-requests', 'readwrite');
                const deleteStore = deleteTx.objectStore('offline-requests');
                await deleteStore.delete(requestData.timestamp);
            }
        } catch (error) {
            console.error('[SW] Error sincronizando request:', error);
            // No eliminar, reintentar en próxima sync
        }
    }

    // Notificar a los clientes que la sincronización completó
    notifyClientsSyncComplete();
    console.log('[SW] Sincronización completada');
}

// Abrir IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('solucnet-offline-db', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Store para requests offline
            if (!db.objectStoreNames.contains('offline-requests')) {
                const store = db.createObjectStore('offline-requests', { keyPath: 'timestamp' });
                store.createIndex('url', 'url', { unique: false });
            }

            // Store para visitas offline
            if (!db.objectStoreNames.contains('offline-visitas')) {
                const visitasStore = db.createObjectStore('offline-visitas', { keyPath: 'id' });
                visitasStore.createIndex('tecnico_id', 'tecnico_id', { unique: false });
            }

            // Store para fotos offline
            if (!db.objectStoreNames.contains('offline-fotos')) {
                const fotosStore = db.createObjectStore('offline-fotos', { autoIncrement: true });
                fotosStore.createIndex('visita_id', 'visita_id', { unique: false });
            }
        };
    });
}

// Notificar a clientes sobre datos offline pendientes
function notifyClientsOfflineData() {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'OFFLINE_DATA_PENDING',
                message: 'Hay datos pendientes de sincronización'
            });
        });
    });
}

// Notificar a clientes que la sincronización completó
function notifyClientsSyncComplete() {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETE',
                message: 'Datos sincronizados exitosamente'
            });
        });
    });
}

// Mensaje de log
console.log('[SW] Service Worker SolucNet Técnicos cargado');
