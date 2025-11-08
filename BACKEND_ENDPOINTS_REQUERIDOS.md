# Endpoints del Backend Requeridos

Este documento lista los endpoints que el backend necesita implementar para que la app móvil funcione correctamente.

## 🔔 NUEVO: Sistema de Notificaciones Push

### 1. Registrar Token de Notificación

**Endpoint:** `POST /api/registrar-push-token`

**Headers:**
```
Authorization: Bearer {token_tecnico}
Content-Type: application/json
```

**Body:**
```json
{
  "push_token": "string (token de Firebase/OneSignal)",
  "plataforma": "android"
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Token registrado correctamente"
}
```

**Uso:** Cuando el técnico abre la app, se registra su token para poder enviarle notificaciones.

---

### 2. Enviar Notificación a Técnico

**Endpoint:** `POST /api/enviar-notificacion-tecnico`

**Headers:**
```
Authorization: Bearer {token_admin}
Content-Type: application/json
```

**Body:**
```json
{
  "tecnico_id": 123,
  "titulo": "Nueva orden asignada",
  "mensaje": "Se te asignó la orden #456 en zona Centro",
  "tipo": "nueva_orden",
  "datos": {
    "orden_id": 456,
    "accion": "ver_orden"
  }
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "enviado": true,
  "message": "Notificación enviada"
}
```

**Cuándo enviar notificaciones:**

1. **Nueva orden asignada:**
   ```json
   {
     "titulo": "Nueva orden asignada",
     "mensaje": "Orden #123 - Cliente: Juan Pérez",
     "tipo": "nueva_orden",
     "datos": { "orden_id": 123 }
   }
   ```

2. **Cambio en observaciones:**
   ```json
   {
     "titulo": "Actualización en orden #123",
     "mensaje": "Se agregó una nueva observación",
     "tipo": "cambio_observacion",
     "datos": { "orden_id": 123 }
   }
   ```

3. **Cambio de estado:**
   ```json
   {
     "titulo": "Cambio de estado - Orden #123",
     "mensaje": "La orden cambió a: En Proceso",
     "tipo": "cambio_estado",
     "datos": { "orden_id": 123, "nuevo_estado": "en_proceso" }
   }
   ```

4. **Orden reprogramada:**
   ```json
   {
     "titulo": "Orden reprogramada",
     "mensaje": "Orden #123 - Nueva fecha: 2025-11-10",
     "tipo": "reprogramacion",
     "datos": { "orden_id": 123, "nueva_fecha": "2025-11-10" }
   }
   ```

---

## 📋 Implementación Backend Sugerida

### Base de Datos - Nueva Tabla

```sql
CREATE TABLE push_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    tecnico_id INT NOT NULL,
    push_token VARCHAR(500) NOT NULL,
    plataforma VARCHAR(20) NOT NULL, -- 'android' o 'ios'
    activo BOOLEAN DEFAULT true,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
    ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id),
    UNIQUE KEY unique_token (push_token)
);
```

### Código Node.js/Express Sugerido

```javascript
// Endpoint para registrar token
app.post('/api/registrar-push-token', autenticarTecnico, async (req, res) => {
    try {
        const { push_token, plataforma } = req.body;
        const tecnico_id = req.user.id;

        // Guardar o actualizar token
        await db.query(`
            INSERT INTO push_tokens (tecnico_id, push_token, plataforma)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
                tecnico_id = VALUES(tecnico_id),
                plataforma = VALUES(plataforma),
                ultima_actualizacion = NOW(),
                activo = true
        `, [tecnico_id, push_token, plataforma]);

        res.json({ success: true, message: 'Token registrado' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Función helper para enviar notificación
async function enviarNotificacionPush(tecnico_id, titulo, mensaje, datos = {}) {
    try {
        // Obtener tokens activos del técnico
        const tokens = await db.query(
            'SELECT push_token FROM push_tokens WHERE tecnico_id = ? AND activo = true',
            [tecnico_id]
        );

        if (tokens.length === 0) return;

        // Usar Firebase Cloud Messaging (FCM)
        const admin = require('firebase-admin');

        const payload = {
            notification: {
                title: titulo,
                body: mensaje
            },
            data: datos
        };

        // Enviar a todos los dispositivos del técnico
        for (const token of tokens) {
            try {
                await admin.messaging().sendToDevice(token.push_token, payload);
            } catch (error) {
                console.error('Error enviando a token:', error);
                // Si el token es inválido, marcarlo como inactivo
                if (error.code === 'messaging/invalid-registration-token') {
                    await db.query(
                        'UPDATE push_tokens SET activo = false WHERE push_token = ?',
                        [token.push_token]
                    );
                }
            }
        }
    } catch (error) {
        console.error('Error enviando notificación push:', error);
    }
}

// Ejemplo: Al asignar una orden
app.post('/api/asignar-orden', autenticarAdmin, async (req, res) => {
    try {
        const { orden_id, tecnico_id } = req.body;

        // Asignar orden...
        await db.query('UPDATE ordenes SET tecnico_id = ? WHERE id = ?', [tecnico_id, orden_id]);

        // Enviar notificación
        await enviarNotificacionPush(
            tecnico_id,
            'Nueva orden asignada',
            `Se te asignó la orden #${orden_id}`,
            { tipo: 'nueva_orden', orden_id: orden_id }
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
```

---

## 🔥 Firebase Cloud Messaging Setup

Para enviar notificaciones, necesitas configurar Firebase:

1. Crear proyecto en Firebase Console
2. Descargar archivo `google-services.json`
3. Colocar en `android/app/google-services.json`
4. Instalar SDK en backend:
   ```bash
   npm install firebase-admin
   ```

5. Inicializar en tu servidor:
   ```javascript
   const admin = require('firebase-admin');
   const serviceAccount = require('./firebase-service-account.json');

   admin.initializeApp({
       credential: admin.credential.cert(serviceAccount)
   });
   ```

---

## ⚠️ IMPORTANTE: Problema SSL Actual

La app actualmente tiene problemas de "failed to fetch" con `https://cliente.solucnet.com:3000`.

**Posibles soluciones:**

1. **Certificado SSL válido:** El servidor debe tener un certificado SSL válido para `cliente.solucnet.com`

2. **Verificar que el servidor responde:**
   ```bash
   curl -k https://cliente.solucnet.com:3000/api/session
   ```

3. **Alternativa temporal:** Usar HTTP en lugar de HTTPS (NO recomendado para producción):
   ```javascript
   const API_BASE_URL = 'http://cliente.solucnet.com:3000';
   ```

---

## 📱 Resumen de Cambios en la App

La app móvil ahora incluye:

✅ Solicitud automática de permisos (ubicación, cámara, notificaciones)
✅ Registro de token para notificaciones push
✅ Listeners para recibir notificaciones
✅ Navegación automática cuando el usuario toca una notificación
✅ Soporte para notificaciones en foreground y background

**El técnico verá notificaciones cuando:**
- Se le asigne una nueva orden
- Cambien las observaciones de una orden
- Se reprograme una orden
- Cambie el estado de una orden
