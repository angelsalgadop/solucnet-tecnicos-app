# 🍎 Depurar Android con Edge en Mac - PASO A PASO

## PASO 1: Instalar Microsoft Edge

1. Abre Safari en tu Mac

2. Ve a: **https://www.microsoft.com/edge**

3. Click en **"Descargar para macOS"**

4. Se descargará un archivo `.pkg`

5. Abre el archivo descargado

6. Sigue el instalador (Next → Next → Install)

7. Una vez instalado, abre **Microsoft Edge**

---

## PASO 2: Habilitar Depuración USB en tu Teléfono Android

(Igual que con Chrome)

1. En tu teléfono Android, ve a **Configuración**

2. Baja hasta **"Acerca del teléfono"** o **"Sistema"** → **"Acerca del teléfono"**

3. Busca **"Número de compilación"**

4. **Toca 7 veces seguidas** sobre ese número
   - Aparecerá: "Ahora eres un desarrollador"

5. Vuelve al menú principal de Configuración

6. Verás un nuevo menú: **"Opciones de desarrollador"**

7. Entra ahí y **ACTIVA**:
   - ✅ **"Depuración USB"**

8. Click en **"Permitir"** cuando pregunte

---

## PASO 3: Conectar Teléfono a tu Mac

1. Conecta tu teléfono Android con **cable USB** a tu Mac

2. En el teléfono aparecerá:
   ```
   ¿Permitir depuración USB?
   [Cancelar] [Permitir]
   ```

3. **IMPORTANTE:** Marca la casilla "Permitir siempre desde esta computadora"

4. Click en **"Permitir"**

---

## PASO 4: Abrir Edge DevTools

1. Abre **Microsoft Edge** en tu Mac

2. En la barra de direcciones, escribe:
   ```
   edge://inspect/#devices
   ```

3. Presiona Enter

4. Verás una página que dice:
   ```
   Devices
   
   Discover USB devices
   [✓] Enabled
   
   Remote Target
   ```

5. **IMPORTANTE:** Asegúrate que la casilla **"Discover USB devices"** esté **MARCADA** (✓)

6. Espera 5-10 segundos...

7. Deberías ver tu dispositivo aparecer:
   ```
   Galaxy A52 (o el nombre de tu teléfono)
   Serial: ABC123456789
   ```

---

## PASO 5: Abrir la App y Conectar

1. En tu **teléfono**, abre la app **SolucNet Técnicos**

2. En **Edge en tu Mac**, actualiza la página (⌘ + R)

3. Ahora deberías ver algo como:
   ```
   Remote Target #ABC123
   
   com.solucnet.tecnicos
   http://localhost/index.html
   
   [inspect] [focus tab] [reload] [close]
   ```

4. Click en el botón azul **`inspect`**

---

## PASO 6: Ver la Consola

Se abrirá una nueva ventana de **Edge DevTools**

### Verás estas pestañas:

- **Elements** (HTML)
- **Console** ← **ESTA ES LA MÁS IMPORTANTE**
- **Sources** (código)
- **Network** ← **TAMBIÉN IMPORTANTE**
- **Application** (localStorage)
- **Memory**
- **Performance**

### Click en la pestaña **"Console"**

Aquí verás todos los mensajes:

```
ℹ️ Mensajes normales en azul/gris
⚠️ Advertencias en amarillo/naranja
❌ ERRORES EN ROJO ← LO QUE BUSCAMOS
```

---

## PASO 7: Reproducir el Error

1. En tu **teléfono**:
   - Si no estás logueado, ingresa usuario y contraseña
   - Click en **"Iniciar sesión"**

2. Cuando aparezca **"Cargando visitas asignadas..."** y se quede ahí

3. Mira la **consola en Edge (Mac)**

4. Busca líneas en **ROJO** (errores)

5. También ve a la pestaña **"Network"**:
   - Busca peticiones en **ROJO** (fallidas)
   - Click en cada una para ver detalles

---

## 🎯 QUÉ NECESITO QUE ME ENVÍES

### 1. Screenshot de la pestaña "Console"
   - Captura toda la consola
   - Asegúrate que se vean los errores en rojo
   - Usa ⌘ + Shift + 3 para captura completa
   - O ⌘ + Shift + 4 para área seleccionada

### 2. Screenshot de la pestaña "Network"
   - Click en "Network"
   - Busca peticiones en ROJO
   - Click en la petición roja
   - Screenshot de los detalles (Headers, Response, etc.)

### 3. Copia el texto del error
   - En la consola, click derecho sobre el error rojo
   - "Copy" o "Copiar"
   - Pégalo en un mensaje

---

## ⚠️ PROBLEMAS COMUNES EN MAC

### "No aparece mi dispositivo en edge://inspect"

**Soluciones:**

1. **Verifica que el cable USB funcione:**
   - Algunos cables solo cargan, no transfieren datos
   - Prueba con otro cable USB

2. **Desconectar y reconectar:**
   - Desconecta el teléfono
   - Espera 5 segundos
   - Vuelve a conectar
   - Acepta de nuevo "Permitir depuración USB"

3. **Reiniciar Edge:**
   - Cierra Edge completamente (⌘ + Q)
   - Abre Edge de nuevo
   - Ve a edge://inspect/#devices

4. **Verificar que Depuración USB esté activa:**
   - En teléfono: Configuración → Opciones desarrollador
   - Verifica que "Depuración USB" esté ON (verde)

### "Aparece el dispositivo pero no aparece 'com.solucnet.tecnicos'"

**Soluciones:**

1. **Cierra y abre la app:**
   - Cierra completamente la app en el teléfono
   - Abre de nuevo
   - Actualiza edge://inspect (⌘ + R)

2. **Mantén la app en primer plano:**
   - La app debe estar visible en el teléfono
   - No puede estar en segundo plano
   - El teléfono debe estar desbloqueado

### "Sale 'Not available' o 'Offline'"

**Soluciones:**

1. **Desbloquea el teléfono:**
   - No puede estar con pantalla bloqueada
   - Debe estar desbloqueado y app visible

2. **Acepta permisos:**
   - Revisa si hay algún diálogo en el teléfono
   - Acepta cualquier permiso que pida

---

## 📸 Cuando tengas los screenshots

Mándame:

1. ✅ Screenshot de **Console** (con errores en rojo)
2. ✅ Screenshot de **Network** (peticiones fallidas en rojo)
3. ✅ Texto copiado del error

Con eso sabré **exactamente** qué está pasando y te daré la solución definitiva.

---

## 💡 Tip Extra

Si ves MUCHOS mensajes en la consola y no encuentras el error:

1. Click derecho en la consola
2. "Clear console" o "Limpiar consola"
3. En el teléfono, haz login de nuevo
4. Verás solo los mensajes nuevos (será más fácil encontrar el error)
