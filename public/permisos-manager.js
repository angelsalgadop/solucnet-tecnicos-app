// Gestor de permisos y notificaciones para la app móvil

// Función para solicitar TODOS los permisos necesarios al iniciar
async function solicitarPermisosIniciales() {
    console.log('📱 Solicitando permisos de la aplicación...');

    try {
        // 1. Permiso de Ubicación (GPS)
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
            try {
                console.log('📍 Solicitando permiso de ubicación...');
                const { Geolocation } = await import('@capacitor/geolocation');
                const permisoUbicacion = await Geolocation.checkPermissions();

                if (permisoUbicacion.location !== 'granted') {
                    await Geolocation.requestPermissions();
                    console.log('✅ Permiso de ubicación solicitado');
                }
            } catch (error) {
                console.error('❌ Error solicitando permiso de ubicación:', error);
            }

            // 2. Permiso de Cámara
            try {
                console.log('📷 Solicitando permiso de cámara...');
                const { Camera } = await import('@capacitor/camera');
                const permisoCamara = await Camera.checkPermissions();

                if (permisoCamara.camera !== 'granted' || permisoCamara.photos !== 'granted') {
                    await Camera.requestPermissions();
                    console.log('✅ Permiso de cámara solicitado');
                }
            } catch (error) {
                console.error('❌ Error solicitando permiso de cámara:', error);
            }

            // 3. Permiso de Notificaciones Push
            try {
                console.log('🔔 Solicitando permiso de notificaciones...');
                const { PushNotifications } = await import('@capacitor/push-notifications');

                let permisoNotificaciones = await PushNotifications.checkPermissions();

                if (permisoNotificaciones.receive !== 'granted') {
                    permisoNotificaciones = await PushNotifications.requestPermissions();
                }

                if (permisoNotificaciones.receive === 'granted') {
                    // Registrar para recibir notificaciones
                    await PushNotifications.register();
                    console.log('✅ Notificaciones habilitadas');
                }
            } catch (error) {
                console.error('❌ Error configurando notificaciones:', error);
            }
        }

        console.log('✅ Permisos solicitados correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error general solicitando permisos:', error);
        return false;
    }
}

// Función para configurar listeners de notificaciones
async function configurarNotificaciones() {
    if (typeof Capacitor === 'undefined' || !Capacitor.isNativePlatform()) {
        console.log('⚠️ No estamos en plataforma nativa, notificaciones no disponibles');
        return;
    }

    try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // Listener: Registro exitoso
        await PushNotifications.addListener('registration', (token) => {
            console.log('✅ Token de notificación:', token.value);
            // Guardar el token para enviar al servidor
            localStorage.setItem('push_token', token.value);

            // OPCIONAL: Enviar token al servidor para poder enviar notificaciones
            enviarTokenAlServidor(token.value);
        });

        // Listener: Error en registro
        await PushNotifications.addListener('registrationError', (error) => {
            console.error('❌ Error registrando notificaciones:', error);
        });

        // Listener: Notificación recibida (app en foreground)
        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('🔔 Notificación recibida:', notification);

            // Mostrar alerta en la app
            if (typeof mostrarAlerta === 'function') {
                mostrarAlerta(notification.title + ': ' + notification.body, 'info');
            }
        });

        // Listener: Usuario toca la notificación
        await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
            console.log('👆 Usuario tocó notificación:', notification);

            const data = notification.notification.data;

            // Navegar según el tipo de notificación
            if (data.tipo === 'nueva_orden') {
                // Recargar visitas
                if (typeof cargarVisitasTecnico === 'function') {
                    cargarVisitasTecnico();
                }
            } else if (data.tipo === 'cambio_observacion') {
                // Mostrar la orden específica
                if (data.orden_id && typeof verDetallesVisita === 'function') {
                    verDetallesVisita(data.orden_id);
                }
            }
        });

        console.log('✅ Listeners de notificaciones configurados');
    } catch (error) {
        console.error('❌ Error configurando notificaciones:', error);
    }
}

// Función para enviar token al servidor (backend)
async function enviarTokenAlServidor(token) {
    try {
        const API_BASE_URL = 'https://cliente.solucnet.com:3000';
        const tokenTecnico = localStorage.getItem('token_tecnico');

        if (!tokenTecnico) return;

        const response = await fetch(API_BASE_URL + '/api/registrar-push-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenTecnico}`
            },
            body: JSON.stringify({
                push_token: token,
                plataforma: 'android'
            })
        });

        if (response.ok) {
            console.log('✅ Token enviado al servidor');
        }
    } catch (error) {
        console.error('❌ Error enviando token al servidor:', error);
    }
}

// Función para mostrar notificación local (cuando app está abierta)
async function mostrarNotificacionLocal(titulo, mensaje, datos = {}) {
    if (typeof Capacitor === 'undefined' || !Capacitor.isNativePlatform()) {
        return;
    }

    try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');

        await LocalNotifications.schedule({
            notifications: [{
                title: titulo,
                body: mensaje,
                id: Date.now(),
                schedule: { at: new Date(Date.now() + 1000) }, // 1 segundo después
                sound: null,
                attachments: null,
                actionTypeId: "",
                extra: datos
            }]
        });
    } catch (error) {
        console.error('❌ Error mostrando notificación local:', error);
    }
}

// Exportar funciones
if (typeof window !== 'undefined') {
    window.solicitarPermisosIniciales = solicitarPermisosIniciales;
    window.configurarNotificaciones = configurarNotificaciones;
    window.mostrarNotificacionLocal = mostrarNotificacionLocal;
}
