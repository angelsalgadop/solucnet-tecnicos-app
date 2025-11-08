# 📱 Compilar APK con Android Studio - Guía Paso a Paso

## ⏱️ Tiempo estimado: 10-15 minutos

---

## 📋 Requisitos Previos

### 1. Instalar Android Studio

**Descargar de**: https://developer.android.com/studio

- ✅ Windows / Mac / Linux
- ✅ Gratis y oficial de Google
- ✅ Incluye todo lo necesario

### 2. Instalar Git (opcional, para clonar)

**Descargar de**: https://git-scm.com/downloads

O simplemente descarga el ZIP del repositorio desde GitHub.

---

## 🚀 MÉTODO 1: Clonar con Git (Recomendado)

### Paso 1: Abrir Terminal/CMD

**Windows**: Presiona `Win + R`, escribe `cmd`, Enter

**Mac/Linux**: Abrir Terminal

### Paso 2: Clonar el Repositorio

```bash
# Navegar a donde quieras guardar el proyecto
cd Desktop

# Clonar el repositorio
git clone https://github.com/angelsalgadop/solucnet-tecnicos-app.git

# Entrar a la carpeta
cd solucnet-tecnicos-app
```

### Paso 3: Abrir en Android Studio

1. Abrir **Android Studio**
2. Click en **"Open"** (o "Abrir")
3. Navegar a la carpeta `solucnet-tecnicos-app/android`
4. Click en **"OK"**

**⚠️ IMPORTANTE**: Abrir la carpeta `android`, NO la carpeta raíz del proyecto.

---

## 🚀 MÉTODO 2: Descargar ZIP (Sin Git)

### Paso 1: Descargar el Código

1. Ir a: https://github.com/angelsalgadop/solucnet-tecnicos-app
2. Click en el botón verde **"Code"**
3. Click en **"Download ZIP"**
4. Descomprimir el archivo ZIP

### Paso 2: Abrir en Android Studio

1. Abrir **Android Studio**
2. Click en **"Open"** (o "Abrir")
3. Navegar a: `solucnet-tecnicos-app-main/android`
4. Click en **"OK"**

---

## 🔧 Compilar la APK

### Paso 4: Esperar Sincronización de Gradle

**Primera vez que abres el proyecto:**

1. Android Studio mostrará: **"Gradle Sync in Progress..."**
2. **Esperar** 2-5 minutos (descarga dependencias)
3. Verás **"Gradle sync finished"** cuando termine

**Si aparece algún error de SDK**:
- Android Studio te mostrará un banner amarillo
- Click en **"Install missing SDK packages"**
- Esperar a que termine

### Paso 5: Compilar APK de Debug

**Opción A: Desde el Menú**

1. En el menú superior: **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. Esperar 2-5 minutos
3. Aparecerá notificación: **"APK(s) generated successfully"**
4. Click en **"locate"** para abrir la carpeta

**Opción B: Desde Terminal en Android Studio**

1. En Android Studio, abrir la pestaña **"Terminal"** (abajo)
2. Ejecutar:
   ```bash
   ./gradlew assembleDebug
   ```
3. Esperar a que termine
4. La APK estará en: `app/build/outputs/apk/debug/app-debug.apk`

### Paso 6: Encontrar tu APK

**Ruta completa**:
```
solucnet-tecnicos-app/android/app/build/outputs/apk/debug/app-debug.apk
```

**O desde Android Studio**:
- Lado izquierdo, cambiar vista de "Android" a **"Project"**
- Navegar: `app` → `build` → `outputs` → `apk` → `debug`
- Ahí está tu `app-debug.apk`

---

## 📱 Instalar la APK en tu Teléfono

### MÉTODO 1: Via Cable USB (Recomendado)

#### Preparar el Teléfono:

1. En el teléfono, ir a **Configuración**
2. Buscar **"Acerca del teléfono"**
3. Tocar **7 veces** en "Número de compilación"
4. Verás: **"Ahora eres desarrollador"**
5. Volver a Configuración
6. Entrar a **"Opciones de desarrollador"**
7. Activar **"Depuración USB"**

#### Conectar y Instalar:

1. Conectar teléfono a la computadora con cable USB
2. En el teléfono, permitir **"Depuración USB"** si pregunta
3. En Android Studio, verás tu teléfono en la lista de dispositivos
4. Click en **Run** (▶️) o presiona `Shift + F10`
5. La app se instalará automáticamente

