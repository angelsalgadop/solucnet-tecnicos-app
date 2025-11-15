/**
 * Sistema de Push Notifications para SolucNet Técnicos
 * Usa Firebase Cloud Messaging (FCM) para notificaciones REALES
 * Funciona incluso cuando la app está CERRADA
 *
 * v1.83.2 - 2025-01-14 - Fix: SERVER_URL sin puerto :3000
 */

class PushNotificationsManager {
    constructor() {
        this.fcmToken = null;
        this.isRegistered = false;
    }

    /**
     * Inicializar push notifications
     * 🔧 v1.83.17: NUNCA solicitar permisos - Solo verificar
     * SOLUCIÓN: NO pedir permisos (causa crash), solo verificar si ya están concedidos
     */
    async initialize() {
        console.log('🔔 [PUSH] ============================================');
        console.log('🔔 [PUSH] Inicializando Push Notifications (FCM)');
        console.log('🔔 [PUSH] ============================================');

        try {
            // Verificar si el plugin está disponible
            if (typeof Capacitor === 'undefined' || !Capacitor.Plugins.PushNotifications) {
                console.warn('⚠️ [PUSH] Plugin no disponible');
                return false;
            }

            // 🔧 v1.83.17: Configurar listeners ANTES de verificar
            console.log('🔔 [PUSH] Configurando listeners...');
            this.setupListeners();

            // 🔧 v1.83.17: SOLO VERIFICAR permisos, NUNCA solicitar (causa crash)
            console.log('🔔 [PUSH] Verificando permisos (sin solicitar)...');
            const permission = await Capacitor.Plugins.PushNotifications.checkPermissions();
            console.log('🔔 [PUSH] Permisos actuales:', permission);

            if (permission.receive === 'granted') {
                console.log('✅ [PUSH] Permisos YA concedidos');
                console.log('⚠️ [PUSH] =============================================');
                console.log('⚠️ [PUSH] FCM DESHABILITADO (v1.83.18)');
                console.log('⚠️ [PUSH] register() causa crash en este dispositivo');
                console.log('⚠️ [PUSH] La app usará notificaciones locales únicamente');
                console.log('⚠️ [PUSH] =============================================');

                // NO registrar con FCM - causa crash
                // La app funcionará con notificaciones LOCALES únicamente

                return true;
            } else {
                console.log('ℹ️ [PUSH] =============================================');
                console.log('ℹ️ [PUSH] Permisos de notificaciones NO concedidos');
                console.log('ℹ️ [PUSH] Para recibir notificaciones push:');
                console.log('ℹ️ [PUSH] 1. Ve a Configuración > Apps > SolucNet');
                console.log('ℹ️ [PUSH] 2. Toca "Permisos"');
                console.log('ℹ️ [PUSH] 3. Activa "Notificaciones"');
                console.log('ℹ️ [PUSH] La app funciona normalmente sin push notifications');
                console.log('ℹ️ [PUSH] =============================================');
                return false;
            }
        } catch (error) {
            console.error('❌ [PUSH] Error inicializando:', error.message);
            console.log('ℹ️ [PUSH] La app continúa sin push notifications');
            return false;
        }
    }

