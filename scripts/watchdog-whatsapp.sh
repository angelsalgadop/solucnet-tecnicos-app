#!/bin/bash
#################################################
# WATCHDOG AUTOMÁTICO - WhatsApp Bot SolucNet
# Monitorea la conexión de WhatsApp y reinicia
# automáticamente si se detecta desconexión
#################################################

LOG_FILE="/root/whatsapp-chatbot/logs/watchdog.log"
MAX_LOG_SIZE=10485760  # 10MB

# Crear directorio de logs si no existe
mkdir -p /root/whatsapp-chatbot/logs

# Función para logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Función para limpiar log si es muy grande
cleanup_log() {
    if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE") -gt $MAX_LOG_SIZE ]; then
        log "🧹 Log muy grande, limpiando..."
        tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp"
        mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
}

# Función para verificar conexión de WhatsApp
check_whatsapp_connection() {
    # Verificar si el proceso PM2 está corriendo
    if ! pm2 list | grep -q "solucnet-bot.*online"; then
        log "❌ Bot no está online en PM2"
        return 1
    fi

    # Verificar logs recientes buscando señales de desconexión
    RECENT_LOGS=$(pm2 logs solucnet-bot --lines 50 --nostream 2>&1 | tail -50)

    # Buscar mensajes de desconexión
    if echo "$RECENT_LOGS" | grep -qi "disconnected\|logged out\|session closed"; then
        log "❌ Desconexión detectada en logs"
        return 1
    fi

    # Buscar errores críticos
    if echo "$RECENT_LOGS" | grep -qi "Protocol error.*Session closed\|Execution context was destroyed"; then
        log "❌ Error crítico de sesión detectado"
        return 1
    fi

    # Verificar si el servidor responde (timeout corto)
    if ! timeout 5 curl -k -s https://localhost:3000 >/dev/null 2>&1; then
        log "⚠️ Servidor no responde"
        return 1
    fi

    log "✅ WhatsApp bot funcionando correctamente"
    return 0
}

# Función para reiniciar bot
restart_bot() {
    log "🔄 Reiniciando bot de WhatsApp..."

    pm2 restart solucnet-bot

    # Esperar a que se inicialice
    sleep 15

    # Verificar que se reinició correctamente
    if pm2 list | grep -q "solucnet-bot.*online"; then
        log "✅ Bot reiniciado exitosamente"

        # Esperar a que WhatsApp se conecte
        for i in {1..12}; do
            sleep 5
            if pm2 logs solucnet-bot --lines 20 --nostream 2>&1 | grep -q "WhatsApp conectado\|ready\|authenticated"; then
                log "✅ WhatsApp reconectado exitosamente"
                return 0
            fi
        done

        log "⚠️ Bot reiniciado pero WhatsApp aún no se conectó"
        return 1
    else
        log "❌ Error reiniciando bot"
        return 1
    fi
}

# Función principal
main() {
    log "🐕 Watchdog iniciando verificación..."

    cleanup_log

    if ! check_whatsapp_connection; then
        log "🚨 Problema detectado, iniciando reinicio automático..."
        restart_bot

        if [ $? -eq 0 ]; then
            log "✅ Recuperación exitosa"
        else
            log "❌ Fallo en recuperación, se requiere intervención manual"
        fi
    fi

    log "🐕 Watchdog completó verificación"
}

# Ejecutar
main
