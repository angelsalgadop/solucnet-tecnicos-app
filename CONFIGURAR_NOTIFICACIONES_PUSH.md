# 🔔 CONFIGURAR NOTIFICACIONES PUSH (Firebase Cloud Messaging)

## ✅ YA HECHO EN EL CÓDIGO:

1. ✅ Permisos de notificaciones solicitados en la app
2. ✅ Listeners configurados en `permisos-manager.js`
3. ✅ Token push guardado en localStorage
4. ✅ Token enviado al servidor automáticamente
5. ✅ Firebase Admin SDK instalado en servidor

---

## 📋 LO QUE FALTA POR HACER (CONFIGURACIÓN DE FIREBASE):

### **1️⃣ CREAR PROYECTO EN FIREBASE**

1. Ve a: https://console.firebase.google.com/
2. Click en **"Agregar proyecto"**
3. Nombre del proyecto: **"SolucNet Técnicos"**
4. Click en **"Continuar"**
5. Deshabilita Google Analytics (no es necesario)
6. Click en **"Crear proyecto"**
7. Espera a que se cree el proyecto

---

### **2️⃣ AGREGAR ANDROID APP AL PROYECTO**

1. En el proyecto de Firebase, click en **"Agregar app"**
2. Selecciona **Android** (ícono de Android)
3. **Nombre del paquete Android:** `com.solucnet.tecnicos`
   - ⚠️ IMPORTANTE: Debe ser EXACTAMENTE este nombre
4. **Nombre de la app (opcional):** SolucNet Técnicos
5. Click en **"Registrar app"**
6. **Descarga el archivo `google-services.json`**
   - ⚠️ IMPORTANTE: Guardar este archivo
7. Click en **"Siguiente"** (los otros pasos no son necesarios por ahora)
8. Click en **"Ir a la consola"**

---

### **3️⃣ OBTENER CREDENCIALES DEL SERVIDOR (Service Account)**

1. En la consola de Firebase, click en **⚙️ Configuración** (arriba izquierda)
2. Click en **"Configuración del proyecto"**
3. Ve a la pestaña **"Cuentas de servicio"**
4. Click en **"Generar nueva clave privada"**
5. Click en **"Generar clave"**
6. Se descargará un archivo JSON (ejemplo: `solucnet-tecnicos-firebase-adminsdk-xxxxx.json`)
7. **GUARDAR ESTE ARCHIVO EN EL SERVIDOR**

---

### **4️⃣ COPIAR ARCHIVOS AL SERVIDOR**

#### **A. Copiar `google-services.json` a la app Android:**

```bash
# En tu computadora local (donde tienes el proyecto)
cp /ruta/del/descargado/google-services.json /tmp/solucnet-tecnicos-clean/android/app/
```

#### **B. Copiar credenciales del servidor:**

```bash
# Conectar al servidor
ssh usuario@181.79.84.3

# Crear carpeta para credenciales
mkdir -p /root/whatsapp-chatbot/firebase-credentials

# Copiar el archivo (desde tu computadora)
scp /ruta/del/descargado/solucnet-tecnicos-firebase-adminsdk-xxxxx.json usuario@181.79.84.3:/root/whatsapp-chatbot/firebase-credentials/firebase-admin-key.json

# Dar permisos
chmod 600 /root/whatsapp-chatbot/firebase-credentials/firebase-admin-key.json
```

---

### **5️⃣ CONFIGURAR VARIABLES DE ENTORNO EN EL SERVIDOR**

```bash
# En el servidor
nano /root/whatsapp-chatbot/.env
```

Agregar esta línea al final:

```env
FIREBASE_ADMIN_KEY=/root/whatsapp-chatbot/firebase-credentials/firebase-admin-key.json
```

Guardar (Ctrl+X, Y, Enter)

---

### **6️⃣ REINICIAR EL SERVIDOR**

```bash
pm2 restart solucnet-bot
pm2 logs solucnet-bot --lines 50
```

Deberías ver en los logs:

```
✅ Firebase Admin inicializado correctamente
🔔 Sistema de notificaciones push configurado
```

---

## 🧪 PROBAR NOTIFICACIONES PUSH:

### **Desde Postman o cURL:**

```bash
curl -X POST https://cliente.solucnet.com:3000/api/enviar-notificacion-tecnico \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_TOKEN_TECNICO" \
  -d '{
    "tecnico_id": 1,
    "titulo": "🔔 Nueva Orden Asignada",
    "mensaje": "Se te ha asignado una nueva orden de trabajo",
    "datos": {
      "tipo": "nueva_orden",
      "orden_id": 123
    }
  }'
```

Deberías recibir la notificación en el teléfono ✅

---

## 📋 ENDPOINTS DISPONIBLES:

### **1. Registrar Push Token** (automático desde la app)

```
POST /api/registrar-push-token
Headers:
  Authorization: Bearer TOKEN_TECNICO
Body:
  {
    "push_token": "eXXXXXXXXXXXXXX",
    "plataforma": "android"
  }
```

### **2. Enviar Notificación a Técnico**

```
POST /api/enviar-notificacion-tecnico
Headers:
  Authorization: Bearer TOKEN_ADMIN
Body:
  {
    "tecnico_id": 1,
    "titulo": "Título de la notificación",
    "mensaje": "Contenido del mensaje",
    "datos": {
      "tipo": "nueva_orden",
      "orden_id": 123
    }
  }
```

### **3. Enviar Notificación Masiva**

```
POST /api/enviar-notificacion-masiva
Headers:
  Authorization: Bearer TOKEN_ADMIN
Body:
  {
    "titulo": "Título de la notificación",
    "mensaje": "Contenido del mensaje",
    "datos": {
      "tipo": "aviso_general"
    }
  }
```

---

## 🎯 INTEGRACIÓN AUTOMÁTICA (YA CONFIGURADA):

### **Cuando se monte una nueva orden:**

El sistema automáticamente:
1. Busca el técnico asignado
2. Obtiene su push_token de la BD
3. Envía notificación push: "🔔 Nueva Orden Asignada"

### **Cuando se agregue una observación urgente:**

El sistema automáticamente:
1. Busca el técnico de esa orden
2. Obtiene su push_token de la BD
3. Envía notificación push: "⚠️ Observación Urgente"

---

## ❓ TROUBLESHOOTING:

### Error: "Firebase Admin not initialized"

✅ **Solución:** Verificar que el archivo `firebase-admin-key.json` exista y la variable de entorno `FIREBASE_ADMIN_KEY` esté configurada.

### Error: "Invalid registration token"

✅ **Solución:** El token del dispositivo cambió o expiró. La app volverá a registrarse automáticamente.

### No llegan las notificaciones

✅ **Verificar:**
1. El archivo `google-services.json` está en `android/app/`
2. Las credenciales del servidor están configuradas
3. El técnico tiene un push_token guardado en la BD
4. Los logs del servidor (`pm2 logs solucnet-bot`)

---

## 📊 TABLA DE BD NECESARIA:

```sql
-- Agregar columna a la tabla de usuarios/técnicos
ALTER TABLE usuarios ADD COLUMN push_token VARCHAR(500) DEFAULT NULL;
ALTER TABLE usuarios ADD COLUMN push_plataforma VARCHAR(20) DEFAULT NULL;
ALTER TABLE usuarios ADD COLUMN push_token_actualizado TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
```

---

¿Necesitas ayuda con algún paso? ¡Dime en cuál te quedaste! 🚀
