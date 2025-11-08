// Sistema de logging detallado para depuración

(function() {
    // Guardar logs en localStorage
    const MAX_LOGS = 100;

    function guardarLog(tipo, mensaje, datos = null) {
        try {
            const logs = JSON.parse(localStorage.getItem('debug_logs') || '[]');

            const nuevoLog = {
                timestamp: new Date().toISOString(),
                tipo: tipo,
                mensaje: mensaje,
                datos: datos,
                url: window.location.href
            };

            logs.push(nuevoLog);

            // Mantener solo los últimos MAX_LOGS
            if (logs.length > MAX_LOGS) {
                logs.shift();
            }

            localStorage.setItem('debug_logs', JSON.stringify(logs));
        } catch (error) {
            console.error('Error guardando log:', error);
        }
    }

    // Sobrescribir console.log
    const originalLog = console.log;
    console.log = function(...args) {
        guardarLog('log', args.join(' '), args);
        originalLog.apply(console, args);
    };

    // Sobrescribir console.error
    const originalError = console.error;
    console.error = function(...args) {
        guardarLog('error', args.join(' '), args);
        localStorage.setItem('ultimo_error', JSON.stringify({
            mensaje: args.join(' '),
            timestamp: new Date().toISOString()
        }));
        originalError.apply(console, args);
    };

    // Sobrescribir console.warn
    const originalWarn = console.warn;
    console.warn = function(...args) {
        guardarLog('warn', args.join(' '), args);
        originalWarn.apply(console, args);
    };

    // Capturar errores no manejados
    window.addEventListener('error', function(event) {
        guardarLog('error_no_manejado', event.message, {
            archivo: event.filename,
            linea: event.lineno,
            columna: event.colno,
            error: event.error ? event.error.stack : null
        });
    });

    // Capturar promesas rechazadas
    window.addEventListener('unhandledrejection', function(event) {
        guardarLog('promesa_rechazada', event.reason, {
            promesa: event.promise
        });
    });

    // Función global para ver logs
    window.verDebugLogs = function() {
        const logs = JSON.parse(localStorage.getItem('debug_logs') || '[]');
        console.log('=== DEBUG LOGS ===');
        console.log('Total de logs:', logs.length);
        console.table(logs);
        return logs;
    };

    // Función para limpiar logs
    window.limpiarDebugLogs = function() {
        localStorage.removeItem('debug_logs');
        localStorage.removeItem('ultimo_error');
        console.log('✅ Logs limpiados');
    };

    // Función para exportar logs
    window.exportarDebugLogs = function() {
        const logs = JSON.parse(localStorage.getItem('debug_logs') || '[]');
        const texto = JSON.stringify(logs, null, 2);

        // Crear blob y descargar
        const blob = new Blob([texto], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'debug_logs_' + Date.now() + '.json';
        a.click();

        console.log('✅ Logs exportados');
    };

    // Log inicial
    guardarLog('info', 'Sistema de debug iniciado');

    console.log('🔍 Debug Logger activo. Comandos disponibles:');
    console.log('  verDebugLogs() - Ver todos los logs');
    console.log('  limpiarDebugLogs() - Limpiar logs');
    console.log('  exportarDebugLogs() - Descargar logs como JSON');
})();
