/**
 * Sistema de Notificaciones para SolucNet Técnicos
 * Maneja notificaciones de:
 * - Nuevas visitas asignadas
 * - Observaciones urgentes
 * - Cambios en estado de visitas
 *
 * v1.75.1 - 2025-01-14
 */

class NotificationsManager {
    constructor() {
        this.visitasNotificadas = new Set();
        this.observacionesNotificadas = new Set();
        this.isInitialized = false;
        this.notificationId = 1;
    }

    /**
     * 🔧 v1.78: Solo verificar - NO solicitar automáticamente para evitar cierres
     */
    async initialize() {
        console.log('🔔 [NOTIFICACIONES] Inicializando sistema (sin solicitar permisos)...');

        try {
            // Verificar si el plugin está disponible
            if (typeof Capacitor === 'undefined' || !Capacitor.Plugins.LocalNotifications) {
                console.warn('⚠️ [NOTIFICACIONES] Plugin no disponible');
                return false;
            }

            // Solo VERIFICAR si ya tenemos permisos (NO solicitar)
            const currentPermission = await Capacitor.Plugins.LocalNotifications.checkPermissions();

            if (currentPermission.display === 'granted') {
                console.log('✅ [NOTIFICACIONES] Permisos ya concedidos');
                this.isInitialized = true;
            } else {
                console.log('ℹ️ [NOTIFICACIONES] Sin permisos - usar activación manual');
            }

            this.loadNotifiedIds();
            this.setupNotificationListeners();
            return true;
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error inicializando:', error);
            return false;
        }
    }

    /**
     * 🆕 v1.76: Solicitar permisos MANUALMENTE
     */
    async requestPermissionsManually() {
        try {
            if (typeof Capacitor === 'undefined' || !Capacitor.Plugins.LocalNotifications) {
                return false;
            }

            const permission = await Capacitor.Plugins.LocalNotifications.requestPermissions();

            if (permission.display === 'granted') {
                console.log('✅ [NOTIFICACIONES] Permisos concedidos');
                this.isInitialized = true;
                return true;
            } else {
                console.warn('⚠️ [NOTIFICACIONES] Permisos denegados');
                return false;
            }
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error solicitando permisos:', error);
            return false;
        }
    }

