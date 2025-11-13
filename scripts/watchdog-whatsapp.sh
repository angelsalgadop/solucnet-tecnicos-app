#!/bin/bash
#################################################
# WATCHDOG MEJORADO - WhatsApp Bot SolucNet
# Monitorea conexión, memoria y procesos Chrome
# Previene desconexiones automáticamente
#################################################

LOG_FILE="/root/whatsapp-chatbot/logs/watchdog.log"
MAX_LOG_SIZE=10485760  # 10MB
MIN_FREE_MEMORY_MB=400  # Mínimo 400MB libres
MAX_CHROME_PROCESSES=15  # Máximo procesos Chrome permitidos

# Crear directorio de logs si no existe
mkdir -p /root/whatsapp-chatbot/logs

# Función para logging con colores para terminal
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Función para limpiar log si es muy grande
cleanup_log() {
    if [ -f "$LOG_FILE" ]; then
        LOG_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo "0")
        if [ "$LOG_SIZE" -gt "$MAX_LOG_SIZE" ]; then
            log "🧹 Log muy grande ($LOG_SIZE bytes), limpiando..."
            tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp"
            mv "$LOG_FILE.tmp" "$LOG_FILE"
        fi
    fi
}

# 1. VERIFICAR MEMORIA DISPONIBLE
check_memory() {
    FREE_MEMORY=$(free -m | awk '/^Mem:/ {print $7}')
    log "💾 Memoria disponible: ${FREE_MEMORY}MB"

    if [ "$FREE_MEMORY" -lt "$MIN_FREE_MEMORY_MB" ]; then
        log "⚠️ Memoria baja detectada (${FREE_MEMORY}MB < ${MIN_FREE_MEMORY_MB}MB)"
        return 1
    fi

    return 0
}

# 2. LIMPIAR PROCESOS CHROME HUÉRFANOS
cleanup_chrome_orphans() {
    log "🧹 Verificando procesos Chrome..."

    # Contar procesos Chrome
    CHROME_COUNT=$(ps aux | grep -E "chrome|chromium" | grep -v grep | wc -l)
    log "📊 Procesos Chrome detectados: $CHROME_COUNT"

    if [ "$CHROME_COUNT" -gt "$MAX_CHROME_PROCESSES" ]; then
        log "⚠️ Demasiados procesos Chrome ($CHROME_COUNT > $MAX_CHROME_PROCESSES)"
        log "🔄 Ejecutando limpieza de Chrome..."

        # Ejecutar script de limpieza si existe
        if [ -f "/root/whatsapp-chatbot/scripts/limpiar-chrome-huerfanos.sh" ]; then
            bash /root/whatsapp-chatbot/scripts/limpiar-chrome-huerfanos.sh >> "$LOG_FILE" 2>&1
            log "✅ Limpieza de Chrome completada"
        else
            # Limpieza manual
            pkill -f "chrome.*--headless" 2>/dev/null
            sleep 2
            log "✅ Procesos Chrome headless terminados"
        fi

        return 1  # Indicar que se necesitó limpieza
    fi

    return 0
}

# 3. VERIFICAR CONEXIÓN ACTIVA DE WHATSAPP
check_whatsapp_connection() {
    # Verificar si el proceso PM2 está corriendo
    if ! pm2 list | grep -q "solucnet-bot.*online"; then
        log "❌ Bot no está online en PM2"
        return 1
    fi

    # Verificar logs recientes buscando señales de desconexión
    RECENT_LOGS=$(pm2 logs solucnet-bot --lines 100 --nostream 2>&1)

    # Buscar mensajes de desconexión
    if echo "$RECENT_LOGS" | grep -qi "disconnected\|logged out\|session closed\|browser has disconnected"; then
        log "❌ Desconexión detectada en logs"
        return 1
    fi

    # Buscar errores críticos de navegador
    if echo "$RECENT_LOGS" | grep -qi "Protocol error.*Session closed\|Execution context was destroyed\|Navigation failed"; then
        log "❌ Error crítico de navegador detectado"
        return 1
    fi

    # Buscar conflictos de sesión
    if echo "$RECENT_LOGS" | grep -qi "conflict\|otro dispositivo"; then
        log "❌ Conflicto de sesión detectado (otro dispositivo)"
        return 1
    fi

    # Verificar si el servidor responde
    if ! timeout 5 curl -k -s https://localhost:3000 >/dev/null 2>&1; then
        log "⚠️ Servidor no responde en puerto 3000"
        return 1
    fi

    # Verificar que hay actividad reciente (últimos 5 minutos)
    LAST_LOG_TIME=$(pm2 logs solucnet-bot --lines 1 --nostream 2>&1 | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}.*[0-9]{2}:[0-9]{2}:[0-9]{2}' | head -1)

    if [ -n "$LAST_LOG_TIME" ]; then
        LAST_LOG_EPOCH=$(date -d "$LAST_LOG_TIME" +%s 2>/dev/null || echo "0")
        CURRENT_EPOCH=$(date +%s)
        TIME_DIFF=$((CURRENT_EPOCH - LAST_LOG_EPOCH))

        if [ "$TIME_DIFF" -gt 300 ]; then
            log "⚠️ Sin actividad en logs por ${TIME_DIFF}s (>5min)"
            return 1
        fi
    fi

    log "✅ WhatsApp bot funcionando correctamente"
    return 0
}

