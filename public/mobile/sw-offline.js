// Service Worker para SolucNet Técnicos - Modo Offline Completo
const CACHE_NAME = 'solucnet-tecnicos-v1.67.0-MAPAS-OFFLINE';
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
    console.log('[SW] 🔄 Instalando Service Worker v1.67 - MAPAS OFFLINE...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            // Eliminar TODAS las cachés antiguas inmediatamente
            console.log('[SW] 🗑️ Eliminando TODAS las cachés antiguas:', cacheNames);
            return Promise.all(
                cacheNames.map((cacheName) => caches.delete(cacheName))
            );
        }).then(() => {
            return caches.open(CACHE_NAME);
        }).then((cache) => {
            console.log('[SW] 💾 Cacheando recursos críticos con versión nueva');
            return cache.addAll(CRITICAL_RESOURCES);
        }).then(() => {
            console.log('[SW] ✅ Service Worker v1.67 instalado correctamente');
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

    // 🔧 v1.67: Interceptar tiles de mapas para modo offline
    if (url.hostname.includes('tile.openstreetmap.org') ||
        url.hostname.includes('arcgisonline.com')) {
        event.respondWith(handleMapTile(request, url));
        return;
    }

    // Estrategia diferente según el tipo de recurso
    if (request.method === 'GET') {
        // 🔧 FIX: Cachear archivos PDF y recursos en /uploads/ (fotos, documentos)
        if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|pdf|ogg|mp4|webm)$/)) {
            event.respondWith(cacheFirst(request));
        }
        // 🔧 FIX: Archivos en /uploads/ siempre Cache-First para funcionar offline
        else if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/public/uploads/')) {
            event.respondWith(cacheFirst(request));
        }
        // Para HTML y APIs: Network-First con caché como fallback
        else {
            event.respondWith(networkFirst(request));
        }
    } else {
        // POST/PUT/DELETE: Intentar primero online, si falla guardar para sync
        event.respondWith(
            fetch(request.clone())
                .then(response => {
                    // Envío exitoso
                    return response;
                })
                .catch(async (error) => {
                    console.log('[SW] Request falló, guardando para sync:', request.url);

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
                })
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

// Estrategia Cache-First
async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        console.error('[SW] Cache-First falló:', error);
        return new Response('Offline', { status: 503 });
    }
}

// Estrategia Network-First
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        console.log('[SW] Network falló, usando caché:', request.url);
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

// 🔧 v1.67: Manejar tiles de mapas offline
async function handleMapTile(request, url) {
    // Extraer z/x/y del path: /18/123456/123456.png
    const pathMatch = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png/);

    if (!pathMatch) {
        // Si no es un tile válido, intentar de red
        try {
            return await fetch(request);
        } catch (e) {
            return new Response('Invalid tile', { status: 404 });
        }
    }

    const [, z, x, y] = pathMatch;
    const tileKey = `tile_${z}_${x}_${y}`;

    try {
        // 1. Intentar de red primero (siempre actualizado)
        const networkResponse = await fetch(request, {
            cache: 'no-cache',
            signal: AbortSignal.timeout(3000) // 3 segundos timeout
        });

        if (networkResponse.ok) {
            // Guardar en IndexedDB para uso offline
            const blob = await networkResponse.clone().blob();
            saveMapTileToIDB(tileKey, blob, parseInt(z));
            return networkResponse;
        }
    } catch (error) {
        // Red falló o timeout, intentar desde IndexedDB
        console.log(`[SW] Buscando tile offline: ${tileKey}`);
    }

    // 2. Buscar en IndexedDB si red falló
    try {
        const offlineTile = await getMapTileFromIDB(tileKey);
        if (offlineTile) {
            console.log(`[SW] ✅ Tile offline encontrado: ${tileKey}`);
            return new Response(offlineTile, {
                headers: { 'Content-Type': 'image/png' }
            });
        }
    } catch (error) {
        console.error('[SW] Error buscando tile en IDB:', error);
    }

    // 3. Si no hay offline, devolver tile vacío/transparente
    console.log(`[SW] ⚠️ Tile no disponible offline: ${tileKey}`);
    return new Response(createEmptyTile(), {
        headers: { 'Content-Type': 'image/png' }
    });
}

// Guardar tile en IndexedDB
function saveMapTileToIDB(key, blob, zoom) {
    // Evitar bloquear el SW, hacer async sin await
    const dbName = 'solucnet-offline-maps';
    const storeName = 'map-tiles';

    indexedDB.open(dbName, 1).onsuccess = (event) => {
        const db = event.target.result;
        if (db.objectStoreNames.contains(storeName)) {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.put({
                key: key,
                blob: blob,
                zoom: zoom,
                timestamp: Date.now()
            });
        }
        db.close();
    };
}

// Obtener tile desde IndexedDB
function getMapTileFromIDB(key) {
    return new Promise((resolve) => {
        const dbName = 'solucnet-offline-maps';
        const storeName = 'map-tiles';

        const request = indexedDB.open(dbName, 1);

        request.onsuccess = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(storeName)) {
                db.close();
                resolve(null);
                return;
            }

            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const getRequest = store.get(key);

            getRequest.onsuccess = () => {
                db.close();
                if (getRequest.result) {
                    resolve(getRequest.result.blob);
                } else {
                    resolve(null);
                }
            };

            getRequest.onerror = () => {
                db.close();
                resolve(null);
            };
        };

        request.onerror = () => resolve(null);
    });
}

// Crear tile vacío/transparente
function createEmptyTile() {
    // PNG 1x1 transparente
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return array.buffer;
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
console.log('[SW] ✅ Service Worker SolucNet Técnicos v1.67 CARGADO - Mapas Offline Habilitado');
