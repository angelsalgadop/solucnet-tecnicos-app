/**
 * Sistema de Mapas Offline para SolucNet Técnicos
 * Permite seleccionar y descargar áreas del mapa para uso sin conexión
 * Con selector visual tipo Google Maps
 */

class OfflineMapsManager {
    constructor() {
        this.db = null;
        this.dbName = 'solucnet-offline-maps';
        this.dbVersion = 1;
        this.storeName = 'map-tiles';
        this.areasStoreName = 'downloaded-areas';

        // Selector de área visual
        this.selectionRectangle = null;
        this.selectedBounds = null;
        this.isSelecting = false;

        // Niveles de zoom a descargar (configurables)
        this.zoomLevels = {
            min: 13,  // Vista general
            max: 17   // Vista detallada de calles
        };

        this.tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
        this.servers = ['a', 'b', 'c'];
        this.avgTileSizeKB = 20; // Tamaño promedio de un tile en KB

        this.downloadState = {
            isDownloading: false,
            totalTiles: 0,
            downloadedTiles: 0,
            failedTiles: 0,
            currentZoom: 0,
            startTime: null,
            canCancel: true
        };

        // Áreas descargadas
        this.downloadedAreas = [];
    }

    /**
     * Inicializar IndexedDB para tiles y áreas
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ [OFFLINE MAPS] IndexedDB inicializado');
                this.loadDownloadedAreas();
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store para tiles del mapa
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const tileStore = db.createObjectStore(this.storeName, { keyPath: 'key' });
                    tileStore.createIndex('zoom', 'zoom', { unique: false });
                    tileStore.createIndex('timestamp', 'timestamp', { unique: false });
                    tileStore.createIndex('areaId', 'areaId', { unique: false });
                    console.log('📦 [OFFLINE MAPS] Object store tiles creado');
                }

                // Store para áreas descargadas
                if (!db.objectStoreNames.contains(this.areasStoreName)) {
                    const areasStore = db.createObjectStore(this.areasStoreName, { keyPath: 'id', autoIncrement: true });
                    areasStore.createIndex('name', 'name', { unique: false });
                    areasStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('📦 [OFFLINE MAPS] Object store areas creado');
                }
            };
        });
    }

    /**
     * Cargar áreas descargadas desde IndexedDB
     */
    async loadDownloadedAreas() {
        try {
            const tx = this.db.transaction(this.areasStoreName, 'readonly');
            const store = tx.objectStore(this.areasStoreName);

            const areas = await new Promise((resolve) => {
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });

            this.downloadedAreas = areas;
            console.log(`📍 [OFFLINE MAPS] ${areas.length} áreas descargadas cargadas`);
        } catch (error) {
            console.error('❌ [OFFLINE MAPS] Error cargando áreas:', error);
        }
    }

    /**
     * Convertir coordenadas lat/lng a tile x/y para un zoom dado
     */
    latLngToTile(lat, lng, zoom) {
        const n = Math.pow(2, zoom);
        const x = Math.floor((lng + 180) / 360 * n);
        const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
        return { x, y };
    }

    /**
     * Calcular tiles necesarios para un área dada (bounds)
     */
    calculateTilesForBounds(bounds, zoom) {
        const { north, south, east, west } = bounds;

        const nw = this.latLngToTile(north, west, zoom);
        const se = this.latLngToTile(south, east, zoom);

        const tiles = [];

        for (let x = nw.x; x <= se.x; x++) {
            for (let y = nw.y; y <= se.y; y++) {
                tiles.push({ z: zoom, x, y });
            }
        }

        return tiles;
    }

    /**
     * Calcular información del área seleccionada (tiles y tamaño)
     */
    calculateAreaInfo(bounds) {
        let totalTiles = 0;

        for (let z = this.zoomLevels.min; z <= this.zoomLevels.max; z++) {
            const tiles = this.calculateTilesForBounds(bounds, z);
            totalTiles += tiles.length;
        }

        const estimatedSizeMB = (totalTiles * this.avgTileSizeKB) / 1024;

        return {
            totalTiles,
            estimatedSizeMB: estimatedSizeMB.toFixed(2),
            zoomLevels: `${this.zoomLevels.min}-${this.zoomLevels.max}`,
            bounds
        };
    }

