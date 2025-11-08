# 📱 DEPURAR LA APP - PASO A PASO

## PASO 1: Habilitar Depuración USB en tu Teléfono

1. Abre **Configuración** en tu teléfono Android

2. Baja hasta **"Acerca del teléfono"** o **"Sistema"** → **"Acerca del teléfono"**

3. Busca **"Número de compilación"** o **"Versión de compilación"**

4. **Toca 7 veces** rápidamente sobre ese número
   - Aparecerá un mensaje: "Ahora eres un desarrollador" o similar

5. Vuelve atrás al menú principal de Configuración

6. Ahora verás un nuevo menú: **"Opciones de desarrollador"** o **"Developer options"**

7. Entra a ese menú

8. Busca y **ACTIVA**:
   - ✅ **"Depuración USB"** o **"USB debugging"**

9. Aparecerá un diálogo de confirmación → Click en **"Permitir"** o **"OK"**

---

## PASO 2: Conectar Teléfono a la Computadora

1. Conecta tu teléfono con **cable USB** a tu computadora

2. En el teléfono aparecerá un diálogo:
   ```
   ¿Permitir depuración USB?
   La huella digital de la clave RSA de la computadora es:
   XX:XX:XX:XX...
   
   [ ] Permitir siempre desde esta computadora
   [Cancelar] [Permitir]
   ```

3. **MARCA** la casilla "Permitir siempre..."

4. Click en **"Permitir"**

---

## PASO 3: Abrir Chrome Remote Debugging

1. En tu **computadora**, abre **Google Chrome**

2. En la barra de direcciones, escribe exactamente:
   ```
   chrome://inspect/#devices
   ```

3. Presiona Enter

4. Verás una página que dice:
   ```
   Devices
   
   Remote Target
   ```

5. Espera unos segundos... Debería aparecer tu dispositivo:
   ```
   Galaxy A52 (o el nombre de tu teléfono)
   
   com.solucnet.tecnicos
   http://localhost/...
   ```

---

## PASO 4: Abrir la App y Conectar

1. En tu **teléfono**, abre la app **SolucNet Técnicos**

2. **NO cierres Chrome en la computadora**

3. En Chrome, actualiza la página (F5)

4. Ahora SÍ deberías ver:
   ```
   Remote Target #ABCD1234
   
   com.solucnet.tecnicos
   http://localhost/tecnicos_visitas.html
   
   [inspect] [focus tab] [reload] [close]
   ```

5. Click en el botón **`inspect`**

---

## PASO 5: Ver la Consola

Se abrirá una nueva ventana de Chrome DevTools.

### Verás varias pestañas:

- **Elements** (HTML de la página)
- **Console** ← **ESTA ES LA IMPORTANTE**
- **Sources** (código fuente)
- **Network** ← **ESTA TAMBIÉN ES IMPORTANTE**
- **Application** (localStorage)

### Ve a la pestaña "Console"

Aquí verás TODOS los mensajes:

```
✅ Mensajes en azul/negro (info)
⚠️ Advertencias en amarillo
❌ ERRORES EN ROJO ← Esto es lo que buscamos
```

---

## PASO 6: Reproducir el Error

1. En tu **teléfono**, si no estás logueado, haz **login**

2. Cuando se quede **"Cargando visitas asignadas..."**

3. Mira la **consola en Chrome (PC)**

4. Busca mensajes en **ROJO** (errores)

---

## 🎯 QUÉ NECESITO QUE ME MANDES

### 1. Screenshot de la Pestaña "Console"
   - Con todos los errores visibles (en rojo)
   - Si hay muchos mensajes, scroll hacia arriba para ver el primero

### 2. Screenshot de la Pestaña "Network"
   - Click en la pestaña "Network"
   - Verás una lista de peticiones
   - Busca las que estén en ROJO
   - Click en la petición en rojo
   - Screenshot de los detalles

### 3. Copia y pega el error exacto
   - En la consola, click derecho sobre el error en rojo
   - "Copy message" o "Copiar mensaje"
   - Pégalo aquí

---

## ⚠️ PROBLEMAS COMUNES

### "No aparece mi dispositivo en chrome://inspect"

**Soluciones:**
1. Desconectar y reconectar el cable USB
2. Cambiar de puerto USB en la computadora
3. Probar con otro cable USB
4. En el teléfono: Configuración → Opciones desarrollador → Revocar autorizaciones → Volver a conectar

### "Aparece el dispositivo pero no aparece 'com.solucnet.tecnicos'"

**Soluciones:**
1. Cerrar la app en el teléfono
2. Abrirla de nuevo
3. Actualizar (F5) la página chrome://inspect en Chrome

### "Sale 'Offline' en Chrome"

**Soluciones:**
1. Desbloquear el teléfono (no puede estar bloqueado)
2. Mantener la app abierta en primer plano
3. Reconectar el cable

---

## 📞 Estoy listo para ayudarte

Una vez que veas la consola, mándame:
1. ✅ Screenshot de Console (con errores en rojo)
2. ✅ Screenshot de Network (peticiones fallidas)
3. ✅ Texto del error exacto

Con eso sabré exactamente qué está pasando y te daré la solución definitiva.
