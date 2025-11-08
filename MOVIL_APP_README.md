# 📱 SolucNet Técnicos - Aplicación Móvil Android

## Descripción

Aplicación móvil nativa para técnicos de SolucNet que permite gestionar visitas técnicas con **modo offline completo**. Los técnicos pueden continuar trabajando sin conexión a internet y todos los datos se sincronizarán automáticamente cuando se restaure la conexión.

## 🚀 Características Principales

### ✅ Funcionalidades Completas
- ✅ Login y autenticación con sesión persistente
- ✅ Visualización de visitas asignadas
- ✅ Iniciar y completar visitas técnicas
- ✅ Captura de fotos con cámara o galería
- ✅ Captura de coordenadas GPS de alta precisión
- ✅ Escaneo de seriales de equipos
- ✅ Mapa interactivo de clientes
- ✅ Filtros por localidad y estado
- ✅ Notificaciones de llegada al cliente
- ✅ Cancelación de visitas
- ✅ Creación de cajas NAP
- ✅ Visualización de PDFs

### 🔌 Modo Offline Completo

#### ✨ Funcionamiento Sin Conexión
- 📥 **Precarga de datos**: Al cargar visitas con conexión, se guardan localmente
- 📴 **Trabajo offline**: Completar visitas, tomar fotos, capturar GPS sin internet
- 🔄 **Sincronización automática**: Los datos se envían automáticamente al restaurar conexión
- 🟢 **Indicador visual**: Banner superior muestra estado de conexión y datos pendientes

#### 💾 Almacenamiento Local
- Visitas y datos de clientes
- Fotos capturadas (almacenadas en base64)
- Coordenadas GPS
- Reportes completados
- Seriales de equipos

#### 🔄 Sincronización Inteligente
- Detección automática de conexión restaurada
- Envío en background de datos pendientes
- Notificación visual al usuario
- Reintentos automáticos en caso de fallo

### 🔐 Permisos Solicitados

La aplicación solicita los siguientes permisos (todos necesarios para su correcto funcionamiento):

- **📍 Ubicación GPS**: Para capturar coordenadas precisas de visitas e instalaciones
- **📷 Cámara**: Para tomar fotos del trabajo realizado
- **📁 Almacenamiento**: Para guardar fotos y datos offline
- **🌐 Internet**: Para sincronizar datos con el servidor
- **🔔 Notificaciones**: Para alertas de sincronización y visitas

## 🛠️ Requisitos

### Para Desarrollo
- Node.js 18 o superior
- Java JDK 17
- Android SDK (API Level 33 o superior)
- Gradle 8.0+

### Para Usuario Final
- Android 8.0 (Oreo) o superior
- 100 MB de espacio libre
- GPS habilitado (recomendado)
- Conexión a internet (para sincronización)

## 📦 Instalación para Desarrollo

### 1. Clonar el repositorio
```bash
git clone <tu-repositorio>
cd whatsapp-chatbot
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Generar iconos de la app
```bash
node generate-icons.js
```

### 4. Sincronizar proyecto de Capacitor
```bash
npx cap sync android
```

### 5. Abrir en Android Studio
```bash
npx cap open android
```

### 6. Compilar y ejecutar
Desde Android Studio:
- Conecta un dispositivo Android o inicia un emulador
- Click en "Run" (▶️)

## 🏗️ Compilación de APK

### Opción 1: Compilación Local

#### APK de Debug (desarrollo)
```bash
cd android
./gradlew assembleDebug
```
La APK estará en: `android/app/build/outputs/apk/debug/app-debug.apk`

#### APK de Release (producción - sin firmar)
```bash
cd android
./gradlew assembleRelease
```
La APK estará en: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

### Opción 2: Compilación con GitHub Actions

La aplicación se compila automáticamente en GitHub cuando:
- ✅ Se hace push a `main`, `master` o `develop`
- ✅ Se crea un tag de versión (ej: `v1.0.0`)
- ✅ Se ejecuta manualmente desde GitHub Actions

#### Configuración de GitHub Actions

1. **Fork o clona el repositorio** en GitHub

2. **Configurar secretos** (si necesitas APK firmada):
   - Ve a: `Settings` → `Secrets and variables` → `Actions`
   - Añade secretos necesarios para firma de APK (opcional)

3. **Ejecutar workflow manualmente**:
   - Ve a `Actions` → `Build Android APK`
   - Click en "Run workflow"

4. **Descargar APK generada**:
   - Al finalizar el build, ve a la sección "Artifacts"
   - Descarga:
     - `solucnet-tecnicos-debug.apk` (para pruebas)
     - `solucnet-tecnicos-release-unsigned.apk` (para publicación)

### Opción 3: Firma de APK para Producción

Para distribuir en Google Play Store, necesitas firmar la APK:

```bash
# 1. Generar keystore (solo una vez)
keytool -genkey -v -keystore android/release.keystore \
  -alias solucnet-key -keyalg RSA -keysize 2048 -validity 10000