    /**
     * Activar modo de selección de área en el mapa
     */
    activateAreaSelector(map, onUpdate) {
        console.log('📍 [OFFLINE MAPS] Activando selector de área...');

        // Obtener bounds actuales del mapa visible
        const mapBounds = map.getBounds();
        const center = map.getCenter();

        // Crear rectángulo inicial (25% del área visible)
        const latDiff = (mapBounds.getNorth() - mapBounds.getSouth()) * 0.25;
        const lngDiff = (mapBounds.getEast() - mapBounds.getWest()) * 0.25;

        const initialBounds = [
            [center.lat - latDiff, center.lng - lngDiff], // Southwest
            [center.lat + latDiff, center.lng + lngDiff]  // Northeast
        ];

        // Crear rectángulo editable
        this.selectionRectangle = L.rectangle(initialBounds, {
            color: '#007bff',
            weight: 3,
            fillColor: '#007bff',
            fillOpacity: 0.1,
            draggable: true
        }).addTo(map);

        // Hacer el rectángulo editable
        this.makeRectangleEditable(map);

        // Calcular y actualizar info inicial
        this.selectedBounds = this.getBoundsFromRectangle();
        const info = this.calculateAreaInfo(this.selectedBounds);

        if (onUpdate) {
            onUpdate(info);
        }

        this.isSelecting = true;

        // Event listeners para actualizar en tiempo real
        this.selectionRectangle.on('edit', () => {
            this.selectedBounds = this.getBoundsFromRectangle();
            const info = this.calculateAreaInfo(this.selectedBounds);
            if (onUpdate) onUpdate(info);
        });

        map.on('zoomend moveend', () => {
            if (this.isSelecting) {
                this.selectedBounds = this.getBoundsFromRectangle();
                const info = this.calculateAreaInfo(this.selectedBounds);
                if (onUpdate) onUpdate(info);
            }
        });

        console.log('✅ [OFFLINE MAPS] Selector activado');
        return this.selectionRectangle;
    }

    /**
     * Hacer el rectángulo editable con handles en las esquinas
     */
    makeRectangleEditable(map) {
        const rect = this.selectionRectangle;
        let isDragging = false;
        let currentHandle = null;

        // Crear handles (esquinas) para redimensionar
        this.handles = {
            nw: L.marker(rect.getBounds().getNorthWest(), {
                draggable: true,
                icon: L.divIcon({
                    className: 'map-resize-handle',
                    html: '<div style="width: 12px; height: 12px; background: #007bff; border: 2px solid white; border-radius: 50%; cursor: nwse-resize;"></div>',
                    iconSize: [12, 12]
                })
            }).addTo(map),
            ne: L.marker(rect.getBounds().getNorthEast(), {
                draggable: true,
                icon: L.divIcon({
                    className: 'map-resize-handle',
                    html: '<div style="width: 12px; height: 12px; background: #007bff; border: 2px solid white; border-radius: 50%; cursor: nesw-resize;"></div>',
                    iconSize: [12, 12]
                })
            }).addTo(map),
            sw: L.marker(rect.getBounds().getSouthWest(), {
                draggable: true,
                icon: L.divIcon({
                    className: 'map-resize-handle',
                    html: '<div style="width: 12px; height: 12px; background: #007bff; border: 2px solid white; border-radius: 50%; cursor: nesw-resize;"></div>',
                    iconSize: [12, 12]
                })
            }).addTo(map),
            se: L.marker(rect.getBounds().getSouthEast(), {
                draggable: true,
                icon: L.divIcon({
                    className: 'map-resize-handle',
                    html: '<div style="width: 12px; height: 12px; background: #007bff; border: 2px solid white; border-radius: 50%; cursor: nwse-resize;"></div>',
                    iconSize: [12, 12]
                })
            }).addTo(map)
        };

        // Función para actualizar handles
        const updateHandles = () => {
            const bounds = rect.getBounds();
            this.handles.nw.setLatLng(bounds.getNorthWest());
            this.handles.ne.setLatLng(bounds.getNorthEast());
            this.handles.sw.setLatLng(bounds.getSouthWest());
            this.handles.se.setLatLng(bounds.getSouthEast());
        };

        // Drag de handles para redimensionar
        Object.entries(this.handles).forEach(([corner, handle]) => {
            handle.on('drag', (e) => {
                const latlng = e.target.getLatLng();
                const bounds = rect.getBounds();
                let newBounds;

                if (corner === 'nw') {
                    newBounds = [[latlng.lat, latlng.lng], [bounds.getSouth(), bounds.getEast()]];
                } else if (corner === 'ne') {
                    newBounds = [[latlng.lat, bounds.getWest()], [bounds.getSouth(), latlng.lng]];
                } else if (corner === 'sw') {
                    newBounds = [[bounds.getNorth(), latlng.lng], [latlng.lat, bounds.getEast()]];
                } else if (corner === 'se') {
                    newBounds = [[bounds.getNorth(), bounds.getWest()], [latlng.lat, latlng.lng]];
                }

                rect.setBounds(newBounds);
                updateHandles();
                rect.fire('edit');
            });
        });

        // Drag del rectángulo completo
        rect.on('drag', () => {
            updateHandles();
        });
    }