    /**
     * Configurar listeners para clicks en notificaciones
     */
    setupNotificationListeners() {
        Capacitor.Plugins.LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
            console.log('🔔 [NOTIFICACIONES] Click en notificación:', notification);

            // Si la app está en background, traerla al frente
            if (window.backgroundModeManager && window.backgroundModeManager.isInBackground()) {
                cordova.plugins.backgroundMode.moveToForeground();
            }

            // Recargar visitas para mostrar la nueva
            if (typeof cargarVisitasTecnico === 'function') {
                cargarVisitasTecnico();
            }
        });
    }

    /**
     * Cargar IDs de visitas/observaciones ya notificadas
     */
    loadNotifiedIds() {
        try {
            const visitasStr = localStorage.getItem('visitas_notificadas');
            if (visitasStr) {
                this.visitasNotificadas = new Set(JSON.parse(visitasStr));
            }

            const obsStr = localStorage.getItem('observaciones_notificadas');
            if (obsStr) {
                this.observacionesNotificadas = new Set(JSON.parse(obsStr));
            }

            console.log(`📋 [NOTIFICACIONES] Cargadas ${this.visitasNotificadas.size} visitas y ${this.observacionesNotificadas.size} observaciones notificadas`);
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error cargando IDs:', error);
        }
    }

    /**
     * Guardar IDs de visitas/observaciones notificadas
     */
    saveNotifiedIds() {
        try {
            localStorage.setItem('visitas_notificadas', JSON.stringify([...this.visitasNotificadas]));
            localStorage.setItem('observaciones_notificadas', JSON.stringify([...this.observacionesNotificadas]));
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error guardando IDs:', error);
        }
    }

    /**
     * Verificar nuevas visitas y enviar notificaciones
     */
    async checkNewVisits(visitasActuales) {
        if (!this.isInitialized) return;

        try {
            const nuevasVisitas = visitasActuales.filter(v =>
                v.estado === 'asignada' && !this.visitasNotificadas.has(v.id)
            );

            for (const visita of nuevasVisitas) {
                await this.sendVisitaNotification(visita);
                this.visitasNotificadas.add(visita.id);
            }

            if (nuevasVisitas.length > 0) {
                this.saveNotifiedIds();
            }
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error verificando nuevas visitas:', error);
        }
    }

    /**
     * Verificar observaciones urgentes y enviar notificaciones
     */
    async checkUrgentObservations(visitasActuales) {
        if (!this.isInitialized) return;

        try {
            const visitasConObsUrgente = visitasActuales.filter(v => {
                const obsKey = `${v.id}_${v.observacion_ultima_hora}`;
                return v.observacion_ultima_hora &&
                       v.observacion_ultima_hora.trim() !== '' &&
                       !this.observacionesNotificadas.has(obsKey);
            });

            for (const visita of visitasConObsUrgente) {
                await this.sendObservacionUrgentNotification(visita);
                const obsKey = `${visita.id}_${visita.observacion_ultima_hora}`;
                this.observacionesNotificadas.add(obsKey);
            }

            if (visitasConObsUrgente.length > 0) {
                this.saveNotifiedIds();
            }
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error verificando observaciones urgentes:', error);
        }
    }

    /**
     * Enviar notificación de nueva visita
     */
    async sendVisitaNotification(visita) {
        // 🔧 v1.76.1: VALIDAR permisos ANTES de enviar (evita cierres)
        if (!this.isInitialized) {
            console.log('ℹ️ [NOTIFICACIONES] Sin permisos - no se enviará notificación de visita');
            return;
        }

        try {
            const notification = {
                title: '🆕 Nueva Visita Asignada',
                body: `${visita.cliente_nombre}\n${visita.motivo_visita}`,
                id: this.notificationId++,
                schedule: { at: new Date(Date.now() + 1000) }, // 1 segundo después
                sound: 'default',
                attachments: null,
                actionTypeId: 'nueva_visita',
                extra: {
                    visita_id: visita.id,
                    tipo: 'nueva_visita'
                }
            };

            await Capacitor.Plugins.LocalNotifications.schedule({
                notifications: [notification]
            });

            console.log(`🔔 [NOTIFICACIONES] Enviada notificación de nueva visita: ${visita.id}`);

            // Vibrar el dispositivo
            if (navigator.vibrate) {
                navigator.vibrate([200, 100, 200]);
            }

            // Actualizar notificación del background mode si está activo
            if (window.backgroundModeManager && window.backgroundModeManager.isInBackground()) {
                window.backgroundModeManager.updateNotification(
                    'Nueva visita asignada',
                    visita.cliente_nombre
                );
            }
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error enviando notificación de visita:', error);
        }
    }

    /**
     * Enviar notificación de observación urgente
     */
    async sendObservacionUrgentNotification(visita) {
        // 🔧 v1.76.1: VALIDAR permisos ANTES de enviar (evita cierres)
        if (!this.isInitialized) {
            console.log('ℹ️ [NOTIFICACIONES] Sin permisos - no se enviará notificación de observación');
            return;
        }

        try {
            const notification = {
                title: '⚠️ OBSERVACIÓN URGENTE',
                body: `${visita.cliente_nombre}\n${visita.observacion_ultima_hora}`,
                id: this.notificationId++,
                schedule: { at: new Date(Date.now() + 1000) },
                sound: 'default',
                attachments: null,
                actionTypeId: 'observacion_urgente',
                extra: {
                    visita_id: visita.id,
                    tipo: 'observacion_urgente'
                }
            };

            await Capacitor.Plugins.LocalNotifications.schedule({
                notifications: [notification]
            });

            console.log(`🔔 [NOTIFICACIONES] Enviada notificación de observación urgente: ${visita.id}`);

            // Vibración más intensa para observaciones urgentes
            if (navigator.vibrate) {
                navigator.vibrate([300, 100, 300, 100, 300]);
            }

            // Actualizar notificación del background mode
            if (window.backgroundModeManager && window.backgroundModeManager.isInBackground()) {
                window.backgroundModeManager.updateNotification(
                    '⚠️ OBSERVACIÓN URGENTE',
                    visita.cliente_nombre
                );
            }
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error enviando notificación de observación:', error);
        }
    }

    /**
     * Enviar notificación personalizada
     */
    async sendCustomNotification(title, body, extra = {}) {
        if (!this.isInitialized) return;

        try {
            const notification = {
                title: title,
                body: body,
                id: this.notificationId++,
                schedule: { at: new Date(Date.now() + 1000) },
                sound: 'default',
                attachments: null,
                actionTypeId: 'custom',
                extra: extra
            };

            await Capacitor.Plugins.LocalNotifications.schedule({
                notifications: [notification]
            });

            console.log(`🔔 [NOTIFICACIONES] Enviada notificación personalizada: ${title}`);
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error enviando notificación personalizada:', error);
        }
    }

    /**
     * Limpiar IDs antiguos (visitas completadas hace más de 7 días)
     */
    cleanupOldIds() {
        try {
            // Por ahora solo limitamos el tamaño del Set
            if (this.visitasNotificadas.size > 1000) {
                const array = [...this.visitasNotificadas];
                this.visitasNotificadas = new Set(array.slice(-500));
                console.log('🧹 [NOTIFICACIONES] Limpieza de IDs antiguos de visitas');
            }

            if (this.observacionesNotificadas.size > 1000) {
                const array = [...this.observacionesNotificadas];
                this.observacionesNotificadas = new Set(array.slice(-500));
                console.log('🧹 [NOTIFICACIONES] Limpieza de IDs antiguos de observaciones');
            }

            this.saveNotifiedIds();
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error en limpieza:', error);
        }
    }

    /**
     * Limpiar todas las notificaciones pendientes
     */
    async clearAllNotifications() {
        if (!this.isInitialized) return;

        try {
            await Capacitor.Plugins.LocalNotifications.cancel({
                notifications: await Capacitor.Plugins.LocalNotifications.getPending()
            });
            console.log('🧹 [NOTIFICACIONES] Todas las notificaciones pendientes limpiadas');
        } catch (error) {
            console.error('❌ [NOTIFICACIONES] Error limpiando notificaciones:', error);
        }
    }

    /**
     * Reiniciar el sistema (para cuando se cierra sesión)
     */
    reset() {
        this.visitasNotificadas.clear();
        this.observacionesNotificadas.clear();
        this.saveNotifiedIds();
        this.clearAllNotifications();
        console.log('🔄 [NOTIFICACIONES] Sistema reiniciado');
    }
}

// Crear instancia global
window.notificationsManager = new NotificationsManager();

// Inicializar cuando el dispositivo esté listo
document.addEventListener('deviceready', async () => {
    console.log('🔔 [NOTIFICACIONES] Cordova listo, inicializando notificaciones...');
    await window.notificationsManager.initialize();

    // Limpiar IDs antiguos cada 24 horas
    setInterval(() => {
        window.notificationsManager.cleanupOldIds();
    }, 24 * 60 * 60 * 1000);
}, false);

console.log('🔔 [NOTIFICACIONES] Módulo cargado - Esperando deviceready...');
