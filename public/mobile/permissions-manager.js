/**
 * Gestor de Permisos SECUENCIAL para SolucNet Técnicos
 * Solicita permisos UNO POR UNO para evitar cierres
 *
 * v1.79.0 - 2025-01-14
 */

class PermissionsManager {
    constructor() {
        this.permisosCompletados = false;
    }

    /**
     * Solicitar TODOS los permisos de forma SECUENCIAL
     */
    async solicitarTodosLosPermisos() {
        console.log('🔐 [PERMISOS] Iniciando solicitud SECUENCIAL de permisos...');

        try {
            // 1️⃣ UBICACIÓN (CRÍTICO - primero)
            console.log('📍 [PERMISOS] Solicitando permiso de UBICACIÓN...');
            const ubicacionOK = await this.solicitarUbicacion();
            console.log(`📍 [PERMISOS] Ubicación: ${ubicacionOK ? '✅ Concedido' : '❌ Denegado'}`);

            // Esperar 2 segundos entre solicitudes
            await this.esperar(2000);

            // 2️⃣ NOTIFICACIONES (importante)
            console.log('🔔 [PERMISOS] Solicitando permiso de NOTIFICACIONES...');
            const notificacionesOK = await this.solicitarNotificaciones();
            console.log(`🔔 [PERMISOS] Notificaciones: ${notificacionesOK ? '✅ Concedido' : '❌ Denegado'}`);

            await this.esperar(2000);

            // 3️⃣ BACKGROUND MODE (habilitar servicio foreground)
            console.log('🟢 [PERMISOS] Habilitando modo BACKGROUND...');
            const backgroundOK = await this.habilitarBackgroundMode();
            console.log(`🟢 [PERMISOS] Background mode: ${backgroundOK ? '✅ Habilitado' : '❌ Error'}`);

            await this.esperar(2000);

            // 4️⃣ BATTERY OPTIMIZATION (último - opcional)
            console.log('🔋 [PERMISOS] Solicitando desactivar OPTIMIZACIÓN DE BATERÍA...');
            const bateriaOK = await this.solicitarBateria();
            console.log(`🔋 [PERMISOS] Batería: ${bateriaOK ? '✅ Concedido' : '❌ Denegado'}`);

            this.permisosCompletados = true;
            console.log('✅ [PERMISOS] Proceso de permisos COMPLETADO');

            // Guardar que ya se solicitaron permisos
            localStorage.setItem('permisos_solicitados', 'true');

            return {
                ubicacion: ubicacionOK,
                notificaciones: notificacionesOK,
                background: backgroundOK,
                bateria: bateriaOK
            };

        } catch (error) {
            console.error('❌ [PERMISOS] Error en proceso de permisos:', error);
            return null;
        }
    }

    /**
     * 1️⃣ Solicitar permiso de UBICACIÓN
     */
    async solicitarUbicacion() {
        try {
            if (typeof Capacitor === 'undefined' || !Capacitor.Plugins.Geolocation) {
                console.warn('⚠️ [UBICACIÓN] Plugin no disponible');
                return false;
            }

            // Verificar permisos actuales
            const permisos = await Capacitor.Plugins.Geolocation.checkPermissions();
            console.log('📍 [UBICACIÓN] Permisos actuales:', permisos);

            if (permisos.location === 'granted') {
                console.log('✅ [UBICACIÓN] Ya concedido');
                return true;
            }

            // Solicitar permisos
            const resultado = await Capacitor.Plugins.Geolocation.requestPermissions();
            console.log('📍 [UBICACIÓN] Resultado:', resultado);

            return resultado.location === 'granted';

        } catch (error) {
            console.error('❌ [UBICACIÓN] Error:', error);
            return false;
        }
    }

    /**
     * 2️⃣ Solicitar permiso de NOTIFICACIONES
     */
    async solicitarNotificaciones() {
        try {
            if (typeof Capacitor === 'undefined' || !Capacitor.Plugins.LocalNotifications) {
                console.warn('⚠️ [NOTIFICACIONES] Plugin no disponible');
                return false;
            }

            // Verificar permisos actuales
            const permisos = await Capacitor.Plugins.LocalNotifications.checkPermissions();
            console.log('🔔 [NOTIFICACIONES] Permisos actuales:', permisos);

            if (permisos.display === 'granted') {
                console.log('✅ [NOTIFICACIONES] Ya concedido');
                // Marcar como inicializado en el manager
                if (window.notificationsManager) {
                    window.notificationsManager.isInitialized = true;
                }
                return true;
            }

            // Solicitar permisos
            const resultado = await Capacitor.Plugins.LocalNotifications.requestPermissions();
            console.log('🔔 [NOTIFICACIONES] Resultado:', resultado);

            if (resultado.display === 'granted' && window.notificationsManager) {
                window.notificationsManager.isInitialized = true;
            }

            return resultado.display === 'granted';

        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error:', error);
            return false;
        }
    }

    /**
     * 3️⃣ Habilitar BACKGROUND MODE (servicio foreground)
     */
    async habilitarBackgroundMode() {
        try {
            if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
                console.warn('⚠️ [BACKGROUND] Plugin no disponible');
                return false;
            }

            // Habilitar el modo background
            cordova.plugins.backgroundMode.enable();

            // Marcar como habilitado en el manager
            if (window.backgroundModeManager) {
                window.backgroundModeManager.isEnabled = true;
            }

            console.log('✅ [BACKGROUND] Modo background HABILITADO');
            return true;

        } catch (error) {
            console.error('❌ [BACKGROUND] Error:', error);
            return false;
        }
    }

    /**
     * 4️⃣ Solicitar desactivar OPTIMIZACIÓN DE BATERÍA
     */
    async solicitarBateria() {
        try {
            if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.backgroundMode) {
                console.warn('⚠️ [BATERÍA] Plugin no disponible');
                return false;
            }

            // Verificar si ya está desactivada
            return new Promise((resolve) => {
                if (!cordova.plugins.backgroundMode.isIgnoringBatteryOptimizations) {
                    console.log('ℹ️ [BATERÍA] Función no disponible en este dispositivo');
                    resolve(true);
                    return;
                }

                cordova.plugins.backgroundMode.isIgnoringBatteryOptimizations((isIgnoring) => {
                    if (isIgnoring) {
                        console.log('✅ [BATERÍA] Ya desactivada');
                        resolve(true);
                    } else {
                        console.log('🔋 [BATERÍA] Solicitando desactivación...');
                        cordova.plugins.backgroundMode.disableBatteryOptimizations();
                        // Considerar éxito aunque el usuario decline
                        resolve(true);
                    }
                });
            });

        } catch (error) {
            console.error('❌ [BATERÍA] Error:', error);
            return false;
        }
    }

    /**
     * Esperar X milisegundos (para espaciar solicitudes)
     */
    async esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Verificar si ya se solicitaron permisos antes
     */
    yaSesolicitaron() {
        return localStorage.getItem('permisos_solicitados') === 'true';
    }

    /**
     * Resetear (para testing)
     */
    resetear() {
        localStorage.removeItem('permisos_solicitados');
        this.permisosCompletados = false;
    }
}

// Crear instancia global
window.permissionsManager = new PermissionsManager();

console.log('🔐 [PERMISOS] Gestor de permisos cargado');
