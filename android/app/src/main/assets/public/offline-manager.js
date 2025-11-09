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

// Configuración del servidor
// API_BASE_URL se declara en el HTML para evitar redeclaración

class OfflineManager {
    constructor() {
        this.db = null;
        this.isOnline = navigator.onLine;
        this.pendingRequests = [];
        this.syncInProgress = false;
        this.isReady = false;

        // Crear promesa que se resolverá cuando init() termine
        this.ready = this.init();
    }

    // Inicializar el sistema offline
    async init() {
        try {
            console.log('🔄 [OFFLINE MANAGER] Inicializando...');

            // Abrir IndexedDB
            this.db = await this.openDatabase();
            console.log('✅ [OFFLINE MANAGER] Base de datos abierta');

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

            this.isReady = true;
            console.log('✅ [OFFLINE MANAGER] Sistema offline inicializado correctamente');
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error inicializando:', error);
            throw error;
        }
    }

    // Abrir base de datos IndexedDB
    openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('solucnet-offline-db', 3);

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

                // Store para inicios de visita offline (pendientes de sincronización)
                if (!db.objectStoreNames.contains('offline-inicios-visita')) {
                    const iniciosStore = db.createObjectStore('offline-inicios-visita', { autoIncrement: true, keyPath: 'localId' });
                    iniciosStore.createIndex('visita_id', 'visita_id', { unique: false });
                    iniciosStore.createIndex('sincronizado', 'sincronizado', { unique: false });
                    iniciosStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    // Registrar Service Worker
    async registerServiceWorker() {
        try {
            const registration = await navigator.serviceWorker.register('/sw-offline.js');
            console.log('✅ [OFFLINE MANAGER] Service Worker registrado:', registration.scope);

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
                top: env(safe-area-inset-top, 40px);
                left: 0;
                right: 0;
                z-index: 9999;
                padding: 10px 15px;
                text-align: center;
                font-weight: bold;
                font-size: 14px;
                transition: all 0.3s ease;
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

            // Usar promesas explícitas para getAll() - SIN parámetros para evitar DataError
            const reportes = await new Promise((resolve, reject) => {
                const request = tx.objectStore('offline-reportes').getAll();
                request.onsuccess = () => {
                    const results = request.result || [];
                    resolve(results.filter(r => r.sincronizado === false));
                };
                request.onerror = () => reject(request.error);
            });

            const fotos = await new Promise((resolve, reject) => {
                const request = tx.objectStore('offline-fotos').getAll();
                request.onsuccess = () => {
                    const results = request.result || [];
                    resolve(results.filter(f => f.sincronizado === false));
                };
                request.onerror = () => reject(request.error);
            });

            const requests = await new Promise((resolve, reject) => {
                const request = tx.objectStore('offline-requests').getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            return reportes.length > 0 || fotos.length > 0 || requests.length > 0;
        } catch (error) {
            console.error('Error verificando datos pendientes:', error);
            return false;
        }
    }

    // Guardar visitas para offline
    async saveVisitasOffline(visitas, tecnicoId) {
        try {
            // ESPERAR A QUE EL MANAGER ESTÉ LISTO
            if (!this.isReady) {
                console.log('⏳ [OFFLINE MANAGER] Esperando a que se inicialice para guardar visitas...');
                await this.ready;
            }

            if (!this.db) return false;

            // Convertir tecnicoId a número
            const tecnicoIdNumero = typeof tecnicoId === 'string' ? parseInt(tecnicoId, 10) : tecnicoId;

            const tx = this.db.transaction('offline-visitas', 'readwrite');
            const store = tx.objectStore('offline-visitas');

            for (const visita of visitas) {
                visita.tecnico_id = tecnicoIdNumero;
                visita.timestamp = Date.now();
                await store.put(visita);
            }

            console.log(`✅ [OFFLINE MANAGER] ${visitas.length} visitas guardadas offline para técnico ${tecnicoIdNumero}`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando visitas offline:', error);
            return false;
        }
    }

    // Cargar visitas desde offline
    async loadVisitasOffline(tecnicoId) {
        try {
            // ESPERAR A QUE EL MANAGER ESTÉ LISTO
            if (!this.isReady) {
                console.log('⏳ [OFFLINE MANAGER] Esperando a que se inicialice para cargar visitas...');
                await this.ready;
            }

            if (!this.db) {
                console.log('❌ [OFFLINE MANAGER] DB no disponible');
                return [];
            }

            // Validar y convertir tecnicoId
            if (!tecnicoId) {
                console.error('❌ [OFFLINE MANAGER] tecnicoId es null o undefined');
                return [];
            }

            // Convertir a número si viene como string
            const tecnicoIdNumero = typeof tecnicoId === 'string' ? parseInt(tecnicoId, 10) : tecnicoId;

            if (isNaN(tecnicoIdNumero)) {
                console.error(`❌ [OFFLINE MANAGER] tecnicoId no es un número válido: ${tecnicoId}`);
                return [];
            }

            console.log(`🔍 [OFFLINE MANAGER] Buscando visitas para técnico ID: ${tecnicoIdNumero} (tipo original: ${typeof tecnicoId})`);

            const tx = this.db.transaction('offline-visitas', 'readonly');
            const store = tx.objectStore('offline-visitas');
            const index = store.index('tecnico_id');

            // Usar promesa explícita para getAll()
            const visitas = await new Promise((resolve, reject) => {
                const request = index.getAll(tecnicoIdNumero);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            console.log(`✅ [OFFLINE MANAGER] ${visitas.length} visitas cargadas desde offline`);
            return visitas;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error cargando visitas offline:', error);
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

            const result = await store.add(reporteData);

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
            const tx = this.db.transaction('offline-fotos', 'readwrite');
            const store = tx.objectStore('offline-fotos');

            for (const foto of fotos) {
                // Convertir File a base64 para almacenar
                const base64 = await this.fileToBase64(foto);

                await store.add({
                    reporte_id: reporteLocalId,
                    nombre: foto.name,
                    tipo: foto.type,
                    tamano: foto.size,
                    data: base64,
                    sincronizado: false,
                    timestamp: Date.now()
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
            // Sincronizar inicios de visita (primero, antes que reportes)
            await this.syncIniciosVisita();

            // Sincronizar reportes
            await this.syncReportes();

            // Sincronizar fotos
            await this.syncFotos();

            console.log('✅ [OFFLINE MANAGER] Sincronización completada');

            // Actualizar UI
            this.updateUIConnectionStatus(true);

            // IMPORTANTE: Recargar visitas después de sincronizar para aplicar filtros
            // Esto asegura que las visitas completadas se envíen al servidor pero no aparezcan en la vista
            if (typeof window.cargarVisitasTecnico === 'function') {
                console.log('🔄 [OFFLINE MANAGER] Recargando visitas después de sincronización...');
                setTimeout(() => {
                    window.cargarVisitasTecnico(false); // Sin spinner
                }, 1000); // Esperar 1 segundo para que el servidor procese
            }

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error durante sincronización:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    // Sincronizar reportes pendientes
    async syncReportes() {
        if (!this.db) return;

        const tx = this.db.transaction('offline-reportes', 'readwrite');
        const store = tx.objectStore('offline-reportes');

        // Usar promesa explícita para getAll() - SIN parámetros para evitar DataError
        const reportes = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                resolve(results.filter(r => r.sincronizado === false));
            };
            request.onerror = () => reject(request.error);
        });

        console.log(`📤 [OFFLINE MANAGER] Sincronizando ${reportes.length} reportes...`);

        for (const reporte of reportes) {
            try {
                const response = await fetch(API_BASE_URL + '/api/reportes-visitas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reporte)
                });

                if (response.ok) {
                    const result = await response.json();
                    console.log(`✅ Reporte ${reporte.localId} sincronizado (ID servidor: ${result.reporteId})`);

                    // CRÍTICO: Actualizar reporte_id de las fotos asociadas ANTES de marcar como sincronizado
                    const txFotos = this.db.transaction('offline-fotos', 'readwrite');
                    const fotosStore = txFotos.objectStore('offline-fotos');
                    const fotosIndex = fotosStore.index('reporte_id');

                    const fotasDelReporte = await new Promise((resolve, reject) => {
                        const request = fotosIndex.getAll(IDBKeyRange.only(reporte.localId));
                        request.onsuccess = () => resolve(request.result || []);
                        request.onerror = () => reject(request.error);
                    });

                    console.log(`🔄 Actualizando reporte_id de ${fotasDelReporte.length} fotos: ${reporte.localId} → ${result.reporteId}`);

                    for (const foto of fotasDelReporte) {
                        foto.reporte_id = result.reporteId; // Actualizar a serverId
                        await fotosStore.put(foto);
                    }

                    // CRÍTICO: Esperar a que la transacción de fotos se complete antes de continuar
                    await new Promise((resolve, reject) => {
                        txFotos.oncomplete = () => {
                            console.log(`✅ Transacción de fotos completada para reporte ${result.reporteId}`);
                            resolve();
                        };
                        txFotos.onerror = () => reject(txFotos.error);
                    });

                    // Marcar reporte como sincronizado
                    reporte.sincronizado = true;
                    reporte.serverId = result.reporteId;
                    await store.put(reporte);
                }
            } catch (error) {
                console.error(`❌ Error sincronizando reporte ${reporte.localId}:`, error);
            }
        }
    }

    // Sincronizar fotos pendientes
    async syncFotos() {
        if (!this.db) {
            console.error('❌ [SYNC FOTOS] DB no disponible');
            return;
        }

        console.log('📤 [SYNC FOTOS] Iniciando sincronización de fotos...');

        const tx = this.db.transaction('offline-fotos', 'readwrite');
        const store = tx.objectStore('offline-fotos');

        // Usar promesa explícita para getAll() - SIN parámetros para evitar DataError
        const fotos = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const results = request.result || [];
                console.log(`📤 [SYNC FOTOS] Total fotos en IndexedDB: ${results.length}`);
                const pendientes = results.filter(f => f.sincronizado === false);
                console.log(`📤 [SYNC FOTOS] Fotos pendientes de sincronizar: ${pendientes.length}`);
                resolve(pendientes);
            };
            request.onerror = () => reject(request.error);
        });

        if (fotos.length === 0) {
            console.log('✅ [SYNC FOTOS] No hay fotos pendientes de sincronizar');
            return;
        }

        // Agrupar fotos por reporte_id
        const fotosPorReporte = {};
        for (const foto of fotos) {
            console.log(`📸 [SYNC FOTOS] Foto encontrada: reporte_id=${foto.reporte_id}, nombre=${foto.nombre}, sincronizado=${foto.sincronizado}`);
            if (!fotosPorReporte[foto.reporte_id]) {
                fotosPorReporte[foto.reporte_id] = [];
            }
            fotosPorReporte[foto.reporte_id].push(foto);
        }

        console.log(`📤 [SYNC FOTOS] Fotos agrupadas por ${Object.keys(fotosPorReporte).length} reportes`);

        // Sincronizar por reporte
        for (const [reporteId, fotosReporte] of Object.entries(fotosPorReporte)) {
            try {
                console.log(`📤 [SYNC FOTOS] Sincronizando ${fotosReporte.length} fotos del reporte ${reporteId}...`);

                const formData = new FormData();
                formData.append('reporteId', reporteId);

                for (const foto of fotosReporte) {
                    // Convertir base64 a Blob
                    const blob = await fetch(foto.data).then(r => r.blob());
                    formData.append('fotos', blob, foto.nombre);
                    console.log(`📤 [SYNC FOTOS] Foto agregada al FormData: ${foto.nombre}, tamaño blob: ${blob.size} bytes`);
                }

                console.log(`📤 [SYNC FOTOS] Enviando ${fotosReporte.length} fotos a /api/reportes-fotos para reporte ${reporteId}...`);

                const response = await fetch(API_BASE_URL + '/api/reportes-fotos', {
                    method: 'POST',
                    body: formData
                });

                const responseText = await response.text();
                console.log(`📤 [SYNC FOTOS] Respuesta del servidor (status ${response.status}): ${responseText}`);

                if (response.ok) {
                    console.log(`✅ [SYNC FOTOS] ${fotosReporte.length} fotos del reporte ${reporteId} sincronizadas exitosamente`);

                    // ELIMINAR fotos después de sincronizar para liberar espacio
                    for (const foto of fotosReporte) {
                        await store.delete(foto.localId);
                        console.log(`🗑️ [SYNC FOTOS] Foto ${foto.nombre} (localId: ${foto.localId}) eliminada de IndexedDB - espacio liberado`);
                    }
                    console.log(`✅ [SYNC FOTOS] ${fotosReporte.length} fotos eliminadas de IndexedDB para liberar espacio`);
                } else {
                    console.error(`❌ [SYNC FOTOS] Error HTTP ${response.status}: ${responseText}`);
                }
            } catch (error) {
                console.error(`❌ [SYNC FOTOS] Error sincronizando fotos del reporte ${reporteId}:`, error);
            }
        }

        console.log('✅ [SYNC FOTOS] Sincronización de fotos completada');
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

        // Limpiar reportes antiguos sincronizados
        const reportesStore = tx.objectStore('offline-reportes');
        const reportes = await reportesStore.getAll();

        let reportesEliminados = 0;
        for (const reporte of reportes) {
            if (reporte.sincronizado && reporte.timestamp < thirtyDaysAgo) {
                await reportesStore.delete(reporte.localId);
                reportesEliminados++;
            }
        }

        // Limpiar fotos antiguas (huérfanas o que no se eliminaron correctamente)
        const fotosStore = tx.objectStore('offline-fotos');
        const fotos = await fotosStore.getAll();

        let fotosEliminadas = 0;
        for (const foto of fotos) {
            // Eliminar fotos con más de 7 días (deberían haberse sincronizado y eliminado antes)
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            if (foto.timestamp < sevenDaysAgo) {
                await fotosStore.delete(foto.localId);
                fotosEliminadas++;
            }
        }

        console.log(`🧹 [OFFLINE MANAGER] Datos antiguos limpiados: ${reportesEliminados} reportes, ${fotosEliminadas} fotos huérfanas`);
    }

    // Guardar reporte offline (cuando no hay conexión)
    async guardarReporteOffline(reporteData) {
        try {
            // ESPERAR A QUE EL MANAGER ESTÉ LISTO
            if (!this.isReady) {
                console.log('⏳ [OFFLINE MANAGER] Esperando a que se inicialice...');
                await this.ready;
            }

            if (!this.db) {
                console.error('❌ [OFFLINE MANAGER] Base de datos no inicializada después de esperar');
                return { success: false, message: 'Base de datos no disponible' };
            }

            const localId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Extraer fotos antes de guardar el reporte (File objects no son serializables en IndexedDB)
            const fotosAGuardar = reporteData.fotos;
            const { fotos, ...reporteDataSinFotos } = reporteData;

            const reporteOffline = {
                localId: localId,
                ...reporteDataSinFotos,
                sincronizado: false,
                timestamp: Date.now()
            };

            console.log(`📴 [OFFLINE MANAGER] Guardando reporte offline con ID: ${localId}, visita_id: ${reporteOffline.visita_id}`);

            const tx = this.db.transaction(['offline-reportes'], 'readwrite');
            const store = tx.objectStore('offline-reportes');
            await store.add(reporteOffline);

            console.log(`✅ [OFFLINE MANAGER] Reporte guardado offline con ID: ${localId}`);

            // Guardar fotos si existen
            if (fotosAGuardar && fotosAGuardar.length > 0) {
                console.log(`📸 [OFFLINE MANAGER] Iniciando guardado de ${fotosAGuardar.length} fotos para reporte ${localId}...`);
                await this.guardarFotosOffline(localId, fotosAGuardar);
            } else {
                console.warn(`⚠️ [OFFLINE MANAGER] No hay fotos para guardar con el reporte ${localId}`);
            }

            return { success: true, localId: localId };

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando reporte offline:', error);
            return { success: false, message: error.message };
        }
    }

    // Guardar fotos offline
    async guardarFotosOffline(reporteLocalId, fotos) {
        try {
            if (!this.db) {
                console.error('❌ [OFFLINE MANAGER] DB no disponible para guardar fotos');
                return;
            }

            console.log(`📸 [OFFLINE MANAGER] Guardando ${fotos.length} fotos offline para reporte ${reporteLocalId}`);

            const tx = this.db.transaction(['offline-fotos'], 'readwrite');
            const store = tx.objectStore('offline-fotos');

            for (let i = 0; i < fotos.length; i++) {
                const foto = fotos[i];
                console.log(`📸 [OFFLINE MANAGER] Procesando foto ${i + 1}/${fotos.length}: ${foto.name}, tipo: ${foto.type}, tamaño: ${foto.size} bytes`);

                // Convertir File a base64 para almacenar
                const reader = new FileReader();
                const base64 = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(foto);
                });

                const fotoData = {
                    reporte_id: reporteLocalId,
                    data: base64,
                    nombre: foto.name || `foto_${i}.jpg`,
                    sincronizado: false,
                    timestamp: Date.now()
                };

                await store.add(fotoData);
                console.log(`✅ [OFFLINE MANAGER] Foto ${i + 1} guardada en IndexedDB: ${fotoData.nombre}`);
            }

            console.log(`✅ [OFFLINE MANAGER] ${fotos.length} fotos guardadas offline para ${reporteLocalId}`);

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando fotos offline:', error);
        }
    }

    // Iniciar visita en modo offline
    async iniciarVisitaOffline(visitaId) {
        try {
            if (!this.db) {
                await this.init();
            }

            console.log(`🚀 [OFFLINE MANAGER] Iniciando visita ${visitaId} en modo offline...`);

            // 1. Guardar inicio pendiente de sincronización
            const tx1 = this.db.transaction(['offline-inicios-visita'], 'readwrite');
            const iniciosStore = tx1.objectStore('offline-inicios-visita');

            const inicioData = {
                visita_id: visitaId,
                timestamp: Date.now(),
                fecha_inicio: new Date().toISOString(),
                sincronizado: false
            };

            await iniciosStore.add(inicioData);
            console.log(`💾 [OFFLINE MANAGER] Inicio de visita guardado para sincronización posterior`);

            // 2. Actualizar estado de la visita en offline-visitas
            const tx2 = this.db.transaction(['offline-visitas'], 'readwrite');
            const visitasStore = tx2.objectStore('offline-visitas');

            // Obtener la visita actual
            const visita = await new Promise((resolve, reject) => {
                const request = visitasStore.get(visitaId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (visita) {
                // Actualizar estado a "en_progreso"
                visita.estado = 'en_progreso';
                visita.fecha_inicio_local = new Date().toISOString();

                await new Promise((resolve, reject) => {
                    const request = visitasStore.put(visita);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });

                console.log(`✅ [OFFLINE MANAGER] Estado de visita actualizado a "en_progreso"`);
            }

            return { success: true, message: 'Visita iniciada en modo offline' };

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error iniciando visita offline:', error);
            return { success: false, message: error.message };
        }
    }

    // Sincronizar inicios de visita pendientes
    async syncIniciosVisita() {
        try {
            if (!this.db) return;

            console.log('🔄 [OFFLINE MANAGER] Sincronizando inicios de visita...');

            const tx = this.db.transaction(['offline-inicios-visita'], 'readwrite');
            const store = tx.objectStore('offline-inicios-visita');
            const index = store.index('sincronizado');

            // Obtener todos los inicios NO sincronizados
            const iniciosPendientes = await new Promise((resolve, reject) => {
                const request = index.getAll(IDBKeyRange.only(false));
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            if (iniciosPendientes.length === 0) {
                console.log('✅ [OFFLINE MANAGER] No hay inicios de visita pendientes');
                return;
            }

            console.log(`📤 [OFFLINE MANAGER] ${iniciosPendientes.length} inicios de visita pendientes de sincronización`);

            const API_BASE_URL = window.API_BASE_URL || 'https://cliente.solucnet.com:3000';

            for (const inicio of iniciosPendientes) {
                try {
                    console.log(`🔄 [SYNC] Sincronizando inicio de visita ${inicio.visita_id}...`);

                    const response = await fetch(API_BASE_URL + `/api/visitas-tecnicas/${inicio.visita_id}/iniciar`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (response.ok) {
                        console.log(`✅ [SYNC] Inicio de visita ${inicio.visita_id} sincronizado`);

                        // Marcar como sincronizado
                        const txUpdate = this.db.transaction(['offline-inicios-visita'], 'readwrite');
                        const storeUpdate = txUpdate.objectStore('offline-inicios-visita');

                        inicio.sincronizado = true;
                        inicio.fecha_sincronizacion = new Date().toISOString();

                        await new Promise((resolve, reject) => {
                            const request = storeUpdate.put(inicio);
                            request.onsuccess = () => resolve();
                            request.onerror = () => reject(request.error);
                        });
                    } else {
                        console.warn(`⚠️ [SYNC] Error sincronizando inicio ${inicio.visita_id}: ${response.status}`);
                    }

                } catch (error) {
                    console.error(`❌ [SYNC] Error en inicio de visita ${inicio.visita_id}:`, error);
                }
            }

            console.log('✅ [OFFLINE MANAGER] Sincronización de inicios completada');

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error sincronizando inicios:', error);
        }
    }
}

// Instancia global del Offline Manager
window.offlineManager = new OfflineManager();

console.log('📱 [OFFLINE MANAGER] Módulo cargado');
