/**
 * Onboarding de Permisos - Primera Apertura
 * v1.83.18 - Solicitar permisos secuencialmente
 */

class OnboardingPermissions {
    constructor() {
        this.hasCompleted = localStorage.getItem('onboarding_completed') === 'true';
    }

    /**
     * Iniciar onboarding si es primera vez
     */
    async start() {
        // Si ya se completó el onboarding, no hacer nada
        if (this.hasCompleted) {
            console.log('ℹ️ [ONBOARDING] Ya completado previamente');
            return;
        }

        console.log('🎬 [ONBOARDING] ====================================');
        console.log('🎬 [ONBOARDING] PRIMERA APERTURA - Solicitando permisos');
        console.log('🎬 [ONBOARDING] ====================================');

        try {
            // Esperar a que Capacitor esté listo
            await this.waitForCapacitor();

            // Solicitar permisos secuencialmente
            await this.requestLocationPermission();
            await this.delay(1000);

            await this.requestNotificationsPermission();
            await this.delay(1000);

            await this.requestCameraPermission();
            await this.delay(1000);

            await this.requestStoragePermission();

            // Marcar onboarding como completado
            localStorage.setItem('onboarding_completed', 'true');
            this.hasCompleted = true;

            console.log('✅ [ONBOARDING] ====================================');
            console.log('✅ [ONBOARDING] Completado exitosamente');
            console.log('✅ [ONBOARDING] ====================================');
        } catch (error) {
            console.error('❌ [ONBOARDING] Error:', error.message);
            // Marcar como completado de todas formas para no bloquear la app
            localStorage.setItem('onboarding_completed', 'true');
        }
    }

    /**
     * Esperar a que Capacitor esté disponible
     */
    async waitForCapacitor() {
        return new Promise((resolve) => {
            if (typeof Capacitor !== 'undefined' && Capacitor.Plugins) {
                resolve();
            } else {
                document.addEventListener('deviceready', () => resolve(), { once: true });
                // Timeout de seguridad
                setTimeout(() => resolve(), 5000);
            }
        });
    }

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Solicitar permiso de ubicación (GPS)
     */
    async requestLocationPermission() {
        try {
            if (!Capacitor.Plugins.Geolocation) {
                console.warn('⚠️ [ONBOARDING] Plugin de Geolocation no disponible');
                return false;
            }

            console.log('📍 [ONBOARDING] Solicitando permiso de UBICACIÓN...');

            const permission = await Capacitor.Plugins.Geolocation.requestPermissions();

            if (permission.location === 'granted') {
                console.log('✅ [ONBOARDING] Permiso de UBICACIÓN concedido');
                return true;
            } else {
                console.log('⚠️ [ONBOARDING] Permiso de UBICACIÓN denegado');
                return false;
            }
        } catch (error) {
            console.error('❌ [ONBOARDING] Error solicitando ubicación:', error.message);
            return false;
        }
    }

    /**
     * Solicitar permiso de notificaciones locales
     */
    async requestNotificationsPermission() {
        try {
            if (!Capacitor.Plugins.LocalNotifications) {
                console.warn('⚠️ [ONBOARDING] Plugin de LocalNotifications no disponible');
                return false;
            }

            console.log('🔔 [ONBOARDING] Solicitando permiso de NOTIFICACIONES...');

            const permission = await Capacitor.Plugins.LocalNotifications.requestPermissions();

            if (permission.display === 'granted') {
                console.log('✅ [ONBOARDING] Permiso de NOTIFICACIONES concedido');

                // Inicializar notificaciones locales si el manager está disponible
                if (window.notificationsManager) {
                    await window.notificationsManager.initialize();
                }

                return true;
            } else {
                console.log('⚠️ [ONBOARDING] Permiso de NOTIFICACIONES denegado');
                return false;
            }
        } catch (error) {
            console.error('❌ [ONBOARDING] Error solicitando notificaciones:', error.message);
            return false;
        }
    }

    /**
     * Solicitar permiso de cámara
     */
    async requestCameraPermission() {
        try {
            if (!Capacitor.Plugins.Camera) {
                console.warn('⚠️ [ONBOARDING] Plugin de Camera no disponible');
                return false;
            }

            console.log('📷 [ONBOARDING] Solicitando permiso de CÁMARA...');

            const permission = await Capacitor.Plugins.Camera.requestPermissions();

            if (permission.camera === 'granted') {
                console.log('✅ [ONBOARDING] Permiso de CÁMARA concedido');
                return true;
            } else {
                console.log('⚠️ [ONBOARDING] Permiso de CÁMARA denegado');
                return false;
            }
        } catch (error) {
            console.error('❌ [ONBOARDING] Error solicitando cámara:', error.message);
            return false;
        }
    }

    /**
     * Solicitar permiso de almacenamiento
     */
    async requestStoragePermission() {
        try {
            if (!Capacitor.Plugins.Filesystem) {
                console.warn('⚠️ [ONBOARDING] Plugin de Filesystem no disponible');
                return false;
            }

            console.log('💾 [ONBOARDING] Solicitando permiso de ALMACENAMIENTO...');

            // Verificar si el método existe
            if (!Capacitor.Plugins.Filesystem.requestPermissions) {
                console.log('ℹ️ [ONBOARDING] Almacenamiento no requiere permisos en este dispositivo');
                return true;
            }

            const permission = await Capacitor.Plugins.Filesystem.requestPermissions();

            if (permission.publicStorage === 'granted') {
                console.log('✅ [ONBOARDING] Permiso de ALMACENAMIENTO concedido');
                return true;
            } else {
                console.log('⚠️ [ONBOARDING] Permiso de ALMACENAMIENTO denegado');
                return false;
            }
        } catch (error) {
            console.error('❌ [ONBOARDING] Error solicitando almacenamiento:', error.message);
            return false;
        }
    }

    /**
     * Resetear onboarding (para testing)
     */
    static reset() {
        localStorage.removeItem('onboarding_completed');
        console.log('🔄 [ONBOARDING] Reset completado');
    }
}

// Crear instancia global
window.onboardingPermissions = new OnboardingPermissions();

// Iniciar onboarding cuando el dispositivo esté listo
document.addEventListener('deviceready', async () => {
    console.log('🎬 [ONBOARDING] Dispositivo listo, verificando primera apertura...');

    // Esperar 3 segundos para que otros componentes se inicialicen primero
    setTimeout(async () => {
        await window.onboardingPermissions.start();
    }, 3000);
}, false);

console.log('🎬 [ONBOARDING] Módulo cargado');
