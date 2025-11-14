/**
 * Background Mode para App SolucNet Técnicos
 * Mantiene la app activa en segundo plano para:
 * - Envío de ubicación GPS cada 10 segundos
 * - Recepción de nuevas visitas asignadas
 * - Notificaciones en tiempo real
 *
 * v1.80.0 - 2025-01-14
 * 🆕 Keep-alive de WebSocket en background
 * 🆕 Polling de fallback cada 60 segundos
 * 🆕 Logs mejorados para diagnosticar
 */

class BackgroundModeManager {
    constructor() {
        this.isEnabled = false;
        this.isActive = false;
        this.backgroundInterval = null;
        this.keepAliveInterval = null;
    }

    /**
     * 🔧 v1.78: Solo CONFIGURAR - NO habilitar automáticamente para evitar cierres
     */
    async initialize() {
        console.log('🔄 [BACKGROUND] Configurando modo background (NO habilitando aún)...');

        // Verificar si el plugin está disponible
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
            console.warn('⚠️ [BACKGROUND] Plugin no disponible');
            return false;
        }

        try {
            // Solo CONFIGURAR, NO habilitar
            cordova.plugins.backgroundMode.setDefaults({
                title: 'SolucNet Técnicos',
                text: 'App activa - Enviando ubicación',
                icon: 'icon',
                color: '28a745',
                resume: true,
                hidden: false,
                bigText: false,
                channelName: 'SolucNet Background Service',
                channelDescription: 'Mantiene la app activa para envío de ubicación',
                allowClose: false,
                closeIcon: 'power',
                closeTitle: 'Cerrar',
                showWhen: true,
                visibility: 'public',
                silent: false
            });

            // Configurar eventos
            this.setupEvents();

            console.log('✅ [BACKGROUND] Configurado (esperando activación manual)');
            return true;
        } catch (error) {
            console.error('❌ [BACKGROUND] Error configurando:', error);
            return false;
        }
    }

    /**
     * 🆕 v1.76: Habilitar background mode manualmente (cuando usuario acepta)
     */
    async enableManually() {
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
            return false;
        }

        try {
            cordova.plugins.backgroundMode.enable();
            this.isEnabled = true;
            console.log('✅ [BACKGROUND] Modo background HABILITADO manualmente');
            return true;
        } catch (error) {
            console.error('❌ [BACKGROUND] Error habilitando:', error);
            return false;
        }
    }

    /**
     * Configurar eventos del modo background
     */
    setupEvents() {
        // Evento: App entra en segundo plano
        cordova.plugins.backgroundMode.on('activate', () => {
            console.log('📱 [BACKGROUND] ============================================');
            console.log('📱 [BACKGROUND] App EN SEGUNDO PLANO - INICIANDO SERVICIOS');
            console.log('📱 [BACKGROUND] ============================================');
            this.isActive = true;

            // Deshabilitar web view optimizations cuando está en background
            cordova.plugins.backgroundMode.disableWebViewOptimizations();
            console.log('✅ [BACKGROUND] WebView optimizations deshabilitadas');

            // Actualizar notificación del foreground service
            this.updateNotification('SolucNet Activo', 'Monitoreando nuevas visitas');

            // 🆕 v1.80: Notificar al WebSocket que estamos en background
            if (window.websocketClient) {
                window.websocketClient.setBackgroundMode(true);
            }

            // 🆕 v1.80: Iniciar keep-alive del WebSocket
            this.startWebSocketKeepAlive();

            // 🆕 v1.80: Iniciar polling de fallback cada 60 segundos
            this.startBackgroundPolling();

            console.log('✅ [BACKGROUND] Servicios de background INICIADOS correctamente');
        });

        // Evento: App vuelve al frente
        cordova.plugins.backgroundMode.on('deactivate', () => {
            console.log('📱 [BACKGROUND] App volviendo a PRIMER PLANO');
            this.isActive = false;

            // 🆕 v1.80: Notificar al WebSocket que estamos en foreground
            if (window.websocketClient) {
                window.websocketClient.setBackgroundMode(false);
            }

            // Detener intervalos de background
            this.stopWebSocketKeepAlive();
            this.stopBackgroundPolling();

            console.log('✅ [BACKGROUND] Servicios de background DETENIDOS');
        });

        // Evento: Habilitado
        cordova.plugins.backgroundMode.on('enable', () => {
            console.log('✅ [BACKGROUND] Background mode HABILITADO');
        });

        // Evento: Deshabilitado
        cordova.plugins.backgroundMode.on('disable', () => {
            console.log('⚠️ [BACKGROUND] Background mode DESHABILITADO');
        });

        // Evento: Error
        cordova.plugins.backgroundMode.on('failure', (error) => {
            console.error('❌ [BACKGROUND] Error:', error);
        });
    }

    /**
     * Actualizar el texto de la notificación
     */
    updateNotification(title, text) {
        if (!this.isEnabled) return;

        try {
            cordova.plugins.backgroundMode.configure({
                title: title,
                text: text
            });
            console.log(`🔔 [BACKGROUND] Notificación actualizada: ${title} - ${text}`);
        } catch (error) {
            console.error('❌ [BACKGROUND] Error actualizando notificación:', error);
        }
    }

    /**
     * 🆕 v1.76: Solicitar desactivar optimización de batería MANUALMENTE
     * Se llama desde un botón/diálogo cuando el usuario acepta
     */
    async requestBatteryOptimizationDisable() {
        try {
            if (!cordova.plugins.backgroundMode.isIgnoringBatteryOptimizations) {
                console.log('ℹ️ [BACKGROUND] Optimización de batería no disponible en este dispositivo');
                return true; // No disponible = no hay problema
            }

            return new Promise((resolve) => {
                cordova.plugins.backgroundMode.isIgnoringBatteryOptimizations((isIgnoring) => {
                    if (isIgnoring) {
                        console.log('✅ [BACKGROUND] Optimización de batería ya desactivada');
                        resolve(true);
                    } else {
                        console.log('🔋 [BACKGROUND] Solicitando desactivar optimización de batería...');
                        cordova.plugins.backgroundMode.disableBatteryOptimizations();
                        resolve(true);
                    }
                });
            });
        } catch (error) {
            console.error('❌ [BACKGROUND] Error solicitando desactivación:', error);
            return false;
        }
    }

    /**
     * 🆕 v1.80: Iniciar keep-alive del WebSocket
     * Envía un ping cada 25 segundos para mantener la conexión activa
     */
    startWebSocketKeepAlive() {
        // Limpiar intervalo anterior si existe
        this.stopWebSocketKeepAlive();

        console.log('🔌 [BACKGROUND] Iniciando WebSocket keep-alive (cada 25 segundos)');

        this.keepAliveInterval = setInterval(() => {
            if (window.websocketClient && window.websocketClient.isSocketConnected()) {
                console.log('💓 [BACKGROUND] WebSocket keep-alive - Conexión activa');
                // El ping se envía automáticamente por Socket.IO
            } else {
                console.warn('⚠️ [BACKGROUND] WebSocket DESCONECTADO - Intentando reconectar...');

                // Intentar reconectar
                if (window.websocketClient && window.usuarioActual && window.usuarioActual.id) {
                    window.websocketClient.connect(window.usuarioActual.id);
                }
            }
        }, 25000); // Cada 25 segundos

        console.log('✅ [BACKGROUND] WebSocket keep-alive INICIADO');
    }

    /**
     * 🆕 v1.80: Detener keep-alive del WebSocket
     */
    stopWebSocketKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
            console.log('⏸️ [BACKGROUND] WebSocket keep-alive DETENIDO');
        }
    }

    /**
     * 🆕 v1.80: Iniciar polling de fallback en background
     * Verifica nuevas visitas cada 60 segundos
     */
    startBackgroundPolling() {
        // Limpiar intervalo anterior si existe
        this.stopBackgroundPolling();

        console.log('🔄 [BACKGROUND] Iniciando polling de fallback (cada 60 segundos)');

        // Primera verificación inmediata
        this.checkVisitasEnBackground();

        // Luego cada 60 segundos
        this.backgroundInterval = setInterval(() => {
            this.checkVisitasEnBackground();
        }, 60000); // Cada 60 segundos

        console.log('✅ [BACKGROUND] Polling de fallback INICIADO');
    }

    /**
     * 🆕 v1.80: Detener polling de fallback
     */
    stopBackgroundPolling() {
        if (this.backgroundInterval) {
            clearInterval(this.backgroundInterval);
            this.backgroundInterval = null;
            console.log('⏸️ [BACKGROUND] Polling de fallback DETENIDO');
        }
    }

    /**
     * 🆕 v1.80: Verificar visitas en background
     */
    async checkVisitasEnBackground() {
        try {
            console.log('🔍 [BACKGROUND] Verificando nuevas visitas...');

            // Llamar a cargarVisitasTecnico que ya maneja notificaciones
            if (typeof cargarVisitasTecnico === 'function') {
                await cargarVisitasTecnico();
                console.log('✅ [BACKGROUND] Verificación completada');
            } else {
                console.warn('⚠️ [BACKGROUND] Función cargarVisitasTecnico no disponible');
            }
        } catch (error) {
            console.error('❌ [BACKGROUND] Error verificando visitas:', error);
        }
    }

    /**
     * Verificar si está activo en background
     */
    isInBackground() {
        if (!this.isEnabled) return false;
        return cordova.plugins.backgroundMode.isActive();
    }

    /**
     * Deshabilitar modo background (para cuando el usuario cierra sesión)
     */
    disable() {
        if (!this.isEnabled) return;

        try {
            // Detener intervalos
            this.stopWebSocketKeepAlive();
            this.stopBackgroundPolling();

            // Deshabilitar el modo background
            cordova.plugins.backgroundMode.disable();
            this.isEnabled = false;
            this.isActive = false;
            console.log('⏸️ [BACKGROUND] Modo background deshabilitado');
        } catch (error) {
            console.error('❌ [BACKGROUND] Error deshabilitando:', error);
        }
    }

    /**
     * Habilitar modo background
     */
    enable() {
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
            return false;
        }

        try {
            cordova.plugins.backgroundMode.enable();
            this.isEnabled = true;
            console.log('▶️ [BACKGROUND] Modo background habilitado');
            return true;
        } catch (error) {
            console.error('❌ [BACKGROUND] Error habilitando:', error);
            return false;
        }
    }
}

// Crear instancia global
window.backgroundModeManager = new BackgroundModeManager();

// Inicializar cuando Cordova esté listo
document.addEventListener('deviceready', async () => {
    console.log('📱 [BACKGROUND] Cordova listo, inicializando background mode...');
    await window.backgroundModeManager.initialize();
}, false);

console.log('📱 [BACKGROUND] Módulo cargado - Esperando deviceready...');
