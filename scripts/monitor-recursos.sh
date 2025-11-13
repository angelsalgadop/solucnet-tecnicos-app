#!/bin/bash
#################################################
# MONITOR DE RECURSOS - WhatsApp Bot SolucNet
# Monitorea CPU y memoria, reinicia si excede
# límites para prevenir cuelgues
#################################################

LOG_FILE="/root/whatsapp-chatbot/logs/monitor-recursos.log"
MAX_LOG_SIZE=10485760  # 10MB

# Límites (%)
CPU_LIMIT=95
MEMORY_LIMIT=85

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

# Función para obtener uso de CPU
get_cpu_usage() {
    # Obtener CPU del proceso PM2
    CPU=$(pm2 jlist | jq -r '.[] | select(.name=="solucnet-bot") | .monit.cpu' 2>/dev/null)
    if [ -z "$CPU" ] || [ "$CPU" == "null" ]; then
        echo "0"
    else
        echo "$CPU"
    fi
}

# Función para obtener uso de memoria (%)
get_memory_usage() {
    # Obtener memoria del sistema
    MEM_TOTAL=$(free | grep Mem | awk '{print $2}')
    MEM_USED=$(free | grep Mem | awk '{print $3}')

    if [ "$MEM_TOTAL" -gt 0 ]; then
        MEM_PERCENT=$(awk "BEGIN {printf \"%.0f\", ($MEM_USED/$MEM_TOTAL)*100}")
        echo "$MEM_PERCENT"
    else
        echo "0"
    fi
}

# Función para reiniciar bot
restart_bot_for_resources() {
    log "🔄 Reiniciando bot por exceso de recursos..."

    pm2 restart solucnet-bot

    sleep 10

    if pm2 list | grep -q "solucnet-bot.*online"; then
        log "✅ Bot reiniciado exitosamente"
        return 0
    else
        log "❌ Error reiniciando bot"
        return 1
    fi
}

# Función principal
main() {
    cleanup_log

    CPU_USAGE=$(get_cpu_usage)
    MEM_USAGE=$(get_memory_usage)

    log "📊 Recursos: CPU=$CPU_USAGE% MEM=$MEM_USAGE%"

    # Verificar si CPU está muy alta por más de 1 minuto
    if [ $(echo "$CPU_USAGE > $CPU_LIMIT" | bc -l 2>/dev/null || echo "0") -eq 1 ]; then
        log "⚠️ CPU alta detectada: $CPU_USAGE%"

        # Esperar 30 segundos y verificar nuevamente
        sleep 30
        CPU_USAGE_2=$(get_cpu_usage)

        if [ $(echo "$CPU_USAGE_2 > $CPU_LIMIT" | bc -l 2>/dev/null || echo "0") -eq 1 ]; then
            log "🚨 CPU sostenida alta: $CPU_USAGE_2% - Reiniciando..."
            restart_bot_for_resources
        else
            log "✅ CPU se normalizó: $CPU_USAGE_2%"
        fi
    fi

    # Verificar si memoria está muy alta
    if [ "$MEM_USAGE" -gt "$MEMORY_LIMIT" ]; then
        log "⚠️ Memoria alta detectada: $MEM_USAGE%"

        # Verificar si hay memoria swap siendo usada significativamente
        SWAP_USED=$(free | grep Swap | awk '{print $3}')
        SWAP_TOTAL=$(free | grep Swap | awk '{print $2}')

        if [ "$SWAP_TOTAL" -gt 0 ]; then
            SWAP_PERCENT=$(awk "BEGIN {printf \"%.0f\", ($SWAP_USED/$SWAP_TOTAL)*100}")

            if [ "$SWAP_PERCENT" -gt 20 ]; then
                log "🚨 Swap alto ($SWAP_PERCENT%) - Limpiando memoria..."
                sync
                echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || log "⚠️ No se pudo limpiar caché (requiere root)"
            fi
        fi
    fi

    log "✅ Monitor completó verificación"
}

# Ejecutar
main
