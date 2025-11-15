/**
 * OFFLINE MANAGER - SolucNet Técnicos
 * Sistema completo de gestión offline para la aplicación móvil
 * Funcionalidades:
 * - Almacenamiento local de visitas
 * - Caché de fotos y documentos
 * - Sincronización automática
 * - Detección de estado de red
 * - Cola de operaciones pendientes
 */

class OfflineManager {
    constructor() {
        this.db = null;
        this.isOnline = navigator.onLine;
        this.pendingRequests = [];
        this.syncInProgress = false;

        this.init();
    }

    // Inicializar el sistema offline
    async init() {
        try {
            // Abrir IndexedDB
            this.db = await this.openDatabase();

            // Registrar Service Worker
            if ('serviceWorker' in navigator) {
                await this.registerServiceWorker();
            }

            // Configurar listeners de red
            this.setupNetworkListeners();

            // Intentar sincronizar si hay conexión
            if (this.isOnline) {
                await this.syncPendingData();
            }

            console.log('✅ [OFFLINE MANAGER] Sistema offline inicializado correctamente');
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error inicializando:', error);
        }
    }

    // Abrir base de datos IndexedDB
    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('solucnet-offline-db', 5); // 🔧 v1.74: Incrementado a v5 para soporte NAPs offline

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store para visitas offline
                if (!db.objectStoreNames.contains('offline-visitas')) {
                    const visitasStore = db.createObjectStore('offline-visitas', { keyPath: 'id' });
                    visitasStore.createIndex('tecnico_id', 'tecnico_id', { unique: false });
                    visitasStore.createIndex('estado', 'estado', { unique: false });
                    visitasStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // Store para reportes offline
                if (!db.objectStoreNames.contains('offline-reportes')) {
                    const reportesStore = db.createObjectStore('offline-reportes', { autoIncrement: true, keyPath: 'localId' });
                    reportesStore.createIndex('visita_id', 'visita_id', { unique: false });
                    reportesStore.createIndex('sincronizado', 'sincronizado', { unique: false });
                }

                // Store para fotos offline
                if (!db.objectStoreNames.contains('offline-fotos')) {
                    const fotosStore = db.createObjectStore('offline-fotos', { autoIncrement: true, keyPath: 'localId' });
                    fotosStore.createIndex('reporte_id', 'reporte_id', { unique: false });
                    fotosStore.createIndex('sincronizado', 'sincronizado', { unique: false });
                }

                // Store para requests pendientes
                if (!db.objectStoreNames.contains('offline-requests')) {
                    const requestsStore = db.createObjectStore('offline-requests', { keyPath: 'timestamp' });
                    requestsStore.createIndex('url', 'url', { unique: false });
                }

                // Store para coordenadas GPS offline
                if (!db.objectStoreNames.contains('offline-ubicaciones')) {
                    const ubicacionesStore = db.createObjectStore('offline-ubicaciones', { autoIncrement: true, keyPath: 'localId' });
                    ubicacionesStore.createIndex('visita_id', 'visita_id', { unique: false });
                    ubicacionesStore.createIndex('sincronizado', 'sincronizado', { unique: false });
                }

                // 🔧 FIX v1.48: Store para PDFs offline (descargar y eliminar al completar visita)
                if (!db.objectStoreNames.contains('offline-pdfs')) {
                    const pdfsStore = db.createObjectStore('offline-pdfs', { keyPath: 'id', autoIncrement: true });
                    pdfsStore.createIndex('visita_id', 'visita_id', { unique: false });
                    pdfsStore.createIndex('nombre_archivo', 'nombre_archivo', { unique: false });
                    pdfsStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // 🔧 v1.65: Store para visitas completadas permanentemente (persiste en datos de app)
                if (!db.objectStoreNames.contains('visitas-completadas')) {
                    const completadasStore = db.createObjectStore('visitas-completadas', { keyPath: 'visita_id' });
                    completadasStore.createIndex('timestamp_completado', 'timestamp_completado', { unique: false });
                    completadasStore.createIndex('tecnico_id', 'tecnico_id', { unique: false });
                }

                // 🔧 v1.74: Store para cajas NAP offline
                if (!db.objectStoreNames.contains('offline-naps')) {
                    const napsStore = db.createObjectStore('offline-naps', { autoIncrement: true, keyPath: 'localId' });
                    napsStore.createIndex('zona', 'zona', { unique: false });
                    napsStore.createIndex('sincronizado', 'sincronizado', { unique: false });
                    napsStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    // Registrar Service Worker
    async registerServiceWorker() {
        try {
            // 🔧 v1.83.10: NO registrar SW en apps nativas - solo para web
            // En apps nativas todos los assets ya están en local y el SW causa problemas
            if (APP_CONFIG && APP_CONFIG.isNative && APP_CONFIG.isNative()) {
                console.log('📱 [OFFLINE MANAGER] App nativa detectada - Service Worker NO necesario');
                console.log('✅ [OFFLINE MANAGER] Todos los assets ya están en local');
                return null;
            }

            // Solo para versión web
            const registration = await navigator.serviceWorker.register('/sw-offline.js', {
                scope: '/'
            });
            console.log('✅ [OFFLINE MANAGER] Service Worker registrado (web):', registration.scope);

            // Escuchar mensajes del service worker
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event.data);
            });

            return registration;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error registrando Service Worker:', error);
        }
    }