**O manualmente con ADB**:
```bash
# En la terminal de Android Studio
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### MÉTODO 2: Transferir APK Manualmente

1. Copiar `app-debug.apk` a tu teléfono
   - Por cable USB (copiar a Descargas)
   - Por email
   - Por Google Drive / Dropbox
   - Por WhatsApp (envíatela a ti mismo)

2. En el teléfono:
   - Abrir **Archivos** o **Descargas**
   - Tocar el archivo `app-debug.apk`
   - Si pide, permitir **"Instalar desde fuentes desconocidas"**
   - Tocar **"Instalar"**
   - Tocar **"Abrir"**

---

## 🎯 Compilar APK de Release (Producción)

Para una APK optimizada y lista para distribución:

### Sin Firma (más simple):

```bash
./gradlew assembleRelease
```

APK en: `app/build/outputs/apk/release/app-release-unsigned.apk`

### Con Firma (recomendado para producción):

1. **Crear Keystore** (solo una vez):

```bash
keytool -genkey -v -keystore solucnet-release.keystore \
  -alias solucnet-key -keyalg RSA -keysize 2048 -validity 10000
```

2. **Configurar Gradle**:

Crear archivo `android/keystore.properties`:

```properties
storePassword=TU_PASSWORD_AQUI
keyPassword=TU_PASSWORD_AQUI
keyAlias=solucnet-key
storeFile=../solucnet-release.keystore
```

3. **Compilar**:

```bash
./gradlew assembleRelease
```

APK firmada en: `app/build/outputs/apk/release/app-release.apk`

---

## ❓ Solución de Problemas Comunes

### ❌ Error: "SDK not found"

**Solución**:
1. Android Studio mostrará banner amarillo
2. Click en **"Install missing SDK packages"**
3. Esperar a que termine

### ❌ Error: "Gradle sync failed"

**Solución**:
1. File → Invalidate Caches / Restart
2. Click en "Invalidate and Restart"
3. Esperar a que Android Studio reinicie
4. Gradle se sincronizará automáticamente

### ❌ Error: "java.lang.OutOfMemoryError"

**Solución**:

Editar `android/gradle.properties`, agregar:

```properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxPermSize=512m
```

### ❌ La app no se instala en el teléfono

**Solución**:
1. Desinstalar versión anterior si existe
2. Verificar que "Fuentes desconocidas" esté permitido
3. Verificar que el teléfono tenga espacio libre
4. Reintentar

### ❌ Gradle tarda mucho

**Es normal la primera vez**:
- Primera compilación: 5-10 minutos (descarga todo)
- Compilaciones siguientes: 1-2 minutos (usa caché)

---

## 📊 Verificar que la APK Funcione

### Prueba Rápida:

1. **Instalar en teléfono**
2. **Abrir la app**
3. **Hacer login** con credenciales de técnico
4. **Cargar visitas**
5. **Probar modo offline**:
   - Activar "Modo Avión"
   - Intentar completar una visita
   - Debería funcionar sin internet
6. **Desactivar "Modo Avión"**
7. **Verificar sincronización** automática

---

## 📦 Tamaño de la APK

- **Debug**: ~50-70 MB (incluye herramientas de debug)
- **Release**: ~30-40 MB (optimizada)

---

## 🔄 Actualizar la App

Para compilar con cambios nuevos del repositorio:

```bash
# 1. Actualizar código
cd solucnet-tecnicos-app
git pull origin main

# 2. En Android Studio
# Build → Clean Project
# Build → Rebuild Project

# 3. Compilar APK nuevamente
./gradlew assembleDebug
```

---

## 📞 Soporte

Si tienes problemas:

1. **Ver logs de Gradle**: En Android Studio, pestaña "Build" (abajo)
2. **Limpiar proyecto**: Build → Clean Project
3. **Invalidar caché**: File → Invalidate Caches / Restart
4. **Verificar internet**: Gradle necesita descargar dependencias

---

## ✅ Checklist Final

Antes de distribuir la APK a los técnicos:

- [ ] APK compila sin errores
- [ ] APK se instala correctamente
- [ ] Login funciona
- [ ] Carga de visitas funciona
- [ ] Captura de fotos funciona
- [ ] GPS funciona (pedir permiso de ubicación)
- [ ] **Modo offline funciona**
- [ ] Sincronización automática funciona
- [ ] App no crashea

---

## 🎉 ¡Listo!

Ahora tienes tu APK de **SolucNet Técnicos** lista para:

✅ Instalar en teléfonos de técnicos
✅ Compartir via WhatsApp/Email
✅ Distribuir internamente
✅ (Opcional) Publicar en Google Play Store

**La app incluye**:
- ✅ Modo offline completo
- ✅ Sincronización automática
- ✅ Captura de fotos
- ✅ GPS de alta precisión
- ✅ Escáner de seriales
- ✅ Todas las funcionalidades de la web

---

**Versión**: 1.0.0
**Package**: com.solucnet.tecnicos
**Última actualización**: Noviembre 2025
