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
            const request = indexedDB.open('solucnet-offline-db', 2);

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
                top: 0;
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

            const reportes = await tx.objectStore('offline-reportes').index('sincronizado').getAll(false);
            const fotos = await tx.objectStore('offline-fotos').index('sincronizado').getAll(false);
            const requests = await tx.objectStore('offline-requests').getAll();

            return reportes.length > 0 || fotos.length > 0 || requests.length > 0;
        } catch (error) {
            console.error('Error verificando datos pendientes:', error);
            return false;
        }
    }

    // Guardar visitas para offline
    async saveVisitasOffline(visitas, tecnicoId) {
        if (!this.db) return false;

        try {
            const tx = this.db.transaction('offline-visitas', 'readwrite');
            const store = tx.objectStore('offline-visitas');

            for (const visita of visitas) {
                visita.tecnico_id = tecnicoId;
                visita.timestamp = Date.now();
                await store.put(visita);
            }

            console.log(`✅ [OFFLINE MANAGER] ${visitas.length} visitas guardadas offline`);
            return true;
        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando visitas offline:', error);
            return false;
        }
    }

    // Cargar visitas desde offline
    async loadVisitasOffline(tecnicoId) {
        if (!this.db) return [];

        try {
            const tx = this.db.transaction('offline-visitas', 'readonly');
            const store = tx.objectStore('offline-visitas');
            const index = store.index('tecnico_id');
            const visitas = await index.getAll(tecnicoId);

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
            // Sincronizar reportes
            await this.syncReportes();

            // Sincronizar fotos
            await this.syncFotos();

            console.log('✅ [OFFLINE MANAGER] Sincronización completada');

            // Actualizar UI
            this.updateUIConnectionStatus(true);

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
        const index = store.index('sincronizado');
        const reportes = await index.getAll(false);

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

                    // Marcar como sincronizado
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
        if (!this.db) return;

        const tx = this.db.transaction('offline-fotos', 'readwrite');
        const store = tx.objectStore('offline-fotos');
        const index = store.index('sincronizado');
        const fotos = await index.getAll(false);

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
                const formData = new FormData();
                formData.append('reporteId', reporteId);

                for (const foto of fotosReporte) {
                    // Convertir base64 a Blob
                    const blob = await fetch(foto.data).then(r => r.blob());
                    formData.append('fotos', blob, foto.nombre);
                }

                const response = await fetch(API_BASE_URL + '/api/reportes-fotos', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    console.log(`✅ ${fotosReporte.length} fotos del reporte ${reporteId} sincronizadas`);

                    // Marcar fotos como sincronizadas
                    for (const foto of fotosReporte) {
                        foto.sincronizado = true;
                        await store.put(foto);
                    }
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

    // Guardar reporte offline (cuando no hay conexión)
    async guardarReporteOffline(reporteData) {
        try {
            if (!this.db) {
                console.error('❌ [OFFLINE MANAGER] Base de datos no inicializada');
                return { success: false, message: 'Base de datos no disponible' };
            }

            const localId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const reporteOffline = {
                localId: localId,
                ...reporteData,
                sincronizado: false,
                timestamp: Date.now()
            };

            const tx = this.db.transaction(['offline-reportes'], 'readwrite');
            const store = tx.objectStore('offline-reportes');
            await store.add(reporteOffline);

            console.log(`📴 [OFFLINE MANAGER] Reporte guardado offline con ID: ${localId}`);
            console.log('📋 [OFFLINE MANAGER] Datos del reporte:', reporteOffline);

            // Guardar fotos si existen
            if (reporteData.fotos && reporteData.fotos.length > 0) {
                await this.guardarFotosOffline(localId, reporteData.fotos);
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
            if (!this.db) return;

            const tx = this.db.transaction(['offline-fotos'], 'readwrite');
            const store = tx.objectStore('offline-fotos');

            for (let i = 0; i < fotos.length; i++) {
                const foto = fotos[i];

                // Convertir File a base64 para almacenar
                const reader = new FileReader();
                const base64 = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(foto);
                });

                await store.add({
                    reporteLocalId: reporteLocalId,
                    fotoData: base64,
                    nombre: foto.name || `foto_${i}.jpg`,
                    timestamp: Date.now()
                });
            }

            console.log(`📸 [OFFLINE MANAGER] ${fotos.length} fotos guardadas offline`);

        } catch (error) {
            console.error('❌ [OFFLINE MANAGER] Error guardando fotos offline:', error);
        }
    }
}

// Instancia global del Offline Manager
window.offlineManager = new OfflineManager();

console.log('📱 [OFFLINE MANAGER] Módulo cargado');
