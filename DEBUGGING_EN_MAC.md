# 🍎 DEPURAR APP ANDROID DESDE MAC

## OPCIÓN 1: Edge Browser (Más fácil - RECOMENDADO)

Microsoft Edge funciona igual que Chrome para depuración Android.

### Pasos:

1. **Instalar Edge** (si no lo tienes):
   - Ve a: https://www.microsoft.com/edge
   - Descarga e instala

2. **Abrir Edge Debugging:**
   - Abre Microsoft Edge
   - Ve a: `edge://inspect/#devices`
   - Sigue los mismos pasos que con Chrome

---

## OPCIÓN 2: Android Debug Bridge (Terminal - Sin navegador)

Usa la Terminal de Mac para ver los logs directamente.

### Pasos:

1. **Instalar Android Platform Tools:**
   ```bash
   # Con Homebrew
   brew install android-platform-tools
   
   # O descargar directamente:
   # https://developer.android.com/tools/releases/platform-tools
   ```

2. **Conectar teléfono con USB y habilitar Depuración USB**

3. **Verificar conexión:**
   ```bash
   adb devices
   ```
   
   Deberías ver:
   ```
   List of devices attached
   ABC123456789    device
   ```

4. **Ver logs en tiempo real:**
   ```bash
   adb logcat | grep -i "chromium\|console\|error"
   ```

5. **Abrir la app en el teléfono y hacer login**

6. **Los logs se mostrarán en la Terminal**

### Comandos útiles:

```bash
# Ver SOLO errores
adb logcat *:E

# Ver logs de tu app específicamente
adb logcat | grep "solucnet"

# Limpiar logs anteriores
adb logcat -c

# Ver logs y guardar en archivo
adb logcat > logs.txt
```

---

## OPCIÓN 3: Chrome (si el problema es otro)

¿Por qué no puedes usar Chrome en Mac?

- **Si es porque no lo tienes instalado:** Descárgalo de chrome.google.com
- **Si es por permisos:** Puedes usar la versión portable
- **Si es por otra razón:** Dime cuál es y te ayudo

---

## OPCIÓN 4: Firefox Developer Edition

Firefox también tiene herramientas para depurar Android.

### Pasos:

1. **Instalar Firefox Developer Edition:**
   - https://www.mozilla.org/firefox/developer/

2. **Habilitar Remote Debugging:**
   - En Firefox: `about:debugging`
   - Click en "Enable USB Devices"
   - Conecta tu teléfono
   - Aparecerá tu dispositivo
   - Click en "Connect"

---

## 🎯 ¿Cuál prefieres?

**Recomendación:** 

1. **OPCIÓN 1 (Edge)** - Si puedes instalar Edge → Más visual, fácil de usar
2. **OPCIÓN 2 (adb en Terminal)** - Si prefieres línea de comandos → Más técnico pero efectivo

Dime cuál prefieres y te guío paso a paso.