# 4. REINICIO INTELIGENTE CON LIMPIEZA
restart_bot() {
    log "🔄 Iniciando reinicio inteligente del bot..."

    # Paso 1: Limpiar memoria caché del sistema
    log "💾 Limpiando caché del sistema..."
    sync
    echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || log "⚠️ No se pudo limpiar caché (requiere sudo)"

    # Paso 2: Limpiar procesos Chrome completamente
    log "🧹 Limpiando todos los procesos Chrome..."
    pkill -9 -f "chrome" 2>/dev/null
    pkill -9 -f "chromium" 2>/dev/null
    sleep 3

    # Paso 3: Limpiar caché de WhatsApp Web si existe
    CACHE_DIR="/root/.cache/puppeteer"
    if [ -d "$CACHE_DIR" ]; then
        log "🗑️ Limpiando caché de Puppeteer..."
        find "$CACHE_DIR" -type f -name "*.log" -delete 2>/dev/null
        find "$CACHE_DIR" -type f -mtime +7 -delete 2>/dev/null
    fi

    # Paso 4: Reiniciar PM2
    log "🔄 Reiniciando PM2 bot..."
    pm2 restart solucnet-bot

    # Esperar inicialización
    sleep 20

    # Paso 5: Verificar reinicio exitoso
    if pm2 list | grep -q "solucnet-bot.*online"; then
        log "✅ Bot reiniciado exitosamente"

        # Esperar conexión de WhatsApp (máximo 2 minutos)
        log "⏳ Esperando conexión de WhatsApp..."
        for i in {1..24}; do
            sleep 5

            CURRENT_LOGS=$(pm2 logs solucnet-bot --lines 30 --nostream 2>&1)

            if echo "$CURRENT_LOGS" | grep -q "WhatsApp conectado\|✅.*conectado\|ready.*QR"; then
                log "✅ WhatsApp reconectado exitosamente en ${i}x5=${$((i*5))}s"

                # Verificar memoria final
                FREE_MEM_FINAL=$(free -m | awk '/^Mem:/ {print $7}')
                log "💾 Memoria disponible después del reinicio: ${FREE_MEM_FINAL}MB"

                return 0
            fi
        done

        log "⚠️ Bot reiniciado pero WhatsApp no se conectó en 2 minutos"
        return 1
    else
        log "❌ Error reiniciando bot con PM2"
        return 1
    fi
}

# FUNCIÓN PRINCIPAL
main() {
    log "🐕 ========================================="
    log "🐕 WATCHDOG MEJORADO - Iniciando verificación"
    log "🐕 ========================================="

    cleanup_log

    NEED_RESTART=0
    RESTART_REASON=""

    # Verificación 1: Memoria
    if ! check_memory; then
        NEED_RESTART=1
        RESTART_REASON="Memoria baja"
    fi

    # Verificación 2: Procesos Chrome
    if ! cleanup_chrome_orphans; then
        log "⚠️ Se detectaron problemas con Chrome"
        # No forzar reinicio inmediato, solo si también hay otros problemas
    fi

    # Verificación 3: Conexión WhatsApp
    if ! check_whatsapp_connection; then
        NEED_RESTART=1
        if [ -z "$RESTART_REASON" ]; then
            RESTART_REASON="Desconexión de WhatsApp"
        else
            RESTART_REASON="$RESTART_REASON + Desconexión WhatsApp"
        fi
    fi

    # Ejecutar reinicio si es necesario
    if [ "$NEED_RESTART" -eq 1 ]; then
        log "🚨 PROBLEMA DETECTADO: $RESTART_REASON"
        log "🔄 Iniciando recuperación automática..."

        restart_bot

        if [ $? -eq 0 ]; then
            log "✅ ========================================="
            log "✅ RECUPERACIÓN EXITOSA"
            log "✅ Razón: $RESTART_REASON"
            log "✅ ========================================="
        else
            log "❌ ========================================="
            log "❌ FALLO EN RECUPERACIÓN"
            log "❌ Razón: $RESTART_REASON"
            log "❌ Se requiere intervención manual"
            log "❌ ========================================="
        fi
    else
        log "✅ Sistema estable - No se requiere acción"
    fi

    log "🐕 Watchdog completó verificación"
    log ""
}

# Ejecutar
main