    /**
     * Obtener bounds del rectángulo de selección
     */
    getBoundsFromRectangle() {
        const bounds = this.selectionRectangle.getBounds();
        return {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        };
    }

    /**
     * Desactivar selector y limpiar
     */
    deactivateAreaSelector(map) {
        if (this.selectionRectangle) {
            map.removeLayer(this.selectionRectangle);
            this.selectionRectangle = null;
        }

        if (this.handles) {
            Object.values(this.handles).forEach(handle => {
                map.removeLayer(handle);
            });
            this.handles = null;
        }

        this.isSelecting = false;
        this.selectedBounds = null;

        console.log('🔴 [OFFLINE MAPS] Selector desactivado');
    }

    /**
     * Obtener todos los tiles necesarios para todos los zooms
     */
    getAllTiles() {
        if (!this.selectedBounds) {
            console.error('❌ [OFFLINE MAPS] No hay área seleccionada');
            return [];
        }

        let allTiles = [];

        for (let z = this.zoomLevels.min; z <= this.zoomLevels.max; z++) {
            const tiles = this.calculateTilesForBounds(this.selectedBounds, z);
            allTiles = allTiles.concat(tiles);
        }

        console.log(`📊 [OFFLINE MAPS] Total de tiles a descargar: ${allTiles.length}`);
        return allTiles;
    }

    /**
     * Generar key única para cada tile
     */
    getTileKey(z, x, y) {
        return `tile_${z}_${x}_${y}`;
    }

