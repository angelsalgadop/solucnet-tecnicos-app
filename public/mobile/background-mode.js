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
     * 🔧 v1.82: HABILITAR AUTOMÁTICAMENTE - CRÍTICO para que funcione en background
     */
    async initialize() {
        console.log('🔄 [BACKGROUND] ============================================');
        console.log('🔄 [BACKGROUND] INICIALIZANDO BACKGROUND MODE');
        console.log('🔄 [BACKGROUND] ============================================');

        // Verificar si el plugin está disponible
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
            console.error('❌ [BACKGROUND] Plugin NO disponible - cordova o backgroundMode undefined');
            console.log('📋 [BACKGROUND] typeof cordova:', typeof cordova);
            console.log('📋 [BACKGROUND] cordova.plugins:', cordova?.plugins);
            return false;
        }

        console.log('✅ [BACKGROUND] Plugin disponible - Configurando...');

        try {
            // 🆕 v1.81: Configuración MÁXIMA persistencia (como WhatsApp)
            cordova.plugins.backgroundMode.setDefaults({
                title: 'SolucNet Técnicos',
                text: 'App activa - Monitoreando visitas',
                icon: 'icon',
                color: '28a745',
                resume: true,
                hidden: false,
                bigText: false,
                channelName: 'SolucNet Background Service',
                channelDescription: 'Servicio persistente para recibir visitas en tiempo real',
                allowClose: false, // NO permitir cerrar
                closeIcon: 'power',
                closeTitle: 'Cerrar',
                showWhen: true,
                visibility: 'public',
                silent: false,
                priority: 2, // 🆕 MAX priority
                sticky: true // 🆕 Notificación sticky (no se puede deslizar)
            });

            // 🆕 v1.82: HABILITAR INMEDIATAMENTE (CRÍTICO)
            console.log('🔧 [BACKGROUND] Habilitando background mode AHORA...');

            cordova.plugins.backgroundMode.enable();
            this.isEnabled = true;

            console.log('✅ [BACKGROUND] Background mode HABILITADO');

            // Configurar para persistencia MÁXIMA
            cordova.plugins.backgroundMode.setEnabled(true);
            cordova.plugins.backgroundMode.overrideBackButton();
            cordova.plugins.backgroundMode.excludeFromTaskList();

            console.log('✅ [BACKGROUND] Configuración de persistencia máxima aplicada');

            // Configurar eventos
            this.setupEvents();

            console.log('✅ [BACKGROUND] ============================================');
            console.log('✅ [BACKGROUND] BACKGROUND MODE COMPLETAMENTE INICIALIZADO');
            console.log('✅ [BACKGROUND] isEnabled:', this.isEnabled);
            console.log('✅ [BACKGROUND] ============================================');

            return true;
        } catch (error) {
            console.error('❌ [BACKGROUND] Error configurando:', error);
            return false;
        }
    }

    /**
     * 🆕 v1.82: Verificar y re-habilitar si es necesario (llamado desde permissions-manager)
     */
    async enableManually() {
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
            console.warn('⚠️ [BACKGROUND] Plugin no disponible para enable manual');
            return false;
        }

        try {
            // Ya debería estar habilitado desde initialize(), pero re-habilitar por si acaso
            if (!this.isEnabled) {
                console.log('🔧 [BACKGROUND] Re-habilitando background mode...');
                cordova.plugins.backgroundMode.enable();
                this.isEnabled = true;
                console.log('✅ [BACKGROUND] Modo background RE-HABILITADO');
            } else {
                console.log('ℹ️ [BACKGROUND] Ya estaba habilitado, verificando estado...');
                console.log('📋 [BACKGROUND] isEnabled:', this.isEnabled);
                console.log('📋 [BACKGROUND] isActive:', this.isActive);
            }
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
            console.log('📱📱📱 [BACKGROUND] =========================================');
            console.log('📱📱📱 [BACKGROUND] EVENTO ACTIVATE - App EN SEGUNDO PLANO');
            console.log('📱📱📱 [BACKGROUND] =========================================');
            console.log('📱 [BACKGROUND] Timestamp:', new Date().toISOString());
            console.log('📱 [BACKGROUND] isEnabled:', this.isEnabled);
            console.log('📱 [BACKGROUND] isActive antes:', this.isActive);

            this.isActive = true;

            console.log('📱 [BACKGROUND] isActive ahora:', this.isActive);

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
            console.log('✅✅✅ [BACKGROUND] ==================================');
            console.log('✅✅✅ [BACKGROUND] EVENTO: Background mode HABILITADO');
            console.log('✅✅✅ [BACKGROUND] La app puede funcionar en background');
            console.log('✅✅✅ [BACKGROUND] ==================================');
            this.isEnabled = true;
        });

        // Evento: Deshabilitado
        cordova.plugins.backgroundMode.on('disable', () => {
            console.warn('⚠️⚠️⚠️ [BACKGROUND] ==================================');
            console.warn('⚠️⚠️⚠️ [BACKGROUND] EVENTO: Background mode DESHABILITADO');
            console.warn('⚠️⚠️⚠️ [BACKGROUND] ==================================');
            this.isEnabled = false;
        });

        // Evento: Error
        cordova.plugins.backgroundMode.on('failure', (error) => {
            console.error('❌❌❌ [BACKGROUND] ==================================');
            console.error('❌❌❌ [BACKGROUND] EVENTO: Error en background mode');
            console.error('❌❌❌ [BACKGROUND] Error:', error);
            console.error('❌❌❌ [BACKGROUND] ==================================');
        });

        console.log('✅ [BACKGROUND] Eventos configurados correctamente');
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
     * 🆕 v1.81: Iniciar polling de fallback en background
     * Verifica nuevas visitas cada 10 segundos para detección RÁPIDA
     */
    startBackgroundPolling() {
        // Limpiar intervalo anterior si existe
        this.stopBackgroundPolling();

        console.log('🔄 [BACKGROUND] Iniciando polling de fallback (cada 10 segundos)');

        // Primera verificación inmediata
        this.checkVisitasEnBackground();

        // Luego cada 10 segundos
        this.backgroundInterval = setInterval(() => {
            this.checkVisitasEnBackground();
        }, 10000); // 🆕 v1.81: Reducido de 60s a 10s para detección inmediata

        console.log('✅ [BACKGROUND] Polling de fallback INICIADO (intervalo rápido: 10s)');
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
     * 🆕 v1.81: Verificar visitas en background (actualización SILENCIOSA)
     */
    async checkVisitasEnBackground() {
        try {
            console.log('🔍 [BACKGROUND] Verificando nuevas visitas silenciosamente...');

            // 🆕 v1.81: Llamar con parámetros para actualización silenciosa
            // Parámetros: mostrarSpinner=false, esActualizacionBackground=true
            if (typeof cargarVisitasTecnico === 'function') {
                await cargarVisitasTecnico(false, true);
                console.log('✅ [BACKGROUND] Verificación silenciosa completada');
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