# 2. Configurar en android/gradle.properties (no commitear este archivo!)
cat >> android/gradle.properties << EOF
RELEASE_STORE_FILE=release.keystore
RELEASE_STORE_PASSWORD=tu-password-aqui
RELEASE_KEY_ALIAS=solucnet-key
RELEASE_KEY_PASSWORD=tu-password-aqui
EOF

# 3. Actualizar android/app/build.gradle
# (Ya está configurado en el proyecto)

# 4. Compilar APK firmada
cd android
./gradlew assembleRelease
```

La APK firmada estará en: `android/app/build/outputs/apk/release/app-release.apk`

## 🔧 Configuración

### Cambiar URL del Servidor

Editar `capacitor.config.json`:
```json
{
  "server": {
    "url": "https://cliente.solucnet.com:3000"
  }
}
```

### Cambiar Nombre de la App

Editar `android/app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">Tu Nombre Aqui</string>
```

### Cambiar ID de la Aplicación

Editar `capacitor.config.json`:
```json
{
  "appId": "com.tuempresa.tunombre"
}
```

## 📱 Instalación en Dispositivo

### Desde APK (usuarios finales)

1. **Habilitar instalación de fuentes desconocidas**:
   - `Configuración` → `Seguridad` → `Fuentes desconocidas`

2. **Transferir APK al dispositivo**:
   - Por cable USB
   - Por email
   - Por Google Drive/Dropbox
   - Descarga directa desde GitHub Releases

3. **Instalar**:
   - Abrir archivo APK
   - Click en "Instalar"
   - Esperar a que termine
   - Click en "Abrir"

4. **Conceder permisos**:
   - La app solicitará permisos necesarios
   - Aceptar todos los permisos

## 🧪 Pruebas

### Probar Modo Offline

1. Abrir la app y hacer login
2. Cargar algunas visitas
3. Activar "Modo Avión" en el dispositivo
4. Completar una visita (tomar fotos, llenar formulario)
5. Observar el banner "SIN CONEXIÓN - Datos pendientes"
6. Desactivar "Modo Avión"
7. La app detectará conexión y sincronizará automáticamente
8. El banner cambiará a "CONECTADO" brevemente

### Verificar Sincronización

1. Con modo offline activado, completar 2-3 visitas
2. Restaurar conexión
3. Revisar logs del navegador (en desarrollo) o servidor
4. Verificar que los datos aparecen en el dashboard web

## 📊 Estructura del Proyecto

```
whatsapp-chatbot/
├── android/                    # Proyecto Android nativo
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml   # Permisos y configuración
│   │   │   └── res/                  # Recursos (iconos, strings)
│   └── build.gradle           # Configuración de build
├── public/                    # Assets web de la aplicación
│   ├── tecnicos_visitas.html # Página principal
│   ├── tecnicos_visitas.js   # Lógica de la aplicación
│   ├── offline-manager.js    # Sistema de gestión offline
│   └── sw-offline.js         # Service Worker para offline
├── .github/
│   └── workflows/
│       └── build-android.yml # GitHub Actions para compilación
├── capacitor.config.json     # Configuración de Capacitor
├── generate-icons.js         # Script para generar iconos
└── package.json              # Dependencias del proyecto
```

## 🔍 Debugging

### Ver logs de la aplicación

```bash
# Logs en tiempo real
adb logcat | grep SolucNet

# Ver logs de JavaScript
npx cap run android -l
```

### Inspeccionar con Chrome DevTools

1. Conectar dispositivo Android
2. Abrir Chrome en PC
3. Ir a `chrome://inspect`
4. Seleccionar la app
5. Click en "Inspect"

## 🐛 Problemas Comunes

### La app no compila
- Verificar versión de Java (debe ser 17)
- Limpiar build: `cd android && ./gradlew clean`
- Sincronizar: `npx cap sync android`

### Los iconos no aparecen
- Ejecutar: `node generate-icons.js`
- Sincronizar: `npx cap sync android`

### El modo offline no funciona
- Verificar que el Service Worker esté registrado
- Abrir DevTools y revisar "Application" → "Service Workers"
- Limpiar caché del navegador

### No captura GPS
- Verificar permisos de ubicación
- Activar GPS en el dispositivo
- Probar en exterior (mejor señal)

## 📞 Soporte

Para problemas o preguntas:
- Crear un issue en GitHub
- Contactar al equipo de desarrollo

## 📄 Licencia

Propiedad de SolucNet - Todos los derechos reservados

---

**Versión**: 1.0.0
**Última actualización**: Noviembre 2025