    // Configurar listeners de red
    setupNetworkListeners() {
        window.addEventListener('online', async () => {
            console.log('🟢 [OFFLINE MANAGER] Conexión restaurada');
            this.isOnline = true;
            this.updateUIConnectionStatus(true);

            // Sincronizar datos automáticamente
            await this.syncPendingData();
        });

        window.addEventListener('offline', () => {
            console.log('🔴 [OFFLINE MANAGER] Conexión perdida');
            this.isOnline = false;
            this.updateUIConnectionStatus(false);
        });

        // Estado inicial
        this.updateUIConnectionStatus(navigator.onLine);
    }

    // Actualizar UI con estado de conexión
    updateUIConnectionStatus(isOnline) {
        // Crear o actualizar banner de estado
        let banner = document.getElementById('offline-status-banner');

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'offline-status-banner';
            banner.style.cssText = `
                position: fixed;
                top: 56px;
                left: 0;
                right: 0;
                z-index: 1040;
                padding: 8px 15px;
                text-align: center;
                font-weight: bold;
                font-size: 13px;
                transition: all 0.3s ease;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            `;
            document.body.insertBefore(banner, document.body.firstChild);
        }

        if (!isOnline) {
            banner.style.backgroundColor = '#ff6b6b';
            banner.style.color = 'white';
            banner.innerHTML = `
                <i class="fas fa-wifi-slash"></i> SIN CONEXIÓN - Modo Offline Activado
                ${this.hasPendingData() ? ' | <i class="fas fa-clock"></i> Datos pendientes de sincronización' : ''}
            `;
            banner.style.display = 'block';
        } else {
            banner.style.backgroundColor = '#51cf66';
            banner.style.color = 'white';
            banner.innerHTML = '<i class="fas fa-wifi"></i> CONECTADO';
            banner.style.display = 'block';

            // Ocultar después de 3 segundos si está online
            setTimeout(() => {
                if (this.isOnline) {
                    banner.style.display = 'none';
                }
            }, 3000);
        }
    }

    // Verificar si hay datos pendientes
    async hasPendingData() {
        if (!this.db) return false;

        try {
            const tx = this.db.transaction(['offline-reportes', 'offline-fotos', 'offline-requests'], 'readonly');

            // Buscar reportes pendientes (sincronizado === false)
            const reportesStore = tx.objectStore('offline-reportes');
            const allReportes = await new Promise((resolve) => {
                const request = reportesStore.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });
            // Filtrar manualmente los que no están sincronizados
            const reportes = allReportes.filter(r => r.sincronizado === false);

            // Buscar fotos pendientes (sincronizado === false)
            const fotosStore = tx.objectStore('offline-fotos');
            const allFotos = await new Promise((resolve) => {
                const request = fotosStore.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });
            // Filtrar manualmente las que no están sincronizadas
            const fotos = allFotos.filter(f => f.sincronizado === false);

            // Buscar requests pendientes
            const requestsStore = tx.objectStore('offline-requests');
            const requests = await new Promise((resolve) => {
                const request = requestsStore.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });

            return reportes.length > 0 || fotos.length > 0 || requests.length > 0;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error verificando datos pendientes:', error);
            return false;
        }
    }

    // Guardar visitas para offline
    async saveVisitasOffline(visitas, tecnicoId) {
        if (!this.db) return false;

        try {
            console.log(`🔍 [OFFLINE MANAGER] Guardando ${visitas.length} visitas en IndexedDB...`);

            // 🔧 FIX: Obtener reportes pendientes de sincronización
            const txReportes = this.db.transaction('offline-reportes', 'readonly');
            const storeReportes = txReportes.objectStore('offline-reportes');
            const allReportes = await new Promise((resolve) => {
                const request = storeReportes.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });

            // Filtrar reportes no sincronizados
            const reportesPendientes = allReportes.filter(r => r.sincronizado === false);
            const visitasConReportesPendientes = new Set(reportesPendientes.map(r => String(r.visita_id)));

            if (visitasConReportesPendientes.size > 0) {
                console.log(`⚠️ [OFFLINE MANAGER] ${visitasConReportesPendientes.size} visitas tienen reportes pendientes de sincronización y NO serán agregadas al cache:`, Array.from(visitasConReportesPendientes));
            }

            // 🔧 v1.65: Obtener visitas completadas permanentemente (persisten en datos de app)
            const visitasCompletadasPermanentes = await this.obtenerVisitasCompletadas();
            const visitasCompletadasSet = new Set(visitasCompletadasPermanentes);

            if (visitasCompletadasSet.size > 0) {
                console.log(`🔒 [OFFLINE MANAGER] ${visitasCompletadasSet.size} visitas completadas permanentemente NO se volverán a cargar:`, Array.from(visitasCompletadasSet));
            }

            // Filtrar visitas: excluir las que tienen reportes pendientes Y las completadas permanentemente
            const visitasAGuardar = visitas.filter(v => {
                const id = String(v.id);
                const num = typeof v.id === 'string' ? parseInt(v.id, 10) : v.id;
                return !visitasConReportesPendientes.has(id) && !visitasCompletadasSet.has(num);
            });

            console.log(`📋 [OFFLINE MANAGER] Guardando ${visitasAGuardar.length} de ${visitas.length} visitas (${visitas.length - visitasAGuardar.length} excluidas: ${visitasConReportesPendientes.size} con reportes pendientes + ${visitasCompletadasSet.size} completadas)`);

            // Guardar cada visita en transacción separada
            for (const visita of visitasAGuardar) {
                const tx = this.db.transaction('offline-visitas', 'readwrite');
                const store = tx.objectStore('offline-visitas');

                visita.tecnico_id = tecnicoId;
                visita.timestamp = Date.now();

                await new Promise((resolve, reject) => {
                    const request = store.put(visita);
                    request.onsuccess = () => {
                        console.log(`✅ [OFFLINE MANAGER] Visita ${visita.id} guardada en cache`);
                        resolve();
                    };
                    request.onerror = () => {
                        console.error(`❌ [OFFLINE MANAGER] Error guardando visita ${visita.id}:`, request.error);
                        reject(request.error);
                    };
                });
            }

            console.log(`✅ [OFFLINE MANAGER] ${visitasAGuardar.length} visitas guardadas offline correctamente`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando visitas offline:', error);
            return false;
        }
    }

    // Esperar a que IndexedDB esté listo
    async waitForDB() {
        let attempts = 0;
        while (!this.db && attempts < 50) { // Máximo 5 segundos
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        return this.db !== null;
    }

    // Cargar visitas desde offline
    async loadVisitasOffline(tecnicoId) {
        // Esperar a que db esté listo
        await this.waitForDB();

        if (!this.db) {
            console.log('⚠️ [OFFLINE MANAGER] IndexedDB no está listo después de esperar');
            return [];
        }

        try {
            // 🔧 FIX: Obtener reportes pendientes de sincronización
            const txReportes = this.db.transaction('offline-reportes', 'readonly');
            const storeReportes = txReportes.objectStore('offline-reportes');
            const allReportes = await new Promise((resolve) => {
                const request = storeReportes.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });

            // Filtrar reportes no sincronizados
            const reportesPendientes = allReportes.filter(r => r.sincronizado === false);
            const visitasConReportesPendientes = new Set(reportesPendientes.map(r => parseInt(r.visita_id, 10)));

            if (visitasConReportesPendientes.size > 0) {
                console.log(`⚠️ [OFFLINE MANAGER] ${visitasConReportesPendientes.size} visitas tienen reportes pendientes, serán EXCLUIDAS al cargar:`, Array.from(visitasConReportesPendientes));
            }

            const tx = this.db.transaction('offline-visitas', 'readonly');
            const store = tx.objectStore('offline-visitas');
            const index = store.index('tecnico_id');

            const visitasRaw = await new Promise((resolve) => {
                const request = index.getAll(tecnicoId);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => {
                    console.error('Error obteniendo visitas por índice');
                    resolve([]);
                };
            });

            // 🔧 FIX: Filtrar visitas que tienen reportes pendientes
            const visitas = visitasRaw.filter(v => !visitasConReportesPendientes.has(v.id));

            console.log(`✅ [OFFLINE MANAGER] ${visitas.length} visitas cargadas desde offline (${visitasRaw.length - visitas.length} excluidas por reportes pendientes)`);
            return visitas;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error cargando visitas offline:', error);
            return [];
        }
    }

    // Eliminar visita del cache offline
    async deleteVisitaOffline(visitaId) {
        await this.waitForDB();

        if (!this.db) {
            console.log('⚠️ [OFFLINE MANAGER] IndexedDB no está listo para eliminar visita');
            return false;
        }

        try {
            // 🔧 FIX: Convertir visitaId a número si viene como string
            const visitaIdNum = typeof visitaId === 'string' ? parseInt(visitaId, 10) : visitaId;
            console.log(`🔍 [OFFLINE MANAGER] Intentando eliminar visita ${visitaIdNum} del cache (original: ${visitaId}, tipo: ${typeof visitaId})`);

            // Primero verificar que existe
            const txCheck = this.db.transaction('offline-visitas', 'readonly');
            const storeCheck = txCheck.objectStore('offline-visitas');
            const visitaExiste = await new Promise((resolve) => {
                const request = storeCheck.get(visitaIdNum);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });

            if (!visitaExiste) {
                console.log(`⚠️ [OFFLINE MANAGER] Visita ${visitaIdNum} NO existe en cache (ya fue eliminada o nunca se guardó)`);
                return false;
            }

            console.log(`✅ [OFFLINE MANAGER] Visita ${visitaIdNum} encontrada en cache:`, visitaExiste);

            // Ahora eliminar
            const tx = this.db.transaction('offline-visitas', 'readwrite');
            const store = tx.objectStore('offline-visitas');

            await new Promise((resolve, reject) => {
                const request = store.delete(visitaIdNum);
                request.onsuccess = () => {
                    console.log(`✅ [OFFLINE MANAGER] Delete exitoso para visita ${visitaIdNum}`);
                    resolve();
                };
                request.onerror = () => {
                    console.error(`❌ [OFFLINE MANAGER] Delete falló para visita ${visitaIdNum}:`, request.error);
                    reject(request.error);
                };
            });

            // Verificar que se eliminó
            const txVerify = this.db.transaction('offline-visitas', 'readonly');
            const storeVerify = txVerify.objectStore('offline-visitas');
            const sigueExistiendo = await new Promise((resolve) => {
                const request = storeVerify.get(visitaIdNum);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            });

            if (sigueExistiendo) {
                console.error(`❌ [OFFLINE MANAGER] Visita ${visitaIdNum} SIGUE en cache después de delete!`);
                return false;
            }

            console.log(`🗑️ [OFFLINE MANAGER] Visita ${visitaIdNum} eliminada correctamente del cache`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error eliminando visita offline:', error);
            return false;
        }
    }

    // 🔧 v1.65: Marcar visita como completada permanentemente (persiste en datos de app)
    async marcarVisitaCompletada(visitaId, tecnicoId = null) {
        await this.waitForDB();
        if (!this.db) return false;

        try {
            const visitaIdNum = typeof visitaId === 'string' ? parseInt(visitaId, 10) : visitaId;

            const tx = this.db.transaction('visitas-completadas', 'readwrite');
            const store = tx.objectStore('visitas-completadas');

            const registro = {
                visita_id: visitaIdNum,
                timestamp_completado: Date.now(),
                tecnico_id: tecnicoId
            };

            await new Promise((resolve, reject) => {
                const request = store.put(registro);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            console.log(`✅ [OFFLINE MANAGER] Visita ${visitaIdNum} marcada como completada permanentemente`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error marcando visita como completada:', error);
            return false;
        }
    }

    // 🔧 v1.65: Obtener IDs de visitas completadas permanentemente
    async obtenerVisitasCompletadas() {
        await this.waitForDB();
        if (!this.db) {
            console.warn('⚠️ [OFFLINE MANAGER] DB no disponible, retornando array vacío');
            return [];
        }

        try {
            const tx = this.db.transaction('visitas-completadas', 'readonly');
            const store = tx.objectStore('visitas-completadas');

            const completadas = await new Promise((resolve) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => {
                    console.error('❌ Error leyendo visitas completadas de IndexedDB');
                    resolve([]);
                };
            });

            // Validar y normalizar IDs (asegurar que sean números válidos)
            const ids = completadas
                .map(v => v.visita_id)
                .filter(id => id != null && !isNaN(id)) // Filtrar null, undefined, NaN
                .map(id => typeof id === 'string' ? parseInt(id, 10) : id); // Normalizar a número

            // Eliminar duplicados usando Set (por si acaso)
            const idsUnicos = [...new Set(ids)];

            console.log(`📋 [OFFLINE MANAGER] ${idsUnicos.length} visitas completadas en historial permanente`);

            if (idsUnicos.length > 0) {
                console.log(`🔒 [OFFLINE MANAGER] IDs completados: [${idsUnicos.join(', ')}]`);
            }

            return idsUnicos;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error obteniendo visitas completadas:', error);
            return [];
        }
    }

    // Guardar reporte offline
    async saveReporteOffline(reporteData) {
        if (!this.db) return null;

        try {
            const tx = this.db.transaction('offline-reportes', 'readwrite');
            const store = tx.objectStore('offline-reportes');

            reporteData.sincronizado = false;
            reporteData.timestamp = Date.now();

            // Envolver en Promise para obtener el ID correcto
            const result = await new Promise((resolve, reject) => {
                const request = store.add(reporteData);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            console.log('✅ [OFFLINE MANAGER] Reporte guardado offline con ID:', result);

            // Actualizar banner
            this.updateUIConnectionStatus(this.isOnline);

            return result;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando reporte offline:', error);
            return null;
        }
    }

    // Guardar fotos offline
    async saveFotosOffline(reporteLocalId, fotos) {
        if (!this.db) return false;

        try {
            for (const foto of fotos) {
                // Convertir File a base64 para almacenar
                const base64 = await this.fileToBase64(foto);

                // Crear transacción separada para cada foto
                const tx = this.db.transaction('offline-fotos', 'readwrite');
                const store = tx.objectStore('offline-fotos');

                // Envolver en Promise para manejar correctamente
                await new Promise((resolve, reject) => {
                    const request = store.add({
                        reporte_id: reporteLocalId,
                        nombre: foto.name,
                        tipo: foto.type,
                        tamano: foto.size,
                        data: base64,
                        sincronizado: false,
                        timestamp: Date.now()
                    });
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            }

            console.log(`✅ [OFFLINE MANAGER] ${fotos.length} fotos guardadas offline`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando fotos offline:', error);
            return false;
        }
    }

    // Convertir File a Base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Guardar inicio de visita offline (para sincronizar luego)
    async saveInicioVisitaOffline(visitaId) {
        if (!this.db) return false;

        try {
            const tx = this.db.transaction('offline-requests', 'readwrite');
            const store = tx.objectStore('offline-requests');

            // Envolver en Promise para manejar correctamente
            await new Promise((resolve, reject) => {
                const request = store.add({
                    url: `/api/visitas-tecnicas/${visitaId}/iniciar`,
                    method: 'PUT',
                    data: {},
                    timestamp: Date.now()
                });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            console.log('✅ [OFFLINE MANAGER] Inicio de visita guardado para sincronización posterior');
            this.updateUIConnectionStatus(this.isOnline);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando inicio de visita offline:', error);
            return false;
        }
    }

    // Sincronizar requests pendientes (inicios de visita, etc.)
    async syncRequests() {
        if (!this.db) return;

        // Leer requests pendientes
        const txRead = this.db.transaction('offline-requests', 'readonly');
        const storeRead = txRead.objectStore('offline-requests');
        const requests = await new Promise((resolve) => {
            const req = storeRead.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });

        console.log(`📤 [OFFLINE MANAGER] Sincronizando ${requests.length} requests...`);

        for (const request of requests) {
            try {
                // Obtener token para autorización
                const token = localStorage.getItem('token_tecnico');
                if (!token) {
                    console.error('❌ No hay token disponible para sincronizar request');
                    continue;
                }

                const response = await fetch(APP_CONFIG.getApiUrl(request.url), {
                    method: request.method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: request.data ? JSON.stringify(request.data) : undefined
                });

                if (response.ok) {
                    console.log(`✅ Request ${request.url} sincronizado`);

                    // Crear nueva transacción para delete
                    const txDelete = this.db.transaction('offline-requests', 'readwrite');
                    const storeDelete = txDelete.objectStore('offline-requests');
                    await new Promise((resolve, reject) => {
                        const delReq = storeDelete.delete(request.timestamp);
                        delReq.onsuccess = () => resolve();
                        delReq.onerror = () => reject(delReq.error);
                    });
                }
            } catch (error) {
                console.error(`❌ Error sincronizando request ${request.url}:`, error);
            }
        }
    }

    // Sincronizar datos pendientes
    async syncPendingData() {
        if (this.syncInProgress) {
            console.log('⏳ [OFFLINE MANAGER] Sincronización ya en progreso');
            return;
        }

        if (!this.isOnline) {
            console.log('📴 [OFFLINE MANAGER] Sin conexión, no se puede sincronizar');
            return;
        }

        this.syncInProgress = true;
        console.log('🔄 [OFFLINE MANAGER] Iniciando sincronización...');

        try {
            // Sincronizar requests pendientes (inicios de visita, etc.)
            await this.syncRequests();

            // Sincronizar reportes
            await this.syncReportes();

            // Sincronizar fotos
            await this.syncFotos();

            // 🆕 v1.74: Sincronizar cajas NAP
            await this.syncNaps();

            console.log('✅ [OFFLINE MANAGER] Sincronización completada');

            // Actualizar UI
            this.updateUIConnectionStatus(true);

            // Disparar evento para que la app recargue las visitas
            window.dispatchEvent(new CustomEvent('offline-sync-completed'));
            console.log('📢 [OFFLINE MANAGER] Evento offline-sync-completed disparado');

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error durante sincronización:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    // Sincronizar reportes pendientes
    async syncReportes() {
        if (!this.db) return;

        // Leer reportes pendientes
        const txRead = this.db.transaction('offline-reportes', 'readonly');
        const storeRead = txRead.objectStore('offline-reportes');

        // Obtener todos los reportes y filtrar manualmente (IDBKeyRange.only(false) no funciona con boolean)
        const allReportes = await new Promise((resolve) => {
            const request = storeRead.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });

        // Filtrar manualmente los reportes no sincronizados
        const reportes = allReportes.filter(r => r.sincronizado === false);

        console.log(`📤 [OFFLINE MANAGER] Sincronizando ${reportes.length} reportes...`);

        for (const reporte of reportes) {
            try {
                // Obtener token para autorización
                const token = localStorage.getItem('token_tecnico');
                if (!token) {
                    console.error('❌ No hay token disponible para sincronizar reporte');
                    continue;
                }

                // 🔧 v1.65: Fix tecnico_id vacío - completar desde localStorage si está vacío
                if (!reporte.tecnico_id || reporte.tecnico_id === '' || reporte.tecnico_id === 'unknown') {
                    const userStorage = localStorage.getItem('user_tecnico');
                    if (userStorage) {
                        try {
                            const user = JSON.parse(userStorage);
                            reporte.tecnico_id = user.id || '';
                            console.log(`🔧 [OFFLINE MANAGER] tecnico_id completado desde localStorage: ${reporte.tecnico_id}`);
                        } catch (e) {
                            console.error('❌ [OFFLINE MANAGER] Error parseando user_tecnico:', e);
                        }
                    }
                }

                const response = await fetch(APP_CONFIG.getApiUrl('/api/reportes-visitas'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(reporte)
                });

                if (response.ok) {
                    const result = await response.json();
                    console.log(`✅ Reporte ${reporte.localId} sincronizado (ID servidor: ${result.reporteId})`);

                    // CRÍTICO: Actualizar reporte_id de las fotos asociadas
                    const txFotosRead = this.db.transaction('offline-fotos', 'readonly');
                    const fotosStoreRead = txFotosRead.objectStore('offline-fotos');
                    const fotosIndexRead = fotosStoreRead.index('reporte_id');

                    const fotasDelReporte = await new Promise((resolve) => {
                        const request = fotosIndexRead.getAll(IDBKeyRange.only(reporte.localId));
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = () => resolve([]);
                    });

                    console.log(`🔄 Actualizando reporte_id de ${fotasDelReporte.length} fotos: ${reporte.localId} → ${result.reporteId}`);

                    // Actualizar fotos en nueva transacción
                    for (const foto of fotasDelReporte) {
                        foto.reporte_id = result.reporteId;
                        const txFotosWrite = this.db.transaction('offline-fotos', 'readwrite');
                        const fotosStoreWrite = txFotosWrite.objectStore('offline-fotos');
                        await new Promise((resolve, reject) => {
                            const req = fotosStoreWrite.put(foto);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        });
                    }

                    // Marcar reporte como sincronizado en nueva transacción
                    reporte.sincronizado = true;
                    reporte.serverId = result.reporteId;
                    const txReporteWrite = this.db.transaction('offline-reportes', 'readwrite');
                    const storeWrite = txReporteWrite.objectStore('offline-reportes');
                    await new Promise((resolve, reject) => {
                        const req = storeWrite.put(reporte);
                        req.onsuccess = () => resolve();
                        req.onerror = () => reject(req.error);
                    });

                    // 🔧 FIX: Eliminar la visita del cache ahora que el reporte fue sincronizado
                    if (reporte.visita_id) {
                        try {
                            // 🔧 v1.65: PRIMERO marcar como completada permanentemente
                            await this.marcarVisitaCompletada(reporte.visita_id, reporte.tecnico_id);

                            // DESPUÉS eliminar del cache
                            await this.deleteVisitaOffline(reporte.visita_id);
                            console.log(`🗑️ [OFFLINE MANAGER] Visita ${reporte.visita_id} eliminada del cache después de sincronizar reporte`);
                        } catch (errorDelete) {
                            console.error(`⚠️ [OFFLINE MANAGER] Error eliminando visita ${reporte.visita_id} del cache:`, errorDelete);
                        }
                    }

                    // Si el reporte tiene serial de equipo, asignarlo al completar
                    if (reporte.serialEquipo && reporte.visita_id) {
                        console.log(`📦 [OFFLINE MANAGER] Asignando equipo: ${reporte.serialEquipo} a visita ${reporte.visita_id}`);
                        try {
                            const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');
                            const respAsignar = await fetch(APP_CONFIG.getApiUrl('/api/asignar-equipo'), {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({
                                    visitaId: reporte.visita_id,
                                    serialEquipo: reporte.serialEquipo,
                                    costoEquipo: reporte.costoEquipo || 180000,
                                    tipoEquipo: reporte.tipoEquipo || 'Onu CData'
                                })
                            });

                            if (respAsignar.ok) {
                                console.log(`✅ [OFFLINE MANAGER] Equipo ${reporte.serialEquipo} asignado exitosamente`);
                            } else {
                                console.error(`⚠️ [OFFLINE MANAGER] Error asignando equipo: ${respAsignar.status}`);
                            }
                        } catch (errorAsignar) {
                            console.error(`❌ [OFFLINE MANAGER] Error asignando equipo:`, errorAsignar);
                        }
                    }
                } else {
                    // Error HTTP (400, 500, etc.)
                    const errorText = await response.text();
                    console.error(`❌ [OFFLINE MANAGER] Error sincronizando reporte ${reporte.localId}: HTTP ${response.status}`);
                    console.error(`📋 [OFFLINE MANAGER] Detalles del error:`, errorText);
                    console.error(`📦 [OFFLINE MANAGER] Datos del reporte:`, JSON.stringify(reporte, null, 2));
                }
            } catch (error) {
                console.error(`❌ Error sincronizando reporte ${reporte.localId}:`, error);
            }
        }
    }

    // Sincronizar fotos pendientes
    async syncFotos() {
        if (!this.db) return;

        // Leer fotos pendientes
        const txRead = this.db.transaction('offline-fotos', 'readonly');
        const storeRead = txRead.objectStore('offline-fotos');

        // Obtener todas las fotos y filtrar manualmente (IDBKeyRange.only(false) no funciona con boolean)
        const allFotos = await new Promise((resolve) => {
            const request = storeRead.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });

        // Filtrar manualmente las fotos no sincronizadas
        const fotos = allFotos.filter(f => f.sincronizado === false);

        console.log(`📤 [OFFLINE MANAGER] Sincronizando ${fotos.length} fotos...`);

        // Agrupar fotos por reporte_id
        const fotosPorReporte = {};
        for (const foto of fotos) {
            if (!fotosPorReporte[foto.reporte_id]) {
                fotosPorReporte[foto.reporte_id] = [];
            }
            fotosPorReporte[foto.reporte_id].push(foto);
        }

        // Sincronizar por reporte
        for (const [reporteId, fotosReporte] of Object.entries(fotosPorReporte)) {
            try {
                // Obtener token para autorización
                const token = localStorage.getItem('token_tecnico');
                if (!token) {
                    console.error('❌ No hay token disponible para sincronizar fotos');
                    continue;
                }

                const formData = new FormData();
                formData.append('reporteId', reporteId);

                for (const foto of fotosReporte) {
                    // Convertir base64 a Blob
                    const blob = await fetch(foto.data).then(r => r.blob());
                    formData.append('fotos', blob, foto.nombre);
                }

                const response = await fetch(APP_CONFIG.getApiUrl('/api/reportes-fotos'), {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                if (response.ok) {
                    console.log(`✅ ${fotosReporte.length} fotos del reporte ${reporteId} sincronizadas`);

                    // ⚠️ ELIMINAR fotos del cache inmediatamente después de sincronizar
                    for (const foto of fotosReporte) {
                        const txDelete = this.db.transaction('offline-fotos', 'readwrite');
                        const storeDelete = txDelete.objectStore('offline-fotos');
                        await new Promise((resolve, reject) => {
                            const req = storeDelete.delete(foto.localId);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        });
                        console.log(`🗑️ Foto ${foto.localId} eliminada del cache`);
                    }
                } else {
                    // Error HTTP
                    const errorText = await response.text();
                    console.error(`❌ [OFFLINE MANAGER] Error sincronizando fotos del reporte ${reporteId}: HTTP ${response.status}`);
                    console.error(`📋 [OFFLINE MANAGER] Detalles del error:`, errorText);
                }
            } catch (error) {
                console.error(`❌ Error sincronizando fotos del reporte ${reporteId}:`, error);
            }
        }
    }

    // Manejar mensajes del service worker
    handleServiceWorkerMessage(data) {
        console.log('[OFFLINE MANAGER] Mensaje del SW:', data);

        switch (data.type) {
            case 'OFFLINE_DATA_PENDING':
                this.updateUIConnectionStatus(this.isOnline);
                break;

            case 'SYNC_COMPLETE':
                console.log('✅ Background Sync completado');
                this.updateUIConnectionStatus(this.isOnline);
                break;
        }
    }

    // Limpiar datos antiguos (mayores a 30 días)
    async cleanOldData() {
        if (!this.db) return;

        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        const tx = this.db.transaction(['offline-reportes', 'offline-fotos'], 'readwrite');

        const reportesStore = tx.objectStore('offline-reportes');
        const reportes = await reportesStore.getAll();

        for (const reporte of reportes) {
            if (reporte.sincronizado && reporte.timestamp < thirtyDaysAgo) {
                await reportesStore.delete(reporte.localId);
            }
        }

        console.log('🧹 [OFFLINE MANAGER] Datos antiguos limpiados');
    }

    // 🔧 FIX v1.48: Funciones para manejar PDFs offline

    // Guardar PDF en IndexedDB
    async savePdfOffline(visitaId, nombreArchivo, nombreOriginal, pdfBlob) {
        try {
            if (!this.db) {
                throw new Error('Base de datos no inicializada');
            }

            const tx = this.db.transaction('offline-pdfs', 'readwrite');
            const store = tx.objectStore('offline-pdfs');

            const pdfData = {
                visita_id: visitaId,
                nombre_archivo: nombreArchivo,
                nombre_original: nombreOriginal,
                blob: pdfBlob,
                timestamp: Date.now()
            };

            await store.add(pdfData);
            console.log(`📥 [OFFLINE MANAGER] PDF guardado: ${nombreArchivo} (visita ${visitaId})`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando PDF:', error);
            return false;
        }
    }

    // Obtener PDF específico desde IndexedDB
    async getPdfOffline(visitaId, nombreArchivo) {
        try {
            if (!this.db) return null;

            const tx = this.db.transaction('offline-pdfs', 'readonly');
            const store = tx.objectStore('offline-pdfs');
            const index = store.index('visita_id');

            // 🔧 FIX v1.49: Envolver getAll en Promise correctamente
            const pdfs = await new Promise((resolve, reject) => {
                const request = index.getAll(visitaId);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            const pdf = pdfs.find(p => p.nombre_archivo === nombreArchivo);
            if (pdf) {
                console.log(`📄 [OFFLINE MANAGER] PDF encontrado en cache: ${nombreArchivo}`);
                return pdf.blob;
            }

            return null;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error obteniendo PDF:', error);
            return null;
        }
    }

    // Obtener todos los PDFs de una visita
    async getPdfsForVisita(visitaId) {
        try {
            if (!this.db) return [];

            const tx = this.db.transaction('offline-pdfs', 'readonly');
            const store = tx.objectStore('offline-pdfs');
            const index = store.index('visita_id');

            // 🔧 FIX v1.49: Envolver getAll en Promise correctamente
            const pdfs = await new Promise((resolve, reject) => {
                const request = index.getAll(visitaId);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            console.log(`📄 [OFFLINE MANAGER] ${pdfs.length} PDFs encontrados para visita ${visitaId}`);
            return pdfs;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error obteniendo PDFs:', error);
            return [];
        }
    }

    // Eliminar todos los PDFs de una visita (al completar)
    async deletePdfsForVisita(visitaId) {
        try {
            if (!this.db) return false;

            const tx = this.db.transaction('offline-pdfs', 'readwrite');
            const store = tx.objectStore('offline-pdfs');
            const index = store.index('visita_id');

            // 🔧 FIX v1.49: Envolver getAll en Promise correctamente
            const pdfs = await new Promise((resolve, reject) => {
                const request = index.getAll(visitaId);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            // Eliminar cada PDF
            for (const pdf of pdfs) {
                await new Promise((resolve, reject) => {
                    const deleteRequest = store.delete(pdf.id);
                    deleteRequest.onsuccess = () => resolve();
                    deleteRequest.onerror = () => reject(deleteRequest.error);
                });
            }

            console.log(`🗑️ [OFFLINE MANAGER] ${pdfs.length} PDFs eliminados para visita ${visitaId}`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error eliminando PDFs:', error);
            return false;
        }
    }

    // Verificar si un PDF existe en caché
    async hasPdfCached(visitaId, nombreArchivo) {
        const pdf = await this.getPdfOffline(visitaId, nombreArchivo);
        return pdf !== null;
    }

    // 🆕 v1.74: Guardar caja NAP offline
    async guardarNapOffline(napData) {
        await this.waitForDB();
        if (!this.db) {
            throw new Error('Base de datos no disponible');
        }

        try {
            const tx = this.db.transaction('offline-naps', 'readwrite');
            const store = tx.objectStore('offline-naps');

            // Agregar campos de control
            const napOffline = {
                ...napData,
                sincronizado: false,
                timestamp: Date.now()
            };

            await new Promise((resolve, reject) => {
                const request = store.add(napOffline);
                request.onsuccess = () => {
                    console.log('💾 [OFFLINE MANAGER] Caja NAP guardada offline:', napData.zona);
                    resolve(request.result);
                };
                request.onerror = () => reject(request.error);
            });

            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando NAP offline:', error);
            throw error;
        }
    }

    // 🆕 v1.74: Sincronizar cajas NAP pendientes
    async syncNaps() {
        if (!this.db) return;

        try {
            // Leer NAPs pendientes
            const tx = this.db.transaction('offline-naps', 'readonly');
            const store = tx.objectStore('offline-naps');

            const allNaps = await new Promise((resolve) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });

            // Filtrar NAPs no sincronizados
            const naps = allNaps.filter(n => n.sincronizado === false);

            console.log(`📤 [OFFLINE MANAGER] Sincronizando ${naps.length} cajas NAP...`);

            for (const nap of naps) {
                try {
                    // Obtener token para autorización
                    const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');
                    if (!token) {
                        console.error('❌ No hay token disponible para sincronizar NAP');
                        continue;
                    }

                    // Preparar datos para enviar
                    const napData = {
                        zona: nap.zona,
                        puertos: nap.puertos,
                        ubicacion: nap.ubicacion,
                        detalles: nap.detalles,
                        latitud: nap.latitud,
                        longitud: nap.longitud,
                        precision: nap.precision
                    };

                    // Enviar al servidor
                    const response = await fetch(APP_CONFIG.getApiUrl('/api/cajas-nap'), {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(napData)
                    });

                    const resultado = await response.json();

                    if (resultado.success) {
                        console.log(`✅ [OFFLINE MANAGER] NAP sincronizada: ${nap.zona}`);

                        // Marcar como sincronizado
                        const txUpdate = this.db.transaction('offline-naps', 'readwrite');
                        const storeUpdate = txUpdate.objectStore('offline-naps');

                        await new Promise((resolve, reject) => {
                            nap.sincronizado = true;
                            const updateRequest = storeUpdate.put(nap);
                            updateRequest.onsuccess = () => resolve();
                            updateRequest.onerror = () => reject(updateRequest.error);
                        });
                    } else {
                        console.error(`❌ [OFFLINE MANAGER] Error sincronizando NAP:`, resultado.message);
                    }
                } catch (error) {
                    console.error(`❌ [OFFLINE MANAGER] Error sincronizando NAP ${nap.zona}:`, error);
                    // No marcar como sincronizado, reintentar en próximo sync
                }
            }

            console.log('✅ [OFFLINE MANAGER] Sincronización de NAPs completada');
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error en syncNaps:', error);
        }
    }
}

// Instancia global del Offline Manager
window.offlineManager = new OfflineManager();

console.log('📱 [OFFLINE MANAGER] Módulo cargado');
