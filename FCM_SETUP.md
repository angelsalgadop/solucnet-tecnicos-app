# 🔥 Configuración de Firebase Cloud Messaging (FCM)

## ✅ Lo que ya está hecho:

1. ✅ Plugin instalado (`@capacitor/push-notifications`)
2. ✅ Código JavaScript en la app (`push-notifications-manager.js`)
3. ✅ Tabla en base de datos (`fcm_tokens`)
4. ✅ Endpoints en servidor (`/api/fcm/save-token`)
5. ✅ Integración al asignar visitas

## 📋 Lo que DEBES hacer (10 minutos):

### Paso 1: Crear Proyecto en Firebase (3 min)

1. Ve a: https://console.firebase.google.com/
2. Click "Agregar proyecto"
3. Nombre: **SolucNet Técnicos**
4. Desactiva Google Analytics (no es necesario)
5. Click "Crear proyecto"

### Paso 2: Agregar App Android (3 min)

1. En el dashboard del proyecto, click ⚙️ → "Configuración del proyecto"
2. En la pestaña "General", click "Agregar app" → Selecciona **Android**
3. Package name: `com.solucnet.tecnicos`
4. Nickname de la app: **SolucNet Técnicos**
5. Click "Registrar app"
6. **DESCARGA** el archivo `google-services.json`

### Paso 3: Colocar google-services.json (1 min)

```bash
# Copiar el archivo descargado a:
/root/whatsapp-chatbot/android/app/google-services.json
```

### Paso 4: Obtener Clave Privada del Servidor (3 min)

1. En Firebase Console → ⚙️ → "Configuración del proyecto"
2. Pestaña **"Cuentas de servicio"**
3. Click "Generar nueva clave privada"
4. Descarga el archivo JSON
5. Guardar como: `/root/whatsapp-chatbot/firebase-admin-key.json`

**IMPORTANTE:** Este archivo tiene credenciales sensibles, NO lo subas a Git.

### Paso 5: Actualizar código del servidor (2 min)

Descomentar y configurar en `/root/whatsapp-chatbot/index.js`:

```javascript
// Agregar al inicio del archivo (después de los requires):
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-admin-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Reemplazar la función enviarPushNotification (línea ~6302):
async function enviarPushNotification(userId, titulo, mensaje, data = {}) {
    try {
        console.log('📤 [FCM] Enviando push notification a usuario:', userId);

        const [tokens] = await poolAuth.query(`
            SELECT fcm_token
            FROM fcm_tokens
            WHERE user_id = ? AND is_active = 1
            ORDER BY updated_at DESC
        `, [userId]);

        if (tokens.length === 0) {
            console.warn('⚠️ [FCM] No hay tokens FCM para usuario:', userId);
            return { success: false, message: 'No hay tokens FCM' };
        }

        console.log(`📤 [FCM] Encontrados ${tokens.length} tokens`);

        // Preparar mensaje
        const message = {
            notification: {
                title: titulo,
                body: mensaje
            },
            data: {
                ...data,
                timestamp: new Date().toISOString()
            },
            tokens: tokens.map(t => t.fcm_token)
        };

        // Enviar via Firebase Admin SDK
        const response = await admin.messaging().sendMulticast(message);

        console.log(`✅ [FCM] Push enviado: ${response.successCount} éxitos, ${response.failureCount} fallos`);

        // Desactivar tokens que fallaron
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx].fcm_token);
                }
            });

            if (failedTokens.length > 0) {
                await poolAuth.query(`
                    UPDATE fcm_tokens
                    SET is_active = 0
                    WHERE fcm_token IN (?)
                `, [failedTokens]);
            }
        }

        return {
            success: true,
            sent: response.successCount,
            failed: response.failureCount
        };

    } catch (error) {
        console.error('❌ [FCM] Error enviando push:', error);
        return { success: false, error: error.message };
    }
}
```

### Paso 6: Reiniciar servidor (1 min)

```bash
pm2 restart solucnet-bot
pm2 logs solucnet-bot --lines 50
```

Buscar en los logs: `✅ [FCM] Push enviado`

## 🧪 Testing

1. **Instala el APK v1.83.0** en el dispositivo
2. **Abre la app** → Aparecerá el log: `✅✅✅ [PUSH] FCM TOKEN RECIBIDO`
3. **Conecta chrome://inspect** → Copia el token FCM
4. **Cierra la app completamente**
5. **Desde el panel web, asigna una visita** al técnico
6. **Deberías recibir notificación** en la barra de estado ¡Incluso con app cerrada!

## 🔍 Logs de Diagnóstico

### En la app (chrome://inspect):
```
✅✅✅ [PUSH] FCM TOKEN RECIBIDO: eyJhbGciOiJIUzI1...
💾 [PUSH] Guardando token para usuario: Angel
✅ [PUSH] Token guardado en servidor
```

### En el servidor (pm2 logs):
```
💾 [FCM] Guardando token para usuario: Angel
✅ [FCM] Token guardado exitosamente
📤 [FCM] Enviando push notification a usuario: Angel
📤 [FCM] Encontrados 1 tokens
✅ [FCM] Push enviado: 1 éxitos, 0 fallos
```

## ⚠️ Notas Importantes

1. **google-services.json** es necesario para que la app compile
2. **firebase-admin-key.json** es necesario para que el servidor envíe push
3. Ambos archivos NO deben subirse a Git (ya están en .gitignore)
4. FCM funciona SOLO con Google Play Services (no en emuladores sin Google)
5. El dispositivo debe tener conexión a internet

## 🎯 ¿Funciona?

Si ves **notificaciones llegar con app CERRADA** = ✅ FCM funcionando correctamente

Si NO llegan:
1. Verifica logs del servidor: `pm2 logs solucnet-bot`
2. Verifica firebase-admin-key.json existe
3. Verifica que el token se guardó en la tabla fcm_tokens
4. Verifica que Google Play Services esté actualizado en el dispositivo
