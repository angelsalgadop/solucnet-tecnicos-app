// Gestor de permisos y notificaciones para la app móvil

// Función para solicitar TODOS los permisos necesarios al iniciar
async function solicitarPermisosIniciales() {
    console.log('📱 Solicitando permisos de la aplicación...');

    const permisosFaltantes = [];

    try {
        // 1. Permiso de Ubicación (GPS)
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
            try {
                console.log('📍 Solicitando permiso de ubicación...');
                const { Geolocation } = await import('@capacitor/geolocation');
                let permisoUbicacion = await Geolocation.checkPermissions();

                if (permisoUbicacion.location !== 'granted') {
                    permisoUbicacion = await Geolocation.requestPermissions();
                }

                if (permisoUbicacion.location !== 'granted') {
                    permisosFaltantes.push('📍 Ubicación (GPS)');
                    console.log('❌ Permiso de ubicación DENEGADO');
                } else {
                    console.log('✅ Permiso de ubicación OK');
                }
            } catch (error) {
                console.error('❌ Error solicitando permiso de ubicación:', error);
                permisosFaltantes.push('📍 Ubicación (GPS)');
            }

            // 2. Permiso de Cámara
            try {
                console.log('📷 Solicitando permiso de cámara...');
                const { Camera } = await import('@capacitor/camera');
                let permisoCamara = await Camera.checkPermissions();

                if (permisoCamara.camera !== 'granted' || permisoCamara.photos !== 'granted') {
                    permisoCamara = await Camera.requestPermissions();
                }

                if (permisoCamara.camera !== 'granted' || permisoCamara.photos !== 'granted') {
                    permisosFaltantes.push('📷 Cámara y Fotos');
                    console.log('❌ Permiso de cámara DENEGADO');
                } else {
                    console.log('✅ Permiso de cámara OK');
                }
            } catch (error) {
                console.error('❌ Error solicitando permiso de cámara:', error);
                permisosFaltantes.push('📷 Cámara y Fotos');
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
                } else {
                    permisosFaltantes.push('🔔 Notificaciones');
                    console.log('❌ Permiso de notificaciones DENEGADO');
                }
            } catch (error) {
                console.error('❌ Error configurando notificaciones:', error);
                permisosFaltantes.push('🔔 Notificaciones');
            }
        }

        // Si faltan permisos, mostrar mensaje y bloquear app
        if (permisosFaltantes.length > 0) {
            mostrarMensajePermisosFaltantes(permisosFaltantes);
            return false;
        }

        console.log('✅ Todos los permisos otorgados correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error general solicitando permisos:', error);
        return false;
    }
}

// Función para mostrar mensaje de permisos faltantes y bloquear la app
function mostrarMensajePermisosFaltantes(permisosFaltantes) {
    const mensajeHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 20px;">
            <div style="background: white; border-radius: 15px; padding: 30px; max-width: 400px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
                <i class="fas fa-shield-exclamation" style="font-size: 60px; color: #dc3545; margin-bottom: 20px;"></i>
                <h3 style="color: #333; margin-bottom: 15px;">⚠️ Permisos Requeridos</h3>
                <p style="color: #666; margin-bottom: 20px;">
                    La aplicación <strong>SolucNet Técnicos</strong> requiere los siguientes permisos para funcionar correctamente:
                </p>
                <div style="background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: left;">
                    ${permisosFaltantes.map(p => `<div style="padding: 5px 0; color: #dc3545;"><i class="fas fa-times-circle"></i> ${p}</div>`).join('')}
                </div>
                <p style="color: #666; font-size: 14px; margin-bottom: 20px;">
                    Por favor, ve a <strong>Configuración → Aplicaciones → SolucNet Técnicos → Permisos</strong> y habilita todos los permisos necesarios.
                </p>
                <button onclick="location.reload()" style="background: #28a745; color: white; border: none; padding: 12px 30px; border-radius: 25px; font-size: 16px; cursor: pointer; box-shadow: 0 4px 15px rgba(40,167,69,0.3);">
                    <i class="fas fa-sync-alt"></i> Reintentar
                </button>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', mensajeHTML);
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
        const API_BASE_URL = window.API_BASE_URL || 'https://cliente.solucnet.com:3000';
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