    /**
     * Obtener URL del tile con servidor rotativo
     */
    getTileUrl(z, x, y) {
        const server = this.servers[Math.floor(Math.random() * this.servers.length)];
        return this.tileUrl
            .replace('{s}', server)
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y);
    }

    /**
     * Descargar un tile individual
     */
    async downloadTile(z, x, y) {
        const url = this.getTileUrl(z, x, y);
        const key = this.getTileKey(z, x, y);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const blob = await response.blob();

            // Guardar en IndexedDB
            await this.saveTile(key, blob, z);

            return { success: true, key };
        } catch (error) {
            console.error(`❌ [OFFLINE MAPS] Error descargando tile ${key}:`, error.message);
            return { success: false, key, error: error.message };
        }
    }

    /**
     * Guardar tile en IndexedDB
     */
    async saveTile(key, blob, zoom) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);

            const tileData = {
                key: key,
                blob: blob,
                zoom: zoom,
                timestamp: Date.now()
            };

            const request = store.put(tileData);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Obtener tile desde IndexedDB
     */
    async getTile(z, x, y) {
        const key = this.getTileKey(z, x, y);

        return new Promise((resolve) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);

            const request = store.get(key);
            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result.blob);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    }

    /**
     * Descargar todos los tiles con progreso
     */
    async downloadAllTiles(onProgress) {
        if (this.downloadState.isDownloading) {
            console.warn('⚠️ [OFFLINE MAPS] Descarga ya en progreso');
            return;
        }

        this.downloadState.isDownloading = true;
        this.downloadState.downloadedTiles = 0;
        this.downloadState.failedTiles = 0;
        this.downloadState.startTime = Date.now();

        const allTiles = this.getAllTiles();
        this.downloadState.totalTiles = allTiles.length;

        console.log(`🚀 [OFFLINE MAPS] Iniciando descarga de ${allTiles.length} tiles...`);

        // Descargar en lotes para no saturar
        const batchSize = 5; // Descargar 5 tiles en paralelo

        for (let i = 0; i < allTiles.length; i += batchSize) {
            if (!this.downloadState.isDownloading) {
                console.log('⏸️ [OFFLINE MAPS] Descarga cancelada por el usuario');
                break;
            }

            const batch = allTiles.slice(i, i + batchSize);
            this.downloadState.currentZoom = batch[0].z;

            const promises = batch.map(tile => this.downloadTile(tile.z, tile.x, tile.y));
            const results = await Promise.all(promises);

            // Contar éxitos y fallos
            results.forEach(result => {
                if (result.success) {
                    this.downloadState.downloadedTiles++;
                } else {
                    this.downloadState.failedTiles++;
                }
            });

            // Callback de progreso
            if (onProgress) {
                const progress = {
                    downloaded: this.downloadState.downloadedTiles,
                    failed: this.downloadState.failedTiles,
                    total: this.downloadState.totalTiles,
                    percentage: Math.round((this.downloadState.downloadedTiles + this.downloadState.failedTiles) / this.downloadState.totalTiles * 100),
                    currentZoom: this.downloadState.currentZoom,
                    elapsedTime: Date.now() - this.downloadState.startTime
                };
                onProgress(progress);
            }

            // Pequeña pausa entre lotes
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const duration = ((Date.now() - this.downloadState.startTime) / 1000).toFixed(2);

        console.log(`✅ [OFFLINE MAPS] Descarga completada en ${duration}s`);
        console.log(`📊 Exitosos: ${this.downloadState.downloadedTiles}, Fallidos: ${this.downloadState.failedTiles}`);

        this.downloadState.isDownloading = false;

        return {
            success: true,
            downloaded: this.downloadState.downloadedTiles,
            failed: this.downloadState.failedTiles,
            duration: duration
        };
    }

    /**
     * Cancelar descarga en progreso
     */
    cancelDownload() {
        this.downloadState.isDownloading = false;
        console.log('❌ [OFFLINE MAPS] Descarga cancelada');
    }

    /**
     * Obtener información de tiles almacenados
     */
    async getStorageInfo() {
        return new Promise((resolve) => {
            const tx = this.db.transaction(this.storeName, 'readonly');
            const store = tx.objectStore(this.storeName);

            const countRequest = store.count();

            countRequest.onsuccess = () => {
                const count = countRequest.result;
                const estimatedSize = count * 20 * 1024; // ~20KB por tile

                resolve({
                    tilesCount: count,
                    estimatedSizeMB: (estimatedSize / (1024 * 1024)).toFixed(2),
                    area: this.area.name
                });
            };

            countRequest.onerror = () => resolve({ tilesCount: 0, estimatedSizeMB: 0 });
        });
    }

    /**
     * Eliminar todos los tiles
     */
    async clearAllTiles() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);

            const request = store.clear();
            request.onsuccess = () => {
                console.log('🗑️ [OFFLINE MAPS] Todos los tiles eliminados');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Instancia global
window.offlineMapsManager = new OfflineMapsManager();
