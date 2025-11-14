/**
 * Background Mode para App SolucNet Técnicos
 * Mantiene la app activa en segundo plano para:
 * - Envío de ubicación GPS cada 10 segundos
 * - Recepción de nuevas visitas asignadas
 * - Notificaciones en tiempo real
 *
 * v1.75 - 2025-01-14
 */

class BackgroundModeManager {
    constructor() {
        this.isEnabled = false;
        this.isActive = false;
    }

    /**
     * Inicializar el modo background
     */
    async initialize() {
        console.log('🔄 [BACKGROUND] Inicializando modo background...');

        // Verificar si el plugin está disponible
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
            console.warn('⚠️ [BACKGROUND] Plugin no disponible - La app NO funcionará en segundo plano');
            return false;
        }

        try {
            // Configurar el modo background
            cordova.plugins.backgroundMode.setDefaults({
                title: 'SolucNet Técnicos',
                text: 'App activa - Enviando ubicación',
                icon: 'icon', // Icono de la app
                color: '28a745', // Verde de la app
                resume: true, // Reactivar app al tocar notificación
                hidden: false, // Mostrar notificación
                bigText: false,
                channelName: 'SolucNet Background Service',
                channelDescription: 'Mantiene la app activa para envío de ubicación',
                allowClose: false, // No permitir cerrar la notificación
                closeIcon: 'power',
                closeTitle: 'Cerrar',
                showWhen: true,
                visibility: 'public'
            });

            // Configurar eventos primero (antes de habilitar)
            this.setupEvents();

            // 🔧 v1.75.5: Delay MÁS LARGO para evitar cierres
            setTimeout(() => {
                cordova.plugins.backgroundMode.enable();
                this.isEnabled = true;
                console.log('✅ [BACKGROUND] Modo background habilitado');

                // 🔧 v1.75.5: Solo VERIFICAR batería (NO solicitar automáticamente)
                // Solicitar solo después de 30 segundos y solo si el usuario está usando la app
                setTimeout(() => {
                    this.checkBatteryOptimization();

                    // Solo solicitar si la app lleva más de 1 minuto abierta
                    setTimeout(() => {
                        this.requestBatteryOptimizationDisable();
                    }, 30000); // 30 segundos más = 1 minuto total
                }, 30000); // 30 segundos después de habilitar background
            }, 5000); // 5 segundos inicial

            return true;
        } catch (error) {
            console.error('❌ [BACKGROUND] Error inicializando:', error);
            return false;
        }
    }

    /**
     * Configurar eventos del modo background
     */
    setupEvents() {
        // Evento: App entra en segundo plano
        cordova.plugins.backgroundMode.on('activate', () => {
            console.log('📱 [BACKGROUND] App en segundo plano - ACTIVA');
            this.isActive = true;

            // Deshabilitar web view optimizations cuando está en background
            cordova.plugins.backgroundMode.disableWebViewOptimizations();

            // Actualizar notificación
            this.updateNotification('App activa', 'Enviando ubicación en segundo plano');
        });

        // Evento: App vuelve al frente
        cordova.plugins.backgroundMode.on('deactivate', () => {
            console.log('📱 [BACKGROUND] App en primer plano');
            this.isActive = false;
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
     * Verificar optimización de batería (sin forzar diálogo)
     * Solo informa al usuario, no abre diálogo automáticamente
     */
    checkBatteryOptimization() {
        if (!this.isEnabled) return;

        try {
            // Solo verificar el estado, NO forzar el diálogo
            cordova.plugins.backgroundMode.isIgnoringBatteryOptimizations((isIgnoring) => {
                if (!isIgnoring) {
                    console.log('ℹ️ [BACKGROUND] Optimización de batería está activa');
                    console.log('💡 [BACKGROUND] Para mejor rendimiento, desactívala manualmente en Configuración');
                } else {
                    console.log('✅ [BACKGROUND] Optimización de batería desactivada');
                }
            });
        } catch (error) {
            console.log('ℹ️ [BACKGROUND] Optimización de batería no disponible en este dispositivo');
        }
    }

    /**
     * Solicitar desactivar optimización de batería
     * v1.75.3: Ahora se solicita automáticamente para funcionamiento tipo WhatsApp
     */
    requestBatteryOptimizationDisable() {
        if (!this.isEnabled) return;

        try {
            // Primero verificar si ya está desactivada
            cordova.plugins.backgroundMode.isIgnoringBatteryOptimizations((isIgnoring) => {
                if (isIgnoring) {
                    console.log('✅ [BACKGROUND] Optimización de batería ya desactivada');
                } else {
                    // Solo solicitar si NO está desactivada
                    console.log('🔋 [BACKGROUND] Solicitando desactivar optimización de batería...');
                    console.log('💡 [BACKGROUND] Esto permite que la app funcione como WhatsApp');
                    cordova.plugins.backgroundMode.disableBatteryOptimizations();
                }
            });
        } catch (error) {
            console.error('❌ [BACKGROUND] Error solicitando desactivación:', error);
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
