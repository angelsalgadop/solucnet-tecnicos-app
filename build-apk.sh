#!/bin/bash

# Script para compilar APK de SolucNet Técnicos
# Uso: ./build-apk.sh [debug|release]

set -e  # Detener en caso de error

# Colores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Función para imprimir mensajes
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Banner
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  SolucNet Técnicos - Build APK      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# Determinar tipo de build
BUILD_TYPE=${1:-debug}

if [ "$BUILD_TYPE" != "debug" ] && [ "$BUILD_TYPE" != "release" ]; then
    print_error "Tipo de build inválido. Usa: debug o release"
    exit 1
fi

print_info "Tipo de build: $BUILD_TYPE"
echo ""

# Paso 1: Verificar dependencias
print_info "Verificando dependencias..."

if ! command -v node &> /dev/null; then
    print_error "Node.js no está instalado"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm no está instalado"
    exit 1
fi

if ! command -v java &> /dev/null; then
    print_error "Java no está instalado"
    exit 1
fi

print_success "Dependencias verificadas"
echo ""

# Paso 2: Instalar dependencias de Node
print_info "Instalando dependencias de Node.js..."
npm install --silent
print_success "Dependencias de Node.js instaladas"
echo ""

# Paso 3: Generar iconos
print_info "Generando iconos de la aplicación..."
node generate-icons.js
print_success "Iconos generados"
echo ""

# Paso 4: Sincronizar Capacitor
print_info "Sincronizando proyecto de Capacitor..."
npx cap sync android
print_success "Proyecto sincronizado"
echo ""

# Paso 5: Dar permisos a gradlew
print_info "Configurando permisos de Gradle..."
chmod +x android/gradlew
print_success "Permisos configurados"
echo ""

# Paso 6: Compilar APK
print_info "Compilando APK $BUILD_TYPE..."
echo ""

cd android

if [ "$BUILD_TYPE" = "debug" ]; then
    ./gradlew assembleDebug --no-daemon
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
else
    ./gradlew assembleRelease --no-daemon

    # Determinar si la APK está firmada o no
    if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
        APK_PATH="app/build/outputs/apk/release/app-release.apk"
    else
        APK_PATH="app/build/outputs/apk/release/app-release-unsigned.apk"
    fi
fi

cd ..

echo ""
print_success "APK compilada exitosamente!"
echo ""

# Mostrar información del APK
print_info "Información del APK:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Tipo: $BUILD_TYPE"
echo "  Ruta: android/$APK_PATH"

# Obtener tamaño del APK
if [ -f "android/$APK_PATH" ]; then
    APK_SIZE=$(du -h "android/$APK_PATH" | cut -f1)
    echo "  Tamaño: $APK_SIZE"

    # Calcular hash
    APK_HASH=$(md5sum "android/$APK_PATH" | cut -d' ' -f1)
    echo "  MD5: $APK_HASH"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Instrucciones de instalación
if [ "$BUILD_TYPE" = "debug" ]; then
    print_info "Para instalar en un dispositivo:"
    echo "  adb install -r android/$APK_PATH"
    echo ""
elif [ "$BUILD_TYPE" = "release" ] && [[ "$APK_PATH" == *"unsigned"* ]]; then
    print_warning "La APK no está firmada. Para producción, debes firmarla."
    echo ""
    print_info "Para firmar la APK, consulta: MOVIL_APP_README.md"
    echo ""
fi

print_success "¡Build completado!"
echo ""