    /**
     * Configurar listeners de eventos
     * 🔧 v1.83.15: Manejo robusto de errores en todos los listeners
     */
    setupListeners() {
        try {
            const { PushNotifications } = Capacitor.Plugins;

            // Evento: Registro exitoso - Recibimos el FCM token
            PushNotifications.addListener('registration', async (token) => {
                try {
                    console.log('✅✅✅ [PUSH] =======================================');
                    console.log('✅✅✅ [PUSH] FCM TOKEN RECIBIDO:');
                    console.log('✅✅✅ [PUSH]', token.value);
                    console.log('✅✅✅ [PUSH] =======================================');

                    this.fcmToken = token.value;
                    this.isRegistered = true;

                    // Guardar token en el servidor
                    await this.saveTokenToServer(token.value);
                } catch (error) {
                    console.error('❌ [PUSH] Error procesando token:', error.message);
                }
            });

            // Evento: Error en registro
            PushNotifications.addListener('registrationError', (error) => {
                console.error('❌❌❌ [PUSH] Error en registro FCM:', error);
                console.log('ℹ️ [PUSH] La app continúa funcionando sin push notifications');
            });

            // Evento: Notificación recibida (app en FOREGROUND)
            PushNotifications.addListener('pushNotificationReceived', (notification) => {
                try {
                    console.log('📱 [PUSH] Notificación recibida (app abierta):', notification);

                    // Mostrar notificación local
                    this.showLocalNotification(notification);
                } catch (error) {
                    console.error('❌ [PUSH] Error mostrando notificación:', error.message);
                }
            });

            // Evento: Usuario tocó la notificación (app en BACKGROUND o CERRADA)
            PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
                try {
                    console.log('👆 [PUSH] Usuario tocó notificación:', action);

                    const notification = action.notification;
                    console.log('📋 [PUSH] Datos:', notification.data);

                    // Si hay visita_id, abrir la app y recargar visitas
                    if (notification.data && notification.data.visita_id) {
                        console.log('🔄 [PUSH] Recargando visitas...');

                        // Recargar visitas
                        if (typeof cargarVisitasTecnico === 'function') {
                            cargarVisitasTecnico();
                        }
                    }
                } catch (error) {
                    console.error('❌ [PUSH] Error procesando acción de notificación:', error.message);
                }
            });

            console.log('✅ [PUSH] Listeners configurados');
        } catch (error) {
            console.error('❌ [PUSH] Error configurando listeners:', error.message);
        }
    }

    /**
     * Guardar FCM token en el servidor
     */
    async saveTokenToServer(token) {
        try {
            const userStr = localStorage.getItem('user_tecnico');
            const tokenAuth = localStorage.getItem('token_tecnico');

            if (!userStr || !tokenAuth) {
                console.warn('⚠️ [PUSH] No hay usuario autenticado, no se puede guardar token');
                return;
            }

            const user = JSON.parse(userStr);
            console.log('💾 [PUSH] Guardando token para usuario:', user.id);

            const response = await fetch(APP_CONFIG.getApiUrl('/api/fcm/save-token'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenAuth}`
                },
                body: JSON.stringify({
                    fcm_token: token,
                    user_id: user.id,
                    device_info: {
                        platform: 'android',
                        app_version: '1.83.2'
                    }
                })
            });

            const result = await response.json();

            if (result.success) {
                console.log('✅ [PUSH] Token guardado en servidor');
                localStorage.setItem('fcm_token', token);
            } else {
                console.error('❌ [PUSH] Error guardando token:', result.message);
            }
        } catch (error) {
            console.error('❌ [PUSH] Error guardando token en servidor:', error);
        }
    }

    /**
     * Mostrar notificación local cuando la app está abierta
     */
    async showLocalNotification(notification) {
        try {
            if (window.notificationsManager && window.notificationsManager.isInitialized) {
                await window.notificationsManager.sendCustomNotification(
                    notification.title || 'Nueva Notificación',
                    notification.body || '',
                    notification.data || {}
                );
            }
        } catch (error) {
            console.error('❌ [PUSH] Error mostrando notificación local:', error);
        }
    }

    /**
     * Obtener token actual
     */
    getToken() {
        return this.fcmToken || localStorage.getItem('fcm_token');
    }

    /**
     * Verificar si está registrado
     */
    isRegisteredWithFCM() {
        return this.isRegistered;
    }
}

// Crear instancia global
window.pushNotificationsManager = new PushNotificationsManager();

// 🔧 v1.83.17: HABILITADO - Solo verifica permisos, NO los solicita
// Inicializar cuando el dispositivo esté listo
document.addEventListener('deviceready', async () => {
    console.log('🔔 [PUSH] Cordova listo, inicializando Push Notifications...');

    // Esperar 2 segundos para no interferir con otros componentes
    setTimeout(async () => {
        await window.pushNotificationsManager.initialize();
    }, 2000);
}, false);

console.log('🔔 [PUSH] Módulo cargado - Esperando deviceready...');
