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
