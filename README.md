# 📱 SolucNet Técnicos - App Móvil Android

Aplicación móvil para técnicos de SolucNet con **modo offline completo**.

![Version](https://img.shields.io/badge/version-1.0.0-green)
![Platform](https://img.shields.io/badge/platform-Android-blue)
![Status](https://img.shields.io/badge/status-ready-success)

---

## 🚀 Compilar APK en 3 Pasos

### 1️⃣ Descargar el Código

```bash
git clone https://github.com/angelsalgadop/solucnet-tecnicos-app.git
cd solucnet-tecnicos-app
```

O descarga el ZIP: [Download ZIP](https://github.com/angelsalgadop/solucnet-tecnicos-app/archive/refs/heads/main.zip)

### 2️⃣ Abrir en Android Studio

1. Abrir **Android Studio**
2. **File → Open**
3. Seleccionar la carpeta `android/` (importante: la carpeta android, no la raíz)
4. Esperar a que Gradle sincronice (2-5 minutos la primera vez)

### 3️⃣ Compilar

**Opción A**: Desde el menú
- **Build → Build Bundle(s) / APK(s) → Build APK(s)**

**Opción B**: Desde terminal en Android Studio
```bash
./gradlew assembleDebug
```

**Tu APK estará en**: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📥 Guía Completa Paso a Paso

**Lee**: [COMPILAR_CON_ANDROID_STUDIO.md](./COMPILAR_CON_ANDROID_STUDIO.md)

Incluye:
- ✅ Instalación de Android Studio
- ✅ Solución de problemas comunes
- ✅ Cómo instalar en teléfono
- ✅ Compilar versión de producción
- ✅ Screenshots y tips

---

## ✨ Funcionalidades

### 📴 Modo Offline Completo
- ✅ Trabaja sin internet
- ✅ Guarda visitas localmente
- ✅ Almacena fotos offline
- ✅ Sincronización automática cuando se restaura conexión
- ✅ Indicador visual de estado de red

### 📱 Características Principales
- ✅ Login con sesión persistente
- ✅ Listado de visitas asignadas
- ✅ Completar visitas técnicas
- ✅ Captura de fotos (cámara/galería)
- ✅ GPS de alta precisión (<9m)
- ✅ Escáner de seriales de equipos
- ✅ Mapa interactivo de clientes
- ✅ Filtros por localidad y estado
- ✅ Notificaciones
- ✅ Creación de cajas NAP

---

## 📱 Instalar en Android

### Via Cable USB
1. Habilitar "Depuración USB" en el teléfono
2. Conectar teléfono a la PC
3. En Android Studio: **Run (▶️)**

### Via APK Manual
1. Copiar `app-debug.apk` al teléfono
2. Abrir el archivo
3. Permitir "Fuentes desconocidas"
4. Instalar

---

## 🔧 Requisitos

### Para Compilar
- Android Studio (última versión)
- Java JDK 17
- Android SDK (API 33+)
- 4 GB RAM mínimo

### Para Ejecutar
- Android 8.0 (Oreo) o superior
- 100 MB espacio libre
- GPS (recomendado)
- Cámara

---

## 📚 Documentación

- 📖 [Guía de Compilación Completa](./COMPILAR_CON_ANDROID_STUDIO.md)
- 📖 [Guía Rápida](./GUIA_RAPIDA_COMPILACION.md)
- 📖 [Documentación Técnica](./MOVIL_APP_README.md)

---

## 🏗️ Estructura del Proyecto

```
solucnet-tecnicos-app/
├── android/                    # Proyecto Android nativo
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   └── res/           # Iconos y recursos
│   └── build.gradle
├── public/                    # Assets web
│   ├── tecnicos_visitas.html # Página principal
│   ├── tecnicos_visitas.js   # Lógica de la app
│   ├── offline-manager.js    # Sistema offline
│   └── sw-offline.js         # Service Worker
├── capacitor.config.json     # Config de Capacitor
└── COMPILAR_CON_ANDROID_STUDIO.md
```

---

## 🐛 Solución de Problemas

### Gradle no sincroniza
```bash
# En Android Studio
File → Invalidate Caches / Restart
```

### Error de memoria
Editar `android/gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx4096m
```

### SDK no encontrado
- Android Studio mostrará banner amarillo
- Click en "Install missing SDK packages"

---

## 📞 Soporte

- **Issues**: [GitHub Issues](https://github.com/angelsalgadop/solucnet-tecnicos-app/issues)
- **Email**: soporte@solucnet.com

---

## 📄 Licencia

Propiedad de SolucNet - Todos los derechos reservados

---

## 🎯 Para Desarrolladores

### Hacer Cambios

1. Modificar archivos en `public/` o `android/`
2. Sincronizar: `npx cap sync android`
3. Recompilar APK

### Actualizar Iconos

```bash
node generate-icons.js
npx cap sync android
```

### Variables de Entorno

La app se conecta a: `https://cliente.solucnet.com:3000`

Para cambiar, editar en `public/tecnicos_visitas.js`

---

**Versión**: 1.0.0
**Última actualización**: Noviembre 2025
**Desarrollado para**: SolucNet ISP
