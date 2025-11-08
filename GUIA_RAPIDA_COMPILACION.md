# 🚀 Guía Rápida de Compilación - SolucNet Técnicos

## ✅ Pasos para Compilar la APK

### Opción 1: Compilación Automática (Recomendada)

```bash
# Ejecutar script automático
./build-apk.sh debug    # Para versión de prueba
./build-apk.sh release  # Para versión de producción
```

La APK estará en:
- **Debug**: `android/app/build/outputs/apk/debug/app-debug.apk`
- **Release**: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

---

### Opción 2: GitHub Actions (Sin necesidad de compilar local)

#### Pasos:

1. **Subir código a GitHub**

   ```bash
   git init
   git add .
   git commit -m "App móvil SolucNet Técnicos lista"
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

2. **GitHub Actions se ejecutará automáticamente**
   - Ve a tu repositorio en GitHub
   - Click en la pestaña "Actions"
   - Verás el workflow "Build Android APK" ejecutándose

3. **Descargar APK compilada**
   - Espera a que el build termine (5-10 minutos)
   - En la página del workflow, ve a "Artifacts"
   - Descarga:
     - `solucnet-tecnicos-debug.apk`
     - `solucnet-tecnicos-release-unsigned.apk`

4. **Crear Release (opcional)**
   ```bash
   # Crear un tag de versión
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions creará automáticamente una Release con las APKs.

---

### Opción 3: Compilación Manual

```bash
# 1. Instalar dependencias
npm install

# 2. Generar iconos
node generate-icons.js

# 3. Sincronizar Capacitor
npx cap sync android

# 4. Compilar
cd android
./gradlew assembleDebug      # Para debug
./gradlew assembleRelease    # Para release
cd ..
```

---

## 📥 Instalación en Dispositivo Android

### Método 1: Vía ADB (desarrollo)

```bash
# Conectar dispositivo por USB y habilitar "Depuración USB"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Método 2: Transferir APK (usuarios finales)

1. Copiar APK al teléfono
2. Abrir archivo APK
3. Permitir "Instalar desde fuentes desconocidas"
4. Click en "Instalar"

---

## 🔐 Credenciales de GitHub

Para que te ayude a configurar GitHub Actions, necesito:

1. **Usuario de GitHub**: `_______________`
2. **Token de Acceso Personal** (con permisos `repo` y `workflow`):
   - Ir a: https://github.com/settings/tokens
   - Click en "Generate new token (classic)"
   - Seleccionar scopes: `repo`, `workflow`
   - Copiar el token: `_______________`

Una vez los tengas, los configuraré para que puedas compilar automáticamente.

---

## 📋 Checklist Pre-Compilación

- [ ] Node.js instalado (v18+)
- [ ] Java JDK 17 instalado
- [ ] Dependencias instaladas (`npm install`)
- [ ] Iconos generados (`node generate-icons.js`)
- [ ] Capacitor sincronizado (`npx cap sync android`)

---

## 🐛 Solución de Problemas

### Error: "Java version not found"
```bash
# Instalar Java 17
sudo apt install openjdk-17-jdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

### Error: "Gradle build failed"
```bash
cd android
./gradlew clean
cd ..
npx cap sync android
./build-apk.sh debug
```

### Error: "Permission denied: gradlew"
```bash
chmod +x android/gradlew
```

---

## 📱 Funcionalidades de la App

✅ **Completadas al 100%**

- ✅ Login con sesión persistente
- ✅ Modo offline completo
- ✅ Sincronización automática
- ✅ Captura de fotos (cámara/galería)
- ✅ GPS de alta precisión
- ✅ Escáner de seriales
- ✅ Mapas de clientes
- ✅ Notificaciones
- ✅ Todos los permisos configurados
- ✅ Logo e iconos personalizados
- ✅ GitHub Actions para build automático

---

## 🎯 Próximos Pasos

1. ✅ **Compilar primera APK**
   ```bash
   ./build-apk.sh debug
   ```

2. ✅ **Probar en dispositivo**
   - Instalar APK en un teléfono Android
   - Hacer login
   - Probar modo offline

3. ✅ **Subir a GitHub**
   - Crear repositorio
   - Push del código
   - Configurar Actions

4. ✅ **Distribuir**
   - Compartir APK con técnicos
   - (Opcional) Publicar en Google Play Store

---

**¿Listo para compilar?** Ejecuta:

```bash
./build-apk.sh debug
```

Y en 5 minutos tendrás tu APK lista! 🚀
