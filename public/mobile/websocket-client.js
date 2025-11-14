/**
 * Cliente WebSocket para SolucNet Técnicos
 * Detección de cambios en tiempo real usando Socket.IO
 *
 * v1.76.0 - 2025-01-14
 */

class WebSocketClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.tecnicoId = null;
    }

    /**
     * Conectar al servidor WebSocket
     */
    async connect(tecnicoId) {
        console.log('🔌 [WEBSOCKET] Intentando conectar al servidor...');
        this.tecnicoId = tecnicoId;

        try {
            // Verificar si socket.io está disponible (solo en producción/APK)
            if (typeof io === 'undefined') {
                console.warn('⚠️ [WEBSOCKET] Socket.IO no disponible - usando polling como fallback');
                return false;
            }

            // Conectar al servidor
            const serverUrl = window.location.origin;
            console.log(`🔌 [WEBSOCKET] Conectando a: ${serverUrl}`);

            this.socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: 2000,
                reconnectionDelayMax: 10000,
                timeout: 20000
            });

            // Configurar eventos
            this.setupEventListeners();

            return true;
        } catch (error) {
            console.error('❌ [WEBSOCKET] Error conectando:', error);
            return false;
        }
    }

    /**
     * Configurar listeners de eventos
     */
    setupEventListeners() {
        if (!this.socket) return;

        // Evento: Conexión exitosa
        this.socket.on('connect', () => {
            console.log('✅ [WEBSOCKET] Conectado al servidor');
            console.log(`🆔 [WEBSOCKET] Socket ID: ${this.socket.id}`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        // Evento: Actualización de visitas
        this.socket.on('visitas-update', (data) => {
            console.log('📡 [WEBSOCKET] Actualización de visitas recibida:', data);

            // Solo recargar si es para este técnico o es una actualización general
            if (!data.tecnicoId || data.tecnicoId == this.tecnicoId) {
                console.log('🔄 [WEBSOCKET] Recargando visitas del técnico...');

                // Llamar a la función de recarga de visitas
                if (typeof cargarVisitasTecnico === 'function') {
                    cargarVisitasTecnico();
                } else {
                    console.warn('⚠️ [WEBSOCKET] Función cargarVisitasTecnico no disponible');
                }
            } else {
                console.log(`ℹ️ [WEBSOCKET] Actualización para otro técnico (${data.tecnicoId}), ignorando`);
            }
        });

        // Evento: Desconexión
        this.socket.on('disconnect', (reason) => {
            console.warn('⚠️ [WEBSOCKET] Desconectado del servidor:', reason);
            this.isConnected = false;

            // Si la desconexión fue del servidor, intentar reconectar
            if (reason === 'io server disconnect') {
                console.log('🔄 [WEBSOCKET] Intentando reconectar...');
                this.socket.connect();
            }
        });

        // Evento: Error de conexión
        this.socket.on('connect_error', (error) => {
            this.reconnectAttempts++;
            console.error(`❌ [WEBSOCKET] Error de conexión (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error.message);

            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error('❌ [WEBSOCKET] Máximo de intentos de reconexión alcanzado');
                console.log('ℹ️ [WEBSOCKET] La app usará polling cada 30 segundos como fallback');
            }
        });

        // Evento: Intento de reconexión
        this.socket.on('reconnect_attempt', (attemptNumber) => {
            console.log(`🔄 [WEBSOCKET] Intento de reconexión #${attemptNumber}...`);
        });

        // Evento: Reconexión exitosa
        this.socket.on('reconnect', (attemptNumber) => {
            console.log(`✅ [WEBSOCKET] Reconectado exitosamente después de ${attemptNumber} intentos`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });
    }

    /**
     * Solicitar actualización manual de visitas
     */
    requestVisitasUpdate() {
        if (!this.socket || !this.isConnected) {
            console.warn('⚠️ [WEBSOCKET] No conectado - no se puede solicitar actualización');
            return false;
        }

        try {
            console.log('📤 [WEBSOCKET] Solicitando actualización manual de visitas...');
            this.socket.emit('request-visitas-update', { tecnicoId: this.tecnicoId });
            return true;
        } catch (error) {
            console.error('❌ [WEBSOCKET] Error solicitando actualización:', error);
            return false;
        }
    }

    /**
     * Desconectar del servidor
     */
    disconnect() {
        if (!this.socket) return;

        try {
            console.log('🔌 [WEBSOCKET] Desconectando del servidor...');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            console.log('✅ [WEBSOCKET] Desconectado exitosamente');
        } catch (error) {
            console.error('❌ [WEBSOCKET] Error desconectando:', error);
        }
    }

    /**
     * Verificar si está conectado
     */
    isSocketConnected() {
        return this.socket && this.isConnected;
    }
}

// Crear instancia global
window.websocketClient = new WebSocketClient();

console.log('🔌 [WEBSOCKET] Módulo cargado');
