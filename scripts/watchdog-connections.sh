#!/bin/bash

# Watchdog para monitorear conexiones CLOSE-WAIT y reiniciar automáticamente
# Previene que el servidor se bloquee por acumulación de conexiones huérfanas

LOG_FILE="/root/whatsapp-chatbot/logs/watchdog-connections.log"
MAX_CLOSE_WAIT=10  # Umbral de conexiones CLOSE-WAIT antes de reiniciar
PORT=3000

# Función para logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Contar conexiones CLOSE-WAIT
CLOSE_WAIT_COUNT=$(ss -tnp 2>/dev/null | grep ":$PORT" | grep -c "CLOSE-WAIT")
# Asegurar que sea un número válido
if ! [[ "$CLOSE_WAIT_COUNT" =~ ^[0-9]+$ ]]; then
    CLOSE_WAIT_COUNT=0
fi

log "🔍 Conexiones CLOSE-WAIT detectadas: $CLOSE_WAIT_COUNT"

# Si hay demasiadas conexiones CLOSE-WAIT, reiniciar
if [ "$CLOSE_WAIT_COUNT" -ge "$MAX_CLOSE_WAIT" ]; then
    log "⚠️ ALERTA: $CLOSE_WAIT_COUNT conexiones CLOSE-WAIT (umbral: $MAX_CLOSE_WAIT)"
    log "🔄 Reiniciando servidor para limpiar conexiones..."

    # Reiniciar PM2
    pm2 restart solucnet-bot --update-env

    # Esperar que se estabilice
    sleep 10

    # Verificar que reinició correctamente
    NEW_COUNT=$(ss -tnp 2>/dev/null | grep ":$PORT" | grep -c "CLOSE-WAIT")
    if ! [[ "$NEW_COUNT" =~ ^[0-9]+$ ]]; then
        NEW_COUNT=0
    fi

    if [ "$NEW_COUNT" -lt "$CLOSE_WAIT_COUNT" ]; then
        log "✅ Servidor reiniciado exitosamente. Conexiones CLOSE-WAIT ahora: $NEW_COUNT"
    else
        log "❌ ERROR: El reinicio no resolvió el problema. Conexiones actuales: $NEW_COUNT"
    fi
else
    log "✅ Estado normal: $CLOSE_WAIT_COUNT conexiones CLOSE-WAIT"
fi

# Limpiar logs antiguos (mantener solo últimos 7 días)
find /root/whatsapp-chatbot/logs/watchdog-connections.log -type f -mtime +7 -delete 2>/dev/null

exit 0
