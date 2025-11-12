// Manejadores globales de errores para evitar cierres inesperados
process.on('uncaughtException', (error) => {
    console.error('❌ [UNCAUGHT EXCEPTION]', error);
    console.error('Stack:', error.stack);
    // No hacer exit, dejar que el proceso continúe
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [UNHANDLED REJECTION]', reason);
    console.error('Promise:', promise);
    // No hacer exit, dejar que el proceso continúe
});

// Configurar variables de entorno ANTES de importar db.js
process.env.DB_SYSTEM_HOST = 'localhost';
process.env.DB_SYSTEM_USER = 'debian-sys-maint';
process.env.DB_SYSTEM_PASSWORD = 'IOHcXunF7795fMRI';
process.env.DB_SYSTEM_DATABASE = 'solucnet_auth_system';

// Ahora importar db.js después de configurar las variables de entorno
const fs = require('fs');
const https = require('https');
const http = require('http');
const express = require('express');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createProxyMiddleware } = require('http-proxy-middleware');
const performanceMonitor = require('./monitor_performance');
const { Server } = require('socket.io');
const {
    consultarCliente,
    consultarClientePorTelefono,
    buscarClientesConSerial,
    crearSoporte,
    inicializarSistema,
    buscarUsuario,
    crearToken,
    verificarToken,
    verificarTokenEterno,
    cerrarSesion,
    validarConexionBD,
    agregarNumeroOmitido,
    obtenerNumerosOmitidosActivos,
    obtenerNumerosOmitidosInactivos,
    obtenerTodosLosNumerosOmitidos,
    estaNumeroOmitido,
    eliminarNumeroOmitido,
    obtenerUsuarios,
    crearUsuario,
    eliminarUsuario,
    actualizarUsuario,
    registrarLogAPI,
    obtenerLogsAPI,
    limpiarLogsAPI,
    // Funciones de cola de mensajes API
    inicializarColaMensajesAPI,
    agregarMensajeAColaBD,
    obtenerMensajesPendientesBD,
    marcarMensajeComoEnviadoBD,
    marcarMensajeComoErrorBD,
    incrementarIntentoBD,
    marcarMensajeComoDescartadoBD
} = require('./db.js');
const multer = require('multer');
const path = require('path');
const mysql = require('mysql2/promise');

// ===== POOL DE CONEXIONES MYSQL GLOBAL =====
// Usar pool en vez de conexiones individuales para evitar "Too many connections"
const dbPool = mysql.createPool({
    host: process.env.DB_SYSTEM_HOST,
    user: process.env.DB_SYSTEM_USER,
    password: process.env.DB_SYSTEM_PASSWORD,
    database: process.env.DB_SYSTEM_DATABASE,
    waitForConnections: true,
    connectionLimit: 10, // Máximo 10 conexiones concurrentes
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Importar rutas del historial de chat
const chatHistoryRoutes = require('./chat-history-routes');

// Importar funciones para asignar equipos desde visitas
const { asignarEquipoDesdeVisita, verificarSerialEquipo } = require('./asignar_equipo_desde_visita');

let clienteIniciando = false;
let ultimoIntento = 0;
const COOLDOWN_INICIAL = 5000; // 5 segundos entre intentos
let targetClosedFailures = 0; // Contador de fallos "Target closed"
const MAX_TARGET_CLOSED_FAILURES = 3; // Máximo de fallos antes de limpiar sesión

// ===== SISTEMA DE HEALTH CHECK DEL NAVEGADOR =====
const browserHealthCheck = {
    lastCheck: Date.now(),
    checkInterval: 120000, // Verificar cada 120 segundos (reducir sobrecarga)
    consecutiveFailures: 0,
    maxFailures: 3, // Reiniciar después de 3 fallas consecutivas (6 minutos) - REDUCIDO para detectar crashes más rápido
    zombieStateDetected: false,
    sessionClosedErrors: 0, // Contador específico para errores "Session closed"
    maxSessionClosedErrors: 2, // Reiniciar inmediatamente después de 2 errores "Session closed" consecutivos
    lastSuccessfulOperation: Date.now()
};

// Función para verificar si el navegador Puppeteer está vivo
async function verificarSaludNavegador() {
    if (!client || !whatsappListo) {
        return { healthy: false, reason: 'cliente_no_listo' };
    }

    try {
        // Intentar obtener el objeto page de Puppeteer
        const pupPage = client.pupPage;

        if (!pupPage) {
            console.log('⚠️ [HEALTH CHECK] pupPage es null - navegador crasheado');
            return { healthy: false, reason: 'pupPage_null' };
        }

        // Verificar si la página está cerrada
        if (pupPage.isClosed && pupPage.isClosed()) {
            console.log('⚠️ [HEALTH CHECK] Página de Puppeteer está cerrada');
            return { healthy: false, reason: 'page_closed' };
        }

        // Intentar hacer una operación simple en la página para verificar que responde
        // Aumentamos el timeout a 10 segundos para dar más margen
        await Promise.race([
            pupPage.evaluate(() => true),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
        ]);

        // Si llegamos aquí, el navegador está saludable
        if (browserHealthCheck.consecutiveFailures > 0) {
            console.log(`✅ [HEALTH CHECK] Navegador recuperado después de ${browserHealthCheck.consecutiveFailures} fallos`);
        }

        browserHealthCheck.consecutiveFailures = 0;
        browserHealthCheck.sessionClosedErrors = 0; // Reset contador de errores session closed
        browserHealthCheck.lastSuccessfulOperation = Date.now();
        return { healthy: true };
    } catch (error) {
        // Si es un error de "Session closed", rastrear específicamente
        const isSessionClosed = error.message.includes('Session closed') || error.message.includes('Protocol error');

        if (isSessionClosed) {
            browserHealthCheck.sessionClosedErrors++;
            console.log(`🚨 [HEALTH CHECK] Error "Session closed" ${browserHealthCheck.sessionClosedErrors}/${browserHealthCheck.maxSessionClosedErrors} - Navegador probablemente crasheado`);

            // Si hay 2+ errores "Session closed" consecutivos, es un crash crítico - reiniciar inmediatamente
            if (browserHealthCheck.sessionClosedErrors >= browserHealthCheck.maxSessionClosedErrors) {
                browserHealthCheck.consecutiveFailures = browserHealthCheck.maxFailures; // Forzar reinicio
                console.log('💥 [HEALTH CHECK CRÍTICO] Navegador crasheado detectado - Forzando reinicio inmediato');
                return { healthy: false, reason: 'session_closed_critical' };
            }
        } else {
            // Reset contador si el error NO es "Session closed"
            browserHealthCheck.sessionClosedErrors = 0;
        }

        // Incrementar contador general de fallas
        browserHealthCheck.consecutiveFailures++;
        console.log(`⚠️ [HEALTH CHECK] Falla ${browserHealthCheck.consecutiveFailures}/${browserHealthCheck.maxFailures}: ${error.message}`);

        // Si es session closed, dar contexto adicional
        if (isSessionClosed) {
            console.log('⚠️ [HEALTH CHECK] Sesión de Chrome cerrada - posible crash del navegador');
        }

        return {
            healthy: false,
            reason: error.message,
            failures: browserHealthCheck.consecutiveFailures
        };
    }
}

// Variables para rastrear el tiempo que el cliente ha estado no listo
let tiempoClienteNoListo = 0;
const MAX_TIEMPO_NO_LISTO = 5 * 60 * 1000; // 5 minutos - reiniciar si no se conecta en 5 minutos

// Watchdog para detectar estado zombie
async function watchdogZombieState() {
    const ahora = Date.now();

    // NUEVO: Detectar si el cliente lleva mucho tiempo sin conectarse
    if (!whatsappListo) {
        // Si el cliente no está listo, rastrear el tiempo
        if (tiempoClienteNoListo === 0) {
            tiempoClienteNoListo = ahora;
        } else {
            const tiempoTranscurrido = ahora - tiempoClienteNoListo;
            if (tiempoTranscurrido > MAX_TIEMPO_NO_LISTO && !clienteIniciando) {
                console.log(`🚨 [WATCHDOG] Cliente no listo por ${Math.round(tiempoTranscurrido/1000/60)} minutos - Forzando reinicio`);
                tiempoClienteNoListo = 0; // Resetear
                await reiniciarClientePorCrash('watchdog_stuck_not_ready');
                return;
            }
        }

        // Si el cliente no está listo, no verificar el resto
        return;
    } else {
        // Si el cliente está listo, resetear el contador
        tiempoClienteNoListo = 0;
    }

    // Verificar si el cliente existe
    if (!client) {
        console.log('🚨 [WATCHDOG] Cliente es null pero whatsappListo=true - Estado inconsistente');
        await reiniciarClientePorCrash('watchdog_client_null');
        return;
    }

    // Verificar salud del navegador
    const healthStatus = await verificarSaludNavegador();

    if (!healthStatus.healthy) {
        console.log(`🚨 [WATCHDOG] Navegador no saludable: ${healthStatus.reason}`);

        // Si alcanzamos el máximo de fallas, forzar reinicio
        if (browserHealthCheck.consecutiveFailures >= browserHealthCheck.maxFailures) {
            console.log('🚨 [WATCHDOG] Máximo de fallas alcanzado - Forzando reinicio del cliente');
            browserHealthCheck.zombieStateDetected = true;

            // Forzar reinicio
            await reiniciarClientePorCrash('watchdog_max_failures');
        }
    }
}

// Función para reiniciar el cliente cuando se detecta crash
async function reiniciarClientePorCrash(razon) {
    console.log(`🔄 [CRASH RECOVERY] Iniciando recuperación por: ${razon}`);

    // Marcar como no listo
    whatsappListo = false;
    clienteIniciando = false;
    browserHealthCheck.zombieStateDetected = false;
    browserHealthCheck.consecutiveFailures = 0;

    // Limpiar QR
    global.currentQR = null;

    // Intentar destruir el cliente actual
    if (client) {
        try {
            console.log('🧹 [CRASH RECOVERY] Destruyendo cliente corrupto...');
            await Promise.race([
                client.destroy(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
            ]);
        } catch (err) {
            console.log(`⚠️ [CRASH RECOVERY] Error destruyendo cliente: ${err.message}`);
        }
        client = null;
    }

    // Limpiar procesos de Chrome
    try {
        const { execSync } = require('child_process');
        console.log('🧹 [CRASH RECOVERY] Limpiando procesos de Chrome...');
        execSync('pkill -9 -f "chrome.*whatsapp-bot-session"', { stdio: 'ignore' });
        await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (killErr) {
        // Ignorar error si no hay procesos
    }

    // Marcar momento de desconexión para emails
    if (whatsappDisconnectedSince === 0) {
        whatsappDisconnectedSince = Date.now();
        console.log('🚨 WhatsApp desconectado por crash - iniciando notificaciones de email');

        // Enviar email de desconexión inmediatamente
        sendDisconnectionEmail().catch(err => {
            console.log(`⚠️ [CRASH RECOVERY] Error enviando email de desconexión: ${err.message}`);
        });
    }

    // Reiniciar cliente
    console.log('🔄 [CRASH RECOVERY] Reiniciando cliente en 5 segundos...');
    setTimeout(async () => {
        await iniciarCliente();
    }, 5000);
}

// Iniciar watchdog
setInterval(watchdogZombieState, browserHealthCheck.checkInterval);

// ===== LISTA DE NÚMEROS BLOQUEADOS =====
const NUMEROS_BLOQUEADOS = [
    '105097933635741@lid',
    '105097933635741'
];

// ===== SISTEMA DE LÍMITE DIARIO DE MENSAJES =====
const dailyMessageLimit = {
    maxPerDay: 5000, // Aumentado a 5000 para soportar 1000/hora con margen
    counter: 0,
    lastReset: Date.now(),
    messagesPerHour: 0,
    lastHourReset: Date.now(),
    maxPerHour: 1000 // Aumentado a 1000 mensajes/hora
};

// ===== SISTEMA DE COLA PARA MENSAJES API =====
const messageQueue = {
    queue: [],
    processing: false,
    maxQueueSize: 5000, // Máximo 5000 mensajes en cola
    processInterval: 500, // Procesar cada 0.5 segundos (optimizado)
    retryAttempts: 3 // Reintentos por mensaje
};

function agregarMensajeACola(tipo, datos, prioridad = 'normal') {
    if (messageQueue.queue.length >= messageQueue.maxQueueSize) {
        console.log(`❌ [COLA] Cola llena (${messageQueue.maxQueueSize}). Mensaje rechazado.`);
        return false;
    }

    const mensaje = {
        id: Date.now() + Math.random(),
        tipo: tipo, // 'text', 'media', 'audio'
        datos: datos,
        prioridad: prioridad,
        intentos: 0,
        timestamp: Date.now()
    };

    // Insertar según prioridad
    if (prioridad === 'high') {
        messageQueue.queue.unshift(mensaje); // Al inicio
    } else {
        messageQueue.queue.push(mensaje); // Al final
    }

    console.log(`📥 [COLA] Mensaje agregado. Cola: ${messageQueue.queue.length} mensajes`);

    // Iniciar procesamiento si no está activo
    if (!messageQueue.processing) {
        procesarColaMensajes();
    }

    return mensaje.id;
}

async function procesarColaMensajes() {
    if (messageQueue.processing) return;

    messageQueue.processing = true;
    console.log(`🔄 [COLA] Iniciando procesamiento de cola`);

    while (messageQueue.queue.length > 0) {
        // Verificar si podemos enviar
        if (!verificarLimiteDiario()) {
            console.log(`⏸️ [COLA] Límite alcanzado. Pausando procesamiento. Reintentar en 5s...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
        }

        const mensaje = messageQueue.queue.shift();

        try {
            console.log(`📤 [COLA] Procesando mensaje ${mensaje.id} (Tipo: ${mensaje.tipo})`);

            let exito = false;

            switch (mensaje.tipo) {
                case 'text':
                    exito = await enviarMensaje(mensaje.datos.chatId, mensaje.datos.message, null, true, true);
                    break;
                case 'media':
                    exito = await enviarMensaje(mensaje.datos.chatId, mensaje.datos.media, mensaje.datos.path, true, true);
                    break;
                case 'audio':
                    exito = await enviarMensaje(mensaje.datos.chatId, mensaje.datos.media, mensaje.datos.path, true, true);
                    break;
            }

            if (!exito) {
                mensaje.intentos++;
                if (mensaje.intentos < messageQueue.retryAttempts) {
                    console.log(`⚠️ [COLA] Mensaje ${mensaje.id} falló. Reintento ${mensaje.intentos}/${messageQueue.retryAttempts}`);
                    messageQueue.queue.push(mensaje); // Reintentar al final
                } else {
                    console.log(`❌ [COLA] Mensaje ${mensaje.id} descartado después de ${messageQueue.retryAttempts} intentos`);
                }
            } else {
                console.log(`✅ [COLA] Mensaje ${mensaje.id} enviado exitosamente`);
            }

        } catch (error) {
            console.error(`❌ [COLA] Error procesando mensaje ${mensaje.id}:`, error.message);
            mensaje.intentos++;
            if (mensaje.intentos < messageQueue.retryAttempts) {
                messageQueue.queue.push(mensaje);
            }
        }

        // Delay entre mensajes de la cola
        await new Promise(resolve => setTimeout(resolve, messageQueue.processInterval));
    }

    messageQueue.processing = false;
    console.log(`✅ [COLA] Procesamiento completado. Cola vacía.`);
}

function verificarLimiteDiario() {
    const now = Date.now();
    // Reset diario
    if (now - dailyMessageLimit.lastReset > 86400000) {
        dailyMessageLimit.counter = 0;
        dailyMessageLimit.lastReset = now;
        console.log('🔄 [LIMITE DIARIO] Contador de mensajes reiniciado');
    }
    // Reset por hora
    if (now - dailyMessageLimit.lastHourReset > 3600000) {
        dailyMessageLimit.messagesPerHour = 0;
        dailyMessageLimit.lastHourReset = now;
        console.log('🔄 [LIMITE POR HORA] Contador de mensajes por hora reiniciado');
    }

    if (dailyMessageLimit.counter >= dailyMessageLimit.maxPerDay) {
        console.log(`⚠️ [LIMITE DIARIO] Límite alcanzado: ${dailyMessageLimit.counter}/${dailyMessageLimit.maxPerDay}`);
        return false;
    }
    if (dailyMessageLimit.messagesPerHour >= dailyMessageLimit.maxPerHour) {
        console.log(`⚠️ [LIMITE POR HORA] Límite alcanzado: ${dailyMessageLimit.messagesPerHour}/${dailyMessageLimit.maxPerHour}`);
        return false;
    }
    return true;
}

function incrementarContadorMensajes() {
    dailyMessageLimit.counter++;
    dailyMessageLimit.messagesPerHour++;
    console.log(`📊 [CONTADORES] Hoy: ${dailyMessageLimit.counter}/${dailyMessageLimit.maxPerDay}, Esta hora: ${dailyMessageLimit.messagesPerHour}/${dailyMessageLimit.maxPerHour}`);
}

// ===== SISTEMA DE CONTROL DE FRECUENCIA PARA MENSAJES API =====
const apiMessageControl = {
    messages: new Map(), // chatId -> {count, lastMessage, timestamps[]}
    maxPerChat: 90, // Máximo 90 mensajes por chat por hora (límite anti-detección)
    windowTime: 3600000, // Ventana de 1 hora
    minDelay: 3000, // Mínimo 3 segundos entre mensajes al mismo chat (comportamiento humano)
    warningThreshold: 70, // Advertir después de 70 mensajes
    // NUEVOS LÍMITES PARA COMPORTAMIENTO HUMANO
    maxPerMinute: 3, // Máximo 3 mensajes por minuto (comportamiento humano)
    maxPerDay: 800 // Máximo 800 mensajes por día (límite seguro)
};

function verificarFrecuenciaAPI(chatId, skipCheck = false) {
    // Si skipCheck es true, solo registrar sin validar (útil para mensajes urgentes)
    if (skipCheck) {
        console.log(`⚠️ [API] Verificación de frecuencia omitida para ${chatId}`);
    }

    const now = Date.now();

    if (!apiMessageControl.messages.has(chatId)) {
        apiMessageControl.messages.set(chatId, {
            count: 0,
            lastMessage: 0,
            timestamps: []
        });
    }

    const chatData = apiMessageControl.messages.get(chatId);

    // Limpiar timestamps antiguos (fuera de la ventana de tiempo)
    chatData.timestamps = chatData.timestamps.filter(t => now - t < apiMessageControl.windowTime);

    // Si no se debe verificar, solo registrar y permitir
    if (skipCheck) {
        chatData.timestamps.push(now);
        chatData.lastMessage = now;
        chatData.count++;
        return { allowed: true, skipped: true };
    }

    // Verificar delay mínimo entre mensajes (WARNING, no bloqueo)
    if (chatData.lastMessage && (now - chatData.lastMessage) < apiMessageControl.minDelay) {
        const esperaRestante = Math.ceil((apiMessageControl.minDelay - (now - chatData.lastMessage)) / 1000);
        console.log(`⚠️ [API WARNING] Mensajes rápidos a ${chatId}. Recomendado esperar ${esperaRestante}s`);
        // NO BLOQUEAMOS, solo advertimos
    }

    // Verificar límite de mensajes por ventana de tiempo
    if (chatData.timestamps.length >= apiMessageControl.maxPerChat) {
        console.log(`⚠️ [API RATE LIMIT] Límite de ${apiMessageControl.maxPerChat} mensajes/hora excedido para ${chatId}`);
        return {
            allowed: false,
            reason: `Has alcanzado el límite de ${apiMessageControl.maxPerChat} mensajes por hora a este chat. Intenta nuevamente en unos minutos.`,
            retryAfter: Math.ceil((apiMessageControl.windowTime - (now - chatData.timestamps[0])) / 1000)
        };
    }

    // Advertencia si se acerca al límite
    if (chatData.timestamps.length >= apiMessageControl.warningThreshold) {
        console.log(`⚠️ [API WARNING] ${chatId} ha recibido ${chatData.timestamps.length}/${apiMessageControl.maxPerChat} mensajes en esta hora`);
    }

    // Registrar nuevo mensaje
    chatData.timestamps.push(now);
    chatData.lastMessage = now;
    chatData.count++;

    return { allowed: true, count: chatData.timestamps.length, limit: apiMessageControl.maxPerChat };
}

// ===== SISTEMA DE HORARIOS DE DESCANSO =====
function estaEnHorarioDisponible() {
    const ahora = new Date();
    const hora = ahora.getHours();
    const minuto = ahora.getMinutes();

    // Evitar horarios sospechosos (2am-6am) - ENCOLAR en lugar de bloquear
    if (hora >= 2 && hora < 6) {
        console.log(`⏰ [HORARIO] Fuera de servicio (2am-6am): ${hora}:${minuto} - Mensajes se encolarán`);
        return { disponible: false, encolar: true, razon: 'horario_nocturno' };
    }

    // Pausa de almuerzo DESACTIVADA - Bot responde siempre inmediatamente
    // if (hora === 12 && minuto >= 0 && minuto <= 30) {
    //     console.log(`⏰ [HORARIO] Pausa de almuerzo: ${hora}:${minuto}`);
    //     if (Math.random() < 0.3) { // REDUCIDO de 70% a 30%
    //         return { disponible: false, encolar: true, razon: 'pausa_almuerzo' };
    //     }
    // }

    // Variación aleatoria en disponibilidad ELIMINADA para no perder mensajes
    // if (Math.random() < 0.05) {
    //     console.log(`⏰ [HORARIO] Pausa aleatoria simulada`);
    //     return false;
    // }

    return { disponible: true, encolar: false };
}

// Mensajes de bienvenida aleatorios y amigables con Unicode - EXPANDIDO A 50+ VARIANTES
const mensajesBienvenida = [
    `¡Hola de nuevo! ✨ En *SOLUCNET* queremos que encuentres rápido lo que buscas. Explora el *menú* y elige la opción que necesites. 📋`,
    `¡Qué gusto verte otra vez! 💻 En *SOLUCNET* estamos listos para ayudarte. Revisa el *menú* principal y selecciona tu opción preferida. 📋`,
    `¡Nos alegra tu regreso! 📅 En *SOLUCNET* tenemos todo preparado. Observa el *menú* y dinos qué servicio necesitas. 📋`,
    `¡Bienvenido nuevamente! 💬 En *SOLUCNET* queremos hacer tu experiencia fácil. Mira el *menú* y escoge lo que buscas. 📋`,
    `¡Nos encanta tenerte de vuelta! 🌟 En *SOLUCNET* encontrarás la solución que necesitas. Consulta el *menú* y selecciona la opción adecuada. 📋`,
    `¡Hola otra vez! 📍 En *SOLUCNET* tu satisfacción es prioridad. Revisa el *menú* principal y haz tu elección. 📋`,
    `¡Qué bueno que regresaste! 📚 En *SOLUCNET* tenemos varias opciones para ti. Lee el *menú* con calma y selecciona la que más te sirva. ✅`,
    `¡Un placer verte de nuevo! 🔍 En *SOLUCNET* todo está listo para atenderte. Explora el *menú* y dinos cómo podemos ayudarte. 💡`,
    `¡Bienvenido de regreso! 🎯 En *SOLUCNET* queremos llevarte directo a la solución. Revisa el *menú* y selecciona tu opción. 📋`,
    `¡Nos alegra verte nuevamente! 🎯 En *SOLUCNET* estamos aquí para ti. Mira el *menú* y elige lo que necesites. 👍`,
    `¡Bienvenido otra vez! 😊 En *SOLUCNET* estamos listos para asistirte. Revisa con calma el *menú* principal antes de elegir tu opción. 📋`,
    `¡Hola! 👋 Qué bien verte por aquí de nuevo. En *SOLUCNET* te ayudamos con lo que necesites. Revisa el *menú* principal. 📱`,
    `¡Bienvenido! 🌟 Estamos contentos de verte otra vez. En *SOLUCNET* tenemos todo listo para atenderte, mira el *menú*. ✨`,
    `¡Hola de nuevo! 😊 Qué gusto tenerte aquí. En *SOLUCNET* estamos para ayudarte. Revisa las opciones del *menú*. 🔧`,
    `¡Saludos! 👋 Nos alegra tu regreso a *SOLUCNET*. Explora el *menú* y cuéntanos qué necesitas. 💬`,
    `¡Hola! 🙌 Bienvenido otra vez a *SOLUCNET*. Tenemos varias opciones en el *menú* para ti. 📋`,
    `¡Qué alegría verte de vuelta! 🎉 En *SOLUCNET* queremos ayudarte rápidamente. Chequea el *menú* principal. ⚡`,
    `¡Hola nuevamente! 👋 En *SOLUCNET* estamos listos para asistirte. Dale un vistazo al *menú* de opciones. 👀`,
    `¡Bienvenido! 🤝 Es un gusto atenderte otra vez en *SOLUCNET*. Revisa el *menú* y selecciona lo que buscas. 🔎`,
    `¡Qué bueno verte por acá! 😃 En *SOLUCNET* tenemos todo preparado. Mira el *menú* con calma. ☕`,
    `¡Hola! 🌟 Nos da gusto tenerte de regreso. En *SOLUCNET* encuentra en el *menú* lo que necesitas. 🎯`,
    `¡Saludos otra vez! 👋 En *SOLUCNET* estamos para ayudarte. Explora las opciones del *menú* principal. 📋`,
    `¡Bienvenido de nuevo! 🚀 *SOLUCNET* tiene todo listo para ti. Revisa el *menú* y elige tu opción. ✨`,
    `¡Hola! 😊 Qué placer verte nuevamente. En *SOLUCNET* queremos facilitarte las cosas. Observa el *menú*. 💡`,
    `¡Bienvenido! 🎊 Nos alegra que regreses a *SOLUCNET*. Chequea el *menú* para ver las opciones disponibles. 👁️`,
    `¡Hola otra vez! 🌈 En *SOLUCNET* estamos preparados para atenderte. Revisa con calma el *menú* principal. 📱`,
    `¡Qué bien verte de regreso! 💙 *SOLUCNET* está aquí para ayudarte. Mira las opciones en el *menú*. 📋`,
    `¡Saludos! 🤗 Nos encanta tenerte por acá nuevamente. En *SOLUCNET* revisa el *menú* y dinos qué necesitas. 💬`,
    `¡Hola de nuevo! 🎯 Bienvenido a *SOLUCNET*, estamos listos para asistirte. Explora el *menú* de opciones. 🔍`,
    `¡Bienvenido! 🌟 Qué gusto verte otra vez por aquí. En *SOLUCNET* encuentra en el *menú* lo que buscas. 🎁`,
    `¡Hola! 😄 Nos da alegría tu regreso. En *SOLUCNET* tenemos varias opciones en el *menú* para ti. 📲`,
    `¡Qué placer tenerte de vuelta! 🤩 En *SOLUCNET* queremos ayudarte rápido. Chequea el *menú* principal. ⚡`,
    `¡Saludos otra vez! 👋 *SOLUCNET* está listo para atenderte. Dale un vistazo a las opciones del *menú*. 👀`,
    `¡Hola nuevamente! 😊 Nos alegra verte por acá. En *SOLUCNET* revisa el *menú* y selecciona tu opción. ✅`,
    `¡Bienvenido de regreso! 🎈 Es un gusto atenderte en *SOLUCNET*. Mira el *menú* con tranquilidad. 🧘`,
    `¡Hola! 🌞 Qué bien que regresas. En *SOLUCNET* estamos para ayudarte, revisa el *menú* principal. 📋`,
    `¡Saludos! 👋 Bienvenido otra vez a *SOLUCNET*. Explora las opciones que tenemos en el *menú*. 🗂️`,
    `¡Hola de nuevo! 🎉 Nos encanta tenerte aquí. En *SOLUCNET* encuentra lo que necesitas en el *menú*. 🔎`,
    `¡Bienvenido! 🌟 Qué alegría verte nuevamente en *SOLUCNET*. Chequea el *menú* de opciones disponibles. 📱`,
    `¡Hola otra vez! 💫 Nos da gusto tu regreso. En *SOLUCNET* revisa el *menú* y dinos cómo ayudarte. 🤝`,
    `¡Saludos! 👋 Es un placer verte de vuelta. *SOLUCNET* tiene todo en el *menú* para ti. 🎁`,
    `¡Hola! 😃 Bienvenido nuevamente. En *SOLUCNET* queremos facilitarte todo, mira el *menú* principal. 🚀`,
    `¡Qué bueno tenerte por acá otra vez! 🎊 En *SOLUCNET* estamos preparados, revisa el *menú* de opciones. 📋`,
    `¡Bienvenido de nuevo! 💙 Nos alegra atenderte en *SOLUCNET*. Explora con calma el *menú*. ☕`,
    `¡Hola! 🌟 Es un gusto verte otra vez. En *SOLUCNET* encuentra en el *menú* lo que buscas. 🎯`,
    `¡Saludos nuevamente! 👋 *SOLUCNET* está aquí para ti. Dale un vistazo al *menú* principal. 📱`,
    `¡Hola de regreso! 🎉 Nos encanta tenerte aquí. En *SOLUCNET* chequea las opciones del *menú*. ✨`,
    `¡Bienvenido! 🤝 Qué placer atenderte nuevamente. En *SOLUCNET* revisa el *menú* y selecciona tu opción. 📋`,
    `¡Hola otra vez! 🌈 Nos da alegría tu visita. *SOLUCNET* tiene todo listo en el *menú* para ti. 🎁`,
    `¡Saludos! 👋 Qué bueno verte de vuelta. En *SOLUCNET* explora el *menú* y dinos qué necesitas. 💬`,
    `¡Hola! 🌟 Bienvenido una vez más a *SOLUCNET*. Estamos listos para ayudarte, mira el *menú* principal. 📋`
];

// Localidades disponibles y sus imágenes
const localidadesDisponibles = {
    "reposo": "./images/reposo.jpg",
    "salvador": "./images/salvador.jpg",
    "bosque los almendros": "./images/bosque.jpg",
    "rio grande": "./images/riogrande.jpg",
    "osito": "./images/osito.jpg",
    "salsipuedes": "./images/salsipuedes.jpg",
    "milucha": "./images/milucha.jpg",
    "churido": "./images/churido.jpg"
};
// Configuración SSL para HTTPS
let sslOptions = null;
let useHTTPS = false;

// PRIORIDAD 1: Certificado válido de Let's Encrypt para cliente.solucnet.com
const letsencryptPath = '/etc/letsencrypt/live/cliente.solucnet.com';
if (fs.existsSync(`${letsencryptPath}/privkey.pem`) && fs.existsSync(`${letsencryptPath}/fullchain.pem`)) {
    try {
        sslOptions = {
            key: fs.readFileSync(`${letsencryptPath}/privkey.pem`),
            cert: fs.readFileSync(`${letsencryptPath}/fullchain.pem`)
        };
        useHTTPS = true;
        console.log('✅ Certificados SSL de Let\'s Encrypt cargados (cliente.solucnet.com) - Válido hasta Feb 2026');
    } catch (error) {
        console.log('❌ Error cargando certificados de Let\'s Encrypt:', error.message);
    }
}
// FALLBACK: Certificado autofirmado viejo (solo si Let's Encrypt no disponible)
if (!useHTTPS && fs.existsSync('ssl/private-key.pem') && fs.existsSync('ssl/certificate.pem')) {
    try {
        sslOptions = {
            key: fs.readFileSync('ssl/private-key.pem'),
            cert: fs.readFileSync('ssl/certificate.pem')
        };
        useHTTPS = true;
        console.log('⚠️ Certificados SSL autofirmados cargados (FALLBACK) - Usar Let\'s Encrypt en producción');
    } catch (error) {
        console.log('⚠️  Error cargando certificados SSL:', error.message);
        console.log('🔄 Usando HTTP en su lugar');
        useHTTPS = false;
    }
}
if (!useHTTPS) {
    console.log('⚠️  No se encontraron certificados SSL');
    console.log('🔄 Usando HTTP');
    useHTTPS = false;
}

// Optimizaciones de proceso Node.js mejoradas para CPU
process.env.UV_THREADPOOL_SIZE = '2'; // Reducir pool de threads para menos CPU
process.env.NODE_OPTIONS = '--max-old-space-size=256 --gc-interval=100'; // Limitar memoria heap y GC más agresivo

// Configurar límites de eventos para reducir overhead
process.setMaxListeners(50); // Reducir límite por defecto
require('events').EventEmitter.defaultMaxListeners = 50;

// Sistema de logging optimizado para reducir CPU
const ENABLE_VERBOSE_LOGGING = process.env.DEBUG === 'true';
const logOptimized = (message, level = 'info') => {
    if (!ENABLE_VERBOSE_LOGGING && level === 'verbose') return;
    if (level === 'error' || level === 'warn') {
        console.log(message);
    } else if (ENABLE_VERBOSE_LOGGING) {
        console.log(message);
    }
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limitar tamaño de JSON

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = './uploads/';
        // Crear directorio si no existe
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Generar nombre único con timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Configuración específica para PDFs de visitas técnicas
const pdfVisitasStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = './public/uploads/pdfs_visitas/';
        // Crear directorio si no existe
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Generar nombre único con timestamp y cliente
        const timestamp = Date.now();
        const clienteId = req.body.cliente_id || 'nuevo';
        const uniqueName = `visita_${clienteId}_${timestamp}_${file.originalname}`;
        cb(null, uniqueName);
    }
});

const uploadPdfVisitas = multer({
    storage: pdfVisitasStorage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB máximo
        files: 5 // máximo 5 archivos
    },
    fileFilter: (req, file, cb) => {
        // Solo permitir archivos PDF
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos PDF'), false);
        }
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB límite
        files: 10 // máximo 10 archivos por vez
    },
    fileFilter: function (req, file, cb) {
        // Tipos de archivo permitidos
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/avi', 'video/mov',
            'audio/mp3', 'audio/wav', 'audio/ogg',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/zip',
            'application/x-rar-compressed'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
        }
    }
});

// ===== Sistema de caché para mensajes de API =====
const mensajesAPICache = new Map(); // Para rastrear mensajes enviados por API

// ===== Cache para números omitidos (reducir consultas DB) =====
const numerosOmitidosCache = new Map();
const CACHE_OMITIDOS_TTL = 300000; // 5 minutos

function agregarMensajeAPICache(chatId, mensaje, duracion = 30000) {
    const key = `${chatId}:${mensaje}`;
    const expiry = Date.now() + duracion;
    mensajesAPICache.set(key, expiry);
    logOptimized(`🔐 [API CACHE] Mensaje marcado como API: ${key}`, 'verbose');
}

function esMensajeDeAPI(chatId, mensaje) {
    const key = `${chatId}:${mensaje}`;
    const entry = mensajesAPICache.get(key);

    if (entry) {
        // Verificar si ha expirado
        if (Date.now() > entry) {
            mensajesAPICache.delete(key);
            return false;
        }
        logOptimized(`✅ [API CHECK] Mensaje detectado como API: ${key}`, 'verbose');
        return true;
    }

    // Verificar patrones comunes de mensajes automatizados del bot
    const patronesBot = [
        /^Buenos días?,/i,
        /^Hola.*Bienvenido a SOLUCNET/i,
        /^📋 MENU PRINCIPAL/i,
        /^😊.*verte.*vez/i,
        /^👋Hola.*nuevo/i,
        /^💡 Tip: Te quedan/i,
        /^❗ Opción inválida/i,
        /^😊 Chat finalizado/i,
        /^🔧.*SolucNet.*Aviso/i,
        /^Hola.*le informamos que/i,
        /^👤 Perfecto, para comenzar/i,
        /^📨 Estamos procesando/i,
        /^🔍 Gracias.*ahora dime/i
    ];

    const esPatronBot = patronesBot.some(patron => patron.test(mensaje));
    if (esPatronBot) {
        logOptimized(`🤖 [BOT PATTERN] Mensaje detectado como bot automático: "${mensaje.substring(0, 30)}"`, 'verbose');
        return true;
    }

    return false;
}

// Función para verificar número omitido con cache
async function verificarNumeroOmitidoConCache(numeroSinFormato) {
    const cacheKey = numeroSinFormato;
    const cached = numerosOmitidosCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_OMITIDOS_TTL) {
        return cached.value;
    }
    
    // Si no está en cache o expiró, consultar DB
    try {
        const resultado = await estaNumeroOmitido(numeroSinFormato);
        
        // Guardar en cache
        numerosOmitidosCache.set(cacheKey, {
            value: resultado,
            timestamp: Date.now()
        });
        
        return resultado;
    } catch (error) {
        logOptimized(`Error verificando número omitido: ${error.message}`, 'error');
        return false;
    }
}

// Limpieza periódica del cache de manera eficiente
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    // Limpiar cache de mensajes API
    for (const [key, expiry] of mensajesAPICache.entries()) {
        if (now > expiry) {
            mensajesAPICache.delete(key);
            cleaned++;
        }
    }
    
    // Limpiar cache de números omitidos
    let cleanedOmitidos = 0;
    for (const [key, data] of numerosOmitidosCache.entries()) {
        if (now - data.timestamp > CACHE_OMITIDOS_TTL) {
            numerosOmitidosCache.delete(key);
            cleanedOmitidos++;
        }
    }
    
    if (cleaned > 0 || cleanedOmitidos > 0) {
        logOptimized(`🗑️ [CACHE CLEANUP] API: ${cleaned}, Omitidos: ${cleanedOmitidos}`, 'verbose');
    }
}, 60000); // Limpieza cada minuto en lugar de timeouts individuales

// ===== Función de logs optimizada para CPU =====
let logBuffer = [];
const MAX_LOG_BUFFER = 50;
const LOG_FLUSH_INTERVAL = 30000; // 30 segundos

function registrarLog(texto) {
    // Solo loggear eventos críticos en producción
    if (!ENABLE_VERBOSE_LOGGING) {
        // Filtrar solo errores críticos y eventos importantes
        if (!texto.includes('Error') && !texto.includes('❌') && !texto.includes('REINICIANDO') && !texto.includes('Usuario') && !texto.includes('eliminada')) {
            return;
        }
    }
    
    const linea = `[${new Date().toISOString()}] ${texto}\n`;
    console.log(linea.trim());
    
    // Buffer de escritura para reducir I/O
    logBuffer.push(linea);
    
    if (logBuffer.length >= MAX_LOG_BUFFER) {
        flushLogs();
    }
}

function flushLogs() {
    if (logBuffer.length > 0) {
        try {
            fs.appendFileSync('mensajes.log', logBuffer.join(''));
            logBuffer = [];
        } catch (error) {
            console.error('Error escribiendo logs:', error);
        }
    }
}

// Flush automático periódico
setInterval(flushLogs, LOG_FLUSH_INTERVAL);

// ===== FUNCIÓN CORREGIDA: Mensaje fuera de servicio =====
function enviarMensajeFueraHorario(chatId) {
    const ahora = new Date();
    const dia = ahora.getDay(); // 0 = domingo, 1 = lunes, ..., 6 = sábado
    const hora = ahora.getHours();

    // Verificar si está entre lunes (1) y sábado (6)
    const esDiaLaboral = dia >= 1 && dia <= 6;
    
    // Verificar si la hora está dentro del rango 8am - 7pm
    const enHorarioLaboral = hora >= 8 && hora < 19;

    // Si NO es día laboral o NO está en horario laboral => enviar mensaje
    if (!(esDiaLaboral && enHorarioLaboral)) {
        // Usar setTimeout para evitar bloqueo y asegurar que el mensaje se envíe
        setTimeout(async () => {
            await enviarMensaje(chatId, "⏰ Recuerda que nos encontramos fuera de servicio, nuestro horario de atencion es de lunes a sabado de 8 am - hasta las 7pm");
        }, 500);
    } else {
        console.log("✅ Dentro del horario laboral, no se envía mensaje.");
    }
}

// ===== Variables de control optimizadas =====
// ===== OPTIMIZACIÓN DE MEMORIA PARA MÁS USUARIOS =====
const estadosUsuario = new Map(); // Optimización: usar Map en lugar de objetos múltiples
const modosChat = new Map(); // PERSISTENCIA: Almacenar solo los modos bot/human de cada chat
const MAX_ESTADOS = 2000; // Aumentado para más usuarios
const chatsActivos = new Map(); // Almacenar información de chats activos
const mensajesChat = new Map(); // Almacenar mensajes de cada chat con límite
const MAX_MESSAGES_PER_CHAT = 50; // Límite de mensajes por chat para controlar memoria
const MAX_CHATS_ACTIVE = 3000; // Límite de chats activos simultáneos
let whatsappListo = false;
let whatsappEstabilizado = false;
let ultimoReinicio = 0;

// Persistencia de estados para recuperar tras reinicios
const ESTADOS_FILE = './estados_chat.json';
// Lista de chats finalizados que no deben ser recargados
const chatsFinalizados = new Set();

// Timer para debounce de guardado automático
let guardarEstadosTimer = null;
let ultimoGuardado = Date.now();

// Función para programar guardado con debounce inteligente
function programarGuardado(urgente = false) {
    // Si es urgente (cambios críticos), reducir el delay
    const delay = urgente ? 2000 : 5000; // 2s para urgente, 5s para normal

    // Limpiar timer existente
    if (guardarEstadosTimer) {
        clearTimeout(guardarEstadosTimer);
    }

    // Programar nuevo guardado
    guardarEstadosTimer = setTimeout(() => {
        guardarEstados();
        guardarEstadosTimer = null;
        ultimoGuardado = Date.now();
    }, delay);
}

// Función para guardar estados en archivo
function guardarEstados() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime();
        
        // Solo guardar estados del día actual
        const estadosDelDia = {};
        for (const [chatId, estado] of estadosUsuario.entries()) {
            if (estado.ultimaInteraccion && estado.ultimaInteraccion >= todayTimestamp) {
                estadosDelDia[chatId] = {
                    // Guardar TODO el estado importante para restaurar conversación
                    enEsperaHumano: estado.enEsperaHumano ? {
                        contador: estado.enEsperaHumano.contador || 0,
                        ultimaRespuesta: estado.enEsperaHumano.ultimaRespuesta || Date.now(),
                        iniciado: estado.enEsperaHumano.iniciado,
                        motivo: estado.enEsperaHumano.motivo
                    } : null,
                    clienteEncontrado: estado.clienteEncontrado,
                    seguimiento: estado.seguimiento, // CRÍTICO: paso actual en la conversación
                    esperandoCedula: estado.esperandoCedula || false,
                    esperandoCedula2: estado.esperandoCedula2 || false,
                    erroresConsecutivos: estado.erroresConsecutivos || 0,
                    primerErrorTimestamp: estado.primerErrorTimestamp,
                    mensajeSolEnviado: estado.mensajeSolEnviado || false,
                    ultimoMenuEnviado: estado.ultimoMenuEnviado,
                    primeraInteraccion: estado.primeraInteraccion,
                    ultimaInteraccion: estado.ultimaInteraccion
                };
            }
        }
        
        // Solo guardar chats activos del día actual con información importante
        const chatsActivosDelDia = {};
        for (const [chatId, chat] of chatsActivos.entries()) {
            if (chat.lastActivity && chat.lastActivity >= todayTimestamp) {
                chatsActivosDelDia[chatId] = {
                    id: chat.id,
                    phone: chat.phone,
                    name: chat.name,
                    lastActivity: chat.lastActivity,
                    mode: chat.mode,
                    pendiente: chat.pendiente // IMPORTANTE: Guardar estado pendiente
                };
            }
        }

        // Guardar solo los modos (bot/human) de todos los chats sin importar la fecha
        // IMPORTANTE: NO sincronizar modosChat desde estadosUsuario aquí
        // Los modos deben actualizarse SOLO cuando se activa/desactiva modo humano explícitamente
        // en activarModoHumano() o cuando se sale del modo humano con #
        // Si sincronizamos aquí, se sobrescriben modos incorrectamente cuando los estados se limpian

        // Luego guardar TODOS los modos de modosChat (incluye históricos)
        const modosGuardados = {};
        for (const [chatId, modo] of modosChat.entries()) {
            modosGuardados[chatId] = modo;
        }

        const data = {
            timestamp: Date.now(),
            estados: estadosDelDia,
            chatsFinalizados: Array.from(chatsFinalizados),
            chatsActivos: chatsActivosDelDia,
            modosChat: modosGuardados // NUEVO: Persistir modos independientemente de la fecha
        };

        fs.writeFileSync(ESTADOS_FILE, JSON.stringify(data, null, 2));

        const tiempoDesdeUltimoGuardado = ((Date.now() - ultimoGuardado) / 1000).toFixed(1);
        console.log(`💾 [PERSISTENCIA] ${Object.keys(estadosDelDia).length} estados, ${Object.keys(chatsActivosDelDia).length} chats activos y ${Object.keys(modosGuardados).length} modos guardados (última: ${tiempoDesdeUltimoGuardado}s)`);
    } catch (error) {
        console.error('❌ [PERSISTENCIA] Error guardando estados:', error.message);
    }
}

// Función para cargar estados desde archivo
function cargarEstados() {
    try {
        if (fs.existsSync(ESTADOS_FILE)) {
            const data = JSON.parse(fs.readFileSync(ESTADOS_FILE, 'utf8'));

            // Cargar estados de usuarios
            if (data.estados) {
                for (const [chatId, estado] of Object.entries(data.estados)) {
                    estadosUsuario.set(chatId, estado);
                }
                console.log(`🔄 [PERSISTENCIA] ${Object.keys(data.estados).length} estados cargados`);
            }

            // Cargar lista de chats finalizados
            if (data.chatsFinalizados && Array.isArray(data.chatsFinalizados)) {
                data.chatsFinalizados.forEach(chatId => chatsFinalizados.add(chatId));
                console.log(`🚫 [PERSISTENCIA] ${data.chatsFinalizados.length} chats finalizados cargados`);
            }

            // Cargar chats activos guardados (con información de pendiente)
            if (data.chatsActivos) {
                const hoy = new Date();
                hoy.setHours(0, 0, 0, 0);
                const inicioDia = hoy.getTime();

                let cargados = 0;
                for (const [chatId, chat] of Object.entries(data.chatsActivos)) {
                    // Solo cargar chats con interacción del día actual
                    if (chat.lastActivity && chat.lastActivity >= inicioDia) {
                        chatsActivos.set(chatId, chat);
                        cargados++;
                    }
                }
                console.log(`💬 [PERSISTENCIA] ${cargados} chats activos cargados (con estado pendiente) del día actual de ${Object.keys(data.chatsActivos).length} totales`);
            }

            // NUEVO: Cargar modos de chat persistidos (sin importar la fecha)
            if (data.modosChat) {
                for (const [chatId, modo] of Object.entries(data.modosChat)) {
                    modosChat.set(chatId, modo);
                }
                console.log(`🎭 [PERSISTENCIA] ${Object.keys(data.modosChat).length} modos de chat cargados (bot/human)`);
            }

            // CRÍTICO: Recuperar chats que tienen estado guardado pero no están en chatsActivos
            // Esto puede pasar si el chat se limpió pero tiene estado/modo persistente
            let chatsRecuperados = 0;
            for (const [chatId, estado] of estadosUsuario.entries()) {
                if (!chatsActivos.has(chatId)) {
                    // Eliminar de finalizados si está ahí (prioridad al estado)
                    if (chatsFinalizados.has(chatId)) {
                        chatsFinalizados.delete(chatId);
                        console.log(`🔄 [RECUPERACIÓN ESTADO] Chat ${chatId} removido de finalizados`);
                    }

                    // Agregar a chatsActivos
                    const modo = modosChat.get(chatId) || 'bot';
                    chatsActivos.set(chatId, {
                        id: chatId,
                        phone: chatId.replace('@c.us', '').replace('@lid', ''),
                        name: `+${chatId.replace('@c.us', '').replace('@lid', '')}`,
                        lastActivity: estado.ultimaInteraccion || Date.now(),
                        lastMessage: 'Chat recuperado desde estado',
                        unreadCount: 0,
                        mode: modo,
                        pendiente: true
                    });

                    // Inicializar mensajes vacíos si no existen
                    if (!mensajesChat.has(chatId)) {
                        mensajesChat.set(chatId, []);
                    }

                    chatsRecuperados++;
                    console.log(`✅ [RECUPERACIÓN ESTADO] Chat ${chatId} recuperado en modo ${modo}`);
                }
            }

            if (chatsRecuperados > 0) {
                console.log(`📊 [RECUPERACIÓN ESTADO] ${chatsRecuperados} chats adicionales recuperados desde estados guardados`);
            }
        }
    } catch (error) {
        console.error('❌ [PERSISTENCIA] Error cargando estados:', error.message);
    }
}

// Función que se ejecuta al iniciar el servidor para cargar datos persistidos
function inicializarDatos() {
    console.log('🚀 [INICIO] Cargando datos persistidos...');
    cargarEstados();
}

// Guardado automático de respaldo cada 60 segundos
// NOTA: También se guarda automáticamente después de cada mensaje (con debounce)
// Este intervalo es solo un respaldo de seguridad
setInterval(guardarEstados, 60 * 1000); // Cada 60 segundos como respaldo
process.on('SIGINT', () => {
    console.log('🔄 [SHUTDOWN] Guardando estados antes de cerrar...');
    guardarEstados();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('🔄 [SHUTDOWN] Guardando estados antes de cerrar...');
    guardarEstados();
    process.exit(0);
});

// Limpieza automática de estados viejos para liberar CPU/memoria
setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas
    let cleaned = 0;

    // Limpiar estados viejos
    for (const [chatId, estado] of estadosUsuario.entries()) {
        if (now - estado.ultimaInteraccion > maxAge) {
            estadosUsuario.delete(chatId);
            cleaned++;
        }
    }

    // Limpiar chats activos viejos
    for (const [chatId, chat] of chatsActivos.entries()) {
        if (now - chat.lastActivity > maxAge) {
            chatsActivos.delete(chatId);
            mensajesChat.delete(chatId); // También limpiar mensajes asociados
            cleaned++;
        }
    }

    if (cleaned > 0) {
        logOptimized(`🧹 [MEMORY CLEANUP] ${cleaned} estados/chats viejos limpiados`, 'verbose');
    }
}, 10 * 60 * 1000); // Cada 10 minutos

// Limpiar chats finalizados cada medianoche para empezar el día limpio
setInterval(() => {
    const ahora = new Date();
    if (ahora.getHours() === 0 && ahora.getMinutes() === 0) {
        const chatsFinalizadosCount = chatsFinalizados.size;
        chatsFinalizados.clear();
        if (chatsFinalizadosCount > 0) {
            console.log(`🌅 [NUEVO DÍA] ${chatsFinalizadosCount} chats finalizados limpiados para el nuevo día`);
        }
    }
}, 60000); // Verificar cada minuto

// Sincronización automática de clientes externos cada hora
setInterval(async () => {
    try {
        console.log('🔄 [SYNC AUTO] Iniciando sincronización automática de clientes externos...');
        const resultado = await sincronizarClientesExternos();

        if (resultado.success) {
            console.log(`✅ [SYNC AUTO] Sincronización completada: ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados (Total: ${resultado.total})`);
        } else {
            console.log(`⚠️ [SYNC AUTO] Error en sincronización: ${resultado.message}`);
        }
    } catch (error) {
        console.error('❌ [SYNC AUTO] Error en sincronización automática:', error.message);
    }
}, 60 * 60 * 1000); // Cada hora

// Constantes de tiempo

// ===== Función de similitud optimizada =====
function similitudTexto(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase();
    b = b.toLowerCase();
    
    // Optimización: verificar coincidencia exacta primero
    if (a === b) return 1;
    
    const distancia = levenshtein(a, b);
    const longitudMax = Math.max(a.length, b.length);
    return 1 - distancia / longitudMax;
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matriz = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    
    for (let i = 0; i <= a.length; i++) matriz[0][i] = i;
    for (let j = 0; j <= b.length; j++) matriz[j][0] = j;
    
    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
            matriz[j][i] = Math.min(
                matriz[j - 1][i] + 1,
                matriz[j][i - 1] + 1,
                matriz[j - 1][i - 1] + cost
            );
        }
    }
    
    return matriz[b.length][a.length];
}

// ===== Función para limpiar sesión =====
function borrarSesion() {
    try {
        // Usar la ruta correcta del proyecto actual
        const sessionPath = '/root/whatsapp-chatbot/.wwebjs_auth';

        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            registrarLog('🗑️ Carpeta de sesión eliminada correctamente.');
            console.log(`🗑️ [SESIÓN] Eliminada: ${sessionPath}`);
        } else {
            registrarLog('⚠️ No se encontró carpeta de sesión para borrar.');
            console.log(`⚠️ [SESIÓN] No encontrada en: ${sessionPath}`);
        }

        // Actualizar estado de WhatsApp a desconectado
        whatsappListo = false;
        clienteIniciando = false;
        console.log('🔄 [SESIÓN] Estado de WhatsApp actualizado a desconectado');

        // También limpiar el QR global
        global.currentQR = null;
        console.log('🔄 [SESIÓN] QR global limpiado');

    } catch (err) {
        registrarLog(`❌ Error borrando sesión: ${err.message}`);
        console.error(`❌ [SESIÓN] Error: ${err.message}`);
    }
}

// ===== Funciones de gestión de chats =====
function obtenerNombreChat(chatId) {
    // Extraer número de teléfono del chatId
    const numero = chatId.replace('@c.us', '').replace('@lid', '');
    return `+${numero}`;
}

function obtenerModoChat(chatId) {
    // Primero verificar si existe un modo persistido
    if (modosChat.has(chatId)) {
        return modosChat.get(chatId);
    }
    // Si no, calcular desde el estado actual
    const estado = obtenerEstadoUsuario(chatId);
    return estado.enEsperaHumano ? 'human' : 'bot';
}

function actualizarChatActivo(chatId, mensaje = null) {
    // Permitir grupos de WhatsApp para evitar que se eliminen sus mensajes en reconexiones
    
    // Para grupos usar el ID completo, para individuales extraer el número
    const numero = chatId.includes('@g.us') ? chatId : chatId.replace('@c.us', '').replace('@lid', '');
    const nombre = obtenerNombreChat(chatId);
    const modo = obtenerModoChat(chatId);
    
    const chatInfo = chatsActivos.get(chatId) || {
        id: chatId,
        phone: numero,
        name: nombre,
        mode: modo,
        lastActivity: Date.now(),
        lastMessage: '',
        unreadCount: 0,
        messages: [],
        pendiente: true // Marcar como pendiente automáticamente para chats nuevos
    };

    if (mensaje) {
        // Check if message contains an image and replace with 'imagen'
        if (mensaje.body && mensaje.body.includes('<img')) {
            chatInfo.lastMessage = 'imagen';
        } else {
            chatInfo.lastMessage = mensaje.body.substring(0, 50) + (mensaje.body.length > 50 ? '...' : '');
        }
        chatInfo.lastActivity = Date.now();

        // Incrementar contador de no leídos si es mensaje entrante
        if (!mensaje.fromMe) {
            chatInfo.unreadCount = (chatInfo.unreadCount || 0) + 1;
            // Marcar como pendiente cada vez que llega un mensaje entrante
            chatInfo.pendiente = true;

            // IMPORTANTE: Eliminar de chatsFinalizados si está allí (para recuperación automática)
            if (chatsFinalizados.has(chatId)) {
                chatsFinalizados.delete(chatId);
                console.log(`🔄 [AUTO-RECUPERAR] Chat ${chatId} eliminado de chatsFinalizados por mensaje nuevo`);
            }
        }
        
        // Agregar mensaje a la lista
        if (!mensajesChat.has(chatId)) {
            mensajesChat.set(chatId, []);
        }

        const mensajes = mensajesChat.get(chatId);

        // Verificar si el mensaje ya existe para evitar duplicados
        const mensajeExistente = mensajes.find(m =>
            m.body === mensaje.body &&
            Math.abs(m.timestamp - Date.now()) < 5000 && // Dentro de 5 segundos
            m.fromMe === (mensaje.fromMe || false)
        );

        if (!mensajeExistente) {
            console.log(`📝 [CHAT UPDATE] Agregando mensaje único a ${chatId}: "${mensaje.body.substring(0, 30)}"`);
            const isFromAPI = mensaje.fromMe && esMensajeDeAPI(chatId, mensaje.body);
            console.log(`📝 [CACHE ADD] Agregando mensaje: "${mensaje.body.substring(0, 30)}" - fromMe: ${mensaje.fromMe} - isFromAPI: ${isFromAPI}`);
            mensajes.push({
                id: Date.now() + Math.random(),
                body: mensaje.body,
                fromMe: mensaje.fromMe || false,
                timestamp: Date.now(),
                status: mensaje.fromMe ? 'sent' : 'received',
                isFromAPI: isFromAPI
            });
        } else {
            logOptimized(`🚫 [CHAT UPDATE] Mensaje duplicado detectado, omitiendo: "${mensaje.body.substring(0, 30)}"`, 'verbose');
        }

        // Mantener solo los últimos 50 mensajes por chat
        if (mensajes.length > 50) {
            mensajes.splice(0, mensajes.length - 50);
        }
    }
    
    chatInfo.mode = modo;
    chatsActivos.set(chatId, chatInfo);
    console.log(`✅ [DEBUG] Chat ${chatId} agregado a chatsActivos. Total: ${chatsActivos.size}`);
}

function limpiarChatActivo(chatId) {
    chatsActivos.delete(chatId);
    mensajesChat.delete(chatId);
}

// ===== Función unificada para limpiar completamente un chat =====
function limpiarChatCompleto(chatId) {
    console.log(`🧹 [LIMPIEZA] Limpiando chat completo: ${chatId}`);

    // 1. Limpiar estado de usuario (temporizadores, listeners, etc.)
    const estado = obtenerEstadoUsuario(chatId);
    if (estado.enEsperaHumano?.temporizador) {
        clearTimeout(estado.enEsperaHumano.temporizador);
        console.log(`🧹 [LIMPIEZA] Temporizador limpiado para ${chatId}`);
    }

    // Cancelar timeout de Sol si existe
    if (timeoutsSol.has(chatId)) {
        clearTimeout(timeoutsSol.get(chatId));
        timeoutsSol.delete(chatId);
        console.log(`🧹 [LIMPIEZA] Timeout de Sol cancelado para ${chatId}`);
    }

    // Remover listener de formulario si existe
    if (estado.formularioListener) {
        try {
            client.removeListener('message', estado.formularioListener);
            console.log(`🧹 [LIMPIEZA] Listener de formulario removido para ${chatId}`);
        } catch (error) {
            console.error(`❌ [LIMPIEZA] Error removiendo listener para ${chatId}:`, error.message);
        }
    }
    
    // 2. Limpiar del mapa de estados
    const estadoEliminado = estadosUsuario.delete(chatId);
    console.log(`🧹 [LIMPIEZA] Estado usuario ${estadoEliminado ? 'eliminado' : 'no encontrado'} para ${chatId}`);
    
    // 3. Limpiar chats activos y mensajes
    const chatEliminado = chatsActivos.delete(chatId);
    const mensajesEliminados = mensajesChat.delete(chatId);
    console.log(`🧹 [LIMPIEZA] Chat activo ${chatEliminado ? 'eliminado' : 'no encontrado'}, mensajes ${mensajesEliminados ? 'eliminados' : 'no encontrados'} para ${chatId}`);

    // 4. Marcar chat como finalizado para evitar su recarga
    chatsFinalizados.add(chatId);
    console.log(`🚫 [LIMPIEZA] Chat ${chatId} marcado como finalizado`);

    // 5. Cambiar a modo bot y persistir en BD
    modosChat.set(chatId, 'bot');
    const numero = chatId.replace('@c.us', '').replace('@lid', '');
    persistirModoChat(chatId, 'bot').catch(err => {
        console.error(`❌ [LIMPIEZA] Error persistiendo modo bot para ${numero}:`, err.message);
    });
    console.log(`🤖 [LIMPIEZA] Chat ${numero} cambiado a modo bot`);

    console.log(`✅ [LIMPIEZA] Chat ${chatId} completamente limpiado`);
}

// ===== Función para limpiar mensajes duplicados =====
function limpiarMensajesDuplicados() {
    console.log('🧹 Iniciando limpieza de mensajes duplicados...');

    try {
        let totalDuplicados = 0;

        // Limpiar cada chat
        for (const [chatId, mensajes] of mensajesChat.entries()) {
            const mensajesOriginales = mensajes.length;
            const mensajesUnicos = [];
            const mensajesVistos = new Set();

            // PROTECCIÓN: Preservar TODOS los mensajes enviados recientes (última hora)
            const tiempoProteccion = Date.now() - (60 * 60 * 1000); // 1 hora atrás

            // Filtrar mensajes únicos (mantener el más reciente)
            for (let i = mensajes.length - 1; i >= 0; i--) {
                const mensaje = mensajes[i];

                // PROTECCIÓN ESPECIAL: Nunca eliminar mensajes enviados recientes
                const esMensajeEnviadoReciente = mensaje.fromMe && mensaje.timestamp > tiempoProteccion;

                if (esMensajeEnviadoReciente) {
                    // SIEMPRE preservar mensajes enviados recientes
                    mensajesUnicos.unshift(mensaje);
                    console.log(`🛡️ [PROTECT] Protegiendo mensaje enviado: "${mensaje.body.substring(0, 30)}"`);
                } else {
                    // Lógica normal de deduplicación para otros mensajes
                    const clave = mensaje.id || `${mensaje.body}_${mensaje.fromMe}_${mensaje.timestamp}`;

                    if (!mensajesVistos.has(clave)) {
                        mensajesVistos.add(clave);
                        mensajesUnicos.unshift(mensaje);
                    }
                }
            }

            const duplicadosEliminados = mensajesOriginales - mensajesUnicos.length;
            if (duplicadosEliminados > 0) {
                mensajesChat.set(chatId, mensajesUnicos);
                totalDuplicados += duplicadosEliminados;
                console.log(`   ✅ Chat ${chatId}: ${duplicadosEliminados} duplicados eliminados`);
            }
        }

        console.log(`🧹 Limpieza completada: ${totalDuplicados} mensajes duplicados eliminados`);
        return totalDuplicados;

    } catch (error) {
        console.error('❌ Error limpiando mensajes duplicados:', error.message);
        return 0;
    }
}

// ===== Funciones de estado optimizadas =====
function obtenerEstadoUsuario(chatId) {
    if (estadosUsuario.has(chatId)) {
        return estadosUsuario.get(chatId);
    }

    // Si no existe el estado, crear uno nuevo pero restaurar el modo si existe en modosChat
    const estadoBase = {
        ultimaInteraccion: 0,
        esperandoCedula: false,
        esperandoCedula2: false,
        seguimiento: null,
        enEsperaHumano: null,
        clienteEncontrado: null,
        erroresConsecutivos: 0, // NUEVO: contador de errores consecutivos
        formularioListener: null, // NUEVO: referencia al listener de formulario
        formularioListenerId: null, // NUEVO: ID único del listener de formulario
        ultimoMenuEnviado: null, // NUEVO: timestamp del último menú enviado
        primeraInteraccion: true // NUEVO: indica si es la primera interacción del usuario
    };

    // NUEVO: Restaurar modo persistido si existe
    if (modosChat.has(chatId)) {
        const modo = modosChat.get(chatId);
        if (modo === 'human') {
            estadoBase.enEsperaHumano = {
                iniciado: Date.now(),
                motivo: 'Modo restaurado desde persistencia'
            };
            console.log(`🎭 [RESTAURAR] Modo human restaurado para chat ${chatId}`);
        }
    }

    return estadoBase;
}

function actualizarEstadoUsuario(chatId, nuevoEstado) {
    // Limitar memoria: si excedemos el límite, remover el más antiguo
    if (estadosUsuario.size >= MAX_ESTADOS) {
        const primeraKey = estadosUsuario.keys().next().value;
        const estadoAntiguo = estadosUsuario.get(primeraKey);
        estadosUsuario.delete(primeraKey);
    }

    const estadoActual = obtenerEstadoUsuario(chatId);
    estadosUsuario.set(chatId, { ...estadoActual, ...nuevoEstado, ultimaInteraccion: Date.now() });

    // NUEVO: Actualizar modo persistente en modosChat
    // Solo actualizar si es un cambio explícito de modo:
    // - enEsperaHumano es un objeto con datos (entrar a modo human)
    // - enEsperaHumano es null Y el modo actual es 'human' (salir de modo human explícitamente)
    if (typeof nuevoEstado.enEsperaHumano !== 'undefined') {
        if (nuevoEstado.enEsperaHumano && typeof nuevoEstado.enEsperaHumano === 'object') {
            // Cambio a modo human - hay datos de espera
            modosChat.set(chatId, 'human');
            console.log(`🎭 [MODO] Chat ${chatId} cambiado a modo: human`);
        } else if (nuevoEstado.enEsperaHumano === null && modosChat.get(chatId) === 'human') {
            // Salida explícita de modo human (cuando estaba en human y se pasa null)
            modosChat.set(chatId, 'bot');
            console.log(`🎭 [MODO] Chat ${chatId} cambiado a modo: bot`);
        }
        // Si enEsperaHumano es null pero el modo no es 'human', NO cambiar
        // (mantener el modo que ya estaba, especialmente si se está cargando desde archivo)
    }

    // Guardar estados cuando hay cambios importantes
    if (nuevoEstado.enEsperaHumano || nuevoEstado.clienteEncontrado || nuevoEstado.seguimiento) {
        programarGuardado(true); // Guardado urgente para cambios críticos
    }
}

function limpiarEstadoUsuario(chatId) {
    const estado = obtenerEstadoUsuario(chatId);
    // Remover listener de formulario si existe
    if (estado.formularioListener) {
        try {
            client.removeListener('message', estado.formularioListener);
            console.log('Listener de formulario removido al limpiar estado para', chatId);
        } catch (error) {
            console.error('Error removiendo listener de formulario:', error.message);
        }
    }
    estadosUsuario.delete(chatId);
}

// ===== NUEVA FUNCIÓN: Enviar audio explicativo =====
async function enviarAudioExplicativo(chatId) {
    try {
        const rutaAudio = './audio/menu_explicativo.mp3';
        
        // Verificar si el archivo existe
        if (!fs.existsSync(rutaAudio)) {
            registrarLog(`❌ Audio explicativo no encontrado en: ${rutaAudio}`);
            // Fallback: enviar mensaje de texto explicativo
            await enviarMensaje(chatId, `🔊 *Audio explicativo del menú*\n\nHola, veo que has tenido dificultades navegando nuestro menú. Te explico cómo usarlo:\n\n📋 *MENÚ PRINCIPAL*\n\n*1* - Si ya eres cliente de SOLUCNET y necesitas reportar un daño, hacer un pago o consultar intermitencias\n\n*2* - Si quieres adquirir un nuevo servicio de internet y eres nuevo cliente\n\n*3* - Si tuviste servicio con nosotros antes y quieres reactivarlo\n\n*4* - Si eres cliente activo pero el sistema no reconoce tu cédula\n\n*#* - Para volver al menú principal desde cualquier punto\n\n*##* - Para hablar directamente con un asesor humano\n\n¡Solo escribe el número de la opción que necesitas!`);
            return;
        }
        
        const media = MessageMedia.fromFilePath(rutaAudio);
        await enviarMensaje(chatId, media);
        registrarLog(`🔊 Audio explicativo enviado a ${chatId}`);
    } catch (error) {
        registrarLog(`❌ Error enviando audio explicativo: ${error.message}`);
        // Fallback en caso de error
        await enviarMensaje(chatId, `🔊 *Ayuda con el Menú* 💡\n\n👋 Veo que necesitas ayuda. Recuerda que debes escribir solo el *número* de la opción que necesitas:\n\n1️⃣ Usuarios registrados\n2️⃣ Nuevo servicio\n3️⃣ Reactivación\n4️⃣ Cliente activo (problema con cédula)\n\n📝 *Ejemplo:* escribe solo "*1*" para la primera opción.`);
    }
}

// ===== MAPA PARA GUARDAR TIMEOUTS DE SOL =====
const timeoutsSol = new Map();

// ===== FUNCIÓN HELPER: Resetear sistema de errores =====
function resetearSistemaErrores(chatId) {
    const estado = obtenerEstadoUsuario(chatId);
    const actualizacion = {
        erroresConsecutivos: 0,
        primerErrorTimestamp: null
    };

    // Si fue una nueva interacción exitosa, resetear también el flag de Sol
    // para que pueda volver a usarse en futuras interacciones problemáticas
    if (estado.mensajeSolEnviado) {
        actualizacion.mensajeSolEnviado = false;
    }

    // Cancelar timeout de Sol si existe
    if (timeoutsSol.has(chatId)) {
        clearTimeout(timeoutsSol.get(chatId));
        timeoutsSol.delete(chatId);
        console.log(`⏰ [SOL] Timeout cancelado para ${chatId} - usuario escribió opción válida`);
    }

    actualizarEstadoUsuario(chatId, actualizacion);
}

// ===== FUNCIÓN: Enviar mensaje de Sol (asistente virtual) =====
async function enviarMensajeSol(chatId) {
    const mensajeSol = `🤖 *Hola, soy Sol, tu asistente de SOLUCNET* ✨\n\n⚠️ *ATENCIÓN:*\n\n❌ *Tu solicitud NO será atendida* hasta que completes correctamente el chatbot.\n\n💡 Sé que puede parecer complicado, pero es necesario para procesar tu solicitud.\n\n✅ *Por favor:*\n• Lee cada opción con atención\n• Responde SOLO con el número\n• Sigue cada paso\n\n📞 Así nuestros asesores podrán ayudarte.\n\n🔄 *Reiniciando...*`;

    await enviarMensaje(chatId, mensajeSol);
    console.log(`🤖 [SOL] Mensaje de asistencia enviado a ${chatId} por errores prolongados`);
    registrarLog(`Sol envió mensaje de asistencia a ${chatId} por errores mayores a 1 minuto`);
}

// ===== FUNCIÓN MODIFICADA: Manejar mensaje de opción inválida =====
async function manejarOpcionInvalida(chatId, contexto = 'menu_principal') {
    const estado = obtenerEstadoUsuario(chatId);
    const nuevosErrores = (estado.erroresConsecutivos || 0) + 1;
    const ahora = Date.now();

    // Si es el primer error, guardar timestamp y programar timeout de Sol
    if (!estado.primerErrorTimestamp) {
        actualizarEstadoUsuario(chatId, {
            erroresConsecutivos: nuevosErrores,
            primerErrorTimestamp: ahora
        });

        // Programar timeout automático de 60 segundos para Sol
        if (!estado.mensajeSolEnviado && !timeoutsSol.has(chatId)) {
            console.log(`⏰ [SOL] Iniciando temporizador de 60 segundos para ${chatId}`);

            const timeoutId = setTimeout(async () => {
                const estadoActualizado = obtenerEstadoUsuario(chatId);

                // Verificar que todavía hay errores y que no se ha enviado el mensaje
                if (estadoActualizado.erroresConsecutivos > 0 && !estadoActualizado.mensajeSolEnviado) {
                    console.log(`⏰ [SOL] 60 segundos cumplidos - Enviando mensaje a ${chatId}`);

                    // Enviar mensaje de Sol
                    await enviarMensajeSol(chatId);

                    // Marcar que el mensaje fue enviado y esperar respuesta del usuario
                    actualizarEstadoUsuario(chatId, {
                        mensajeSolEnviado: true,
                        esperandoRespuestaSol: true,
                        erroresConsecutivos: 0,
                        primerErrorTimestamp: null
                    });

                    // Remover timeout del mapa
                    timeoutsSol.delete(chatId);
                } else {
                    console.log(`⏰ [SOL] Timeout cumplido pero condiciones no se cumplen para ${chatId}`);
                    timeoutsSol.delete(chatId);
                }
            }, 60000); // 60 segundos

            // Guardar el timeout en el mapa
            timeoutsSol.set(chatId, timeoutId);
        }
    } else {
        // No es el primer error, solo incrementar contador
        actualizarEstadoUsuario(chatId, { erroresConsecutivos: nuevosErrores });
    }

    if (nuevosErrores >= 3) {
        // Enviar audio explicativo después de 3 errores consecutivos
        await enviarAudioExplicativo(chatId);
        // Resetear contador y timestamp después de enviar el audio
        actualizarEstadoUsuario(chatId, {
            erroresConsecutivos: 0,
            primerErrorTimestamp: null
        });
        // Mostrar el menú principal nuevamente
        setTimeout(async () => {

        }, 3000); // Esperar 3 segundos después del audio
    } else {
        // Mensaje de error normal
        let mensajeError = '❗ *Opción inválida* ⚠️\n\n📋 Recuerda seguir el menú de atención';

        if (contexto === 'menu_principal') {
            mensajeError += '.\n\n✍️ Escribe el *número* de la opción que necesitas:\n1️⃣ 2️⃣ 3️⃣ o 4️⃣';
        }

        mensajeError += '\n\n#️⃣ Para volver al menú principal envía *#*';

        await enviarMensaje(chatId, mensajeError);

        // Mostrar contador de intentos restantes
        const intentosRestantes = 3 - nuevosErrores;
        if (intentosRestantes > 0) {
            await enviarMensaje(chatId, `💡 *Consejo:* Te quedan *${intentosRestantes}* ${intentosRestantes === 1 ? 'intento' : 'intentos'} antes de que te ayude con un audio explicativo. 🎧`);
        }
    }
}

// ===== Configuración de email =====
const emailConfig = {
    service: 'gmail',
    auth: {
        user: 'solucnet@gmail.com', // Cambiar por tu email
        pass: 'fvqw wsdt tcam zpdj'     // Cambiar por tu contraseña de aplicación
    }
};

const transporter = nodemailer.createTransport(emailConfig);

// Variables para control de notificaciones
let lastEmailSent = 0;
let whatsappDisconnectedSince = 0;
let connectionEmailSent = false; // Variable para controlar el envío único del correo de conexión
const EMAIL_INTERVAL = 5 * 60 * 1000; // 5 minutos en milisegundos
const TARGET_EMAIL = 'angelsalgadopalacios@gmail.com';

// Función para enviar email de conexión
async function sendConnectionEmail() {
    try {
        if (connectionEmailSent) {
            return; // Ya se envió el correo de conexión, no enviar de nuevo
        }
        
        await transporter.sendMail({
            from: emailConfig.auth.user,
            to: TARGET_EMAIL,
            subject: '✅ WhatsApp Bot Conectado - SOLUCNET',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #28a745; color: white; padding: 20px; text-align: center;">
                        <h1>✅ WhatsApp Bot Conectado</h1>
                    </div>
                    <div style="padding: 20px; background: #f8f9fa;">
                        <p><strong>Notificación:</strong> El bot de WhatsApp de SOLUCNET está ahora conectado y funcionando.</p>
                        <p><strong>Fecha de conexión:</strong> ${new Date().toLocaleString('es-ES')}</p>
                        <p><strong>Servidor:</strong> ${process.env.NODE_ENV || 'desarrollo'}</p>
                        
                        <div style="background: #d4edda; padding: 15px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #28a745;">
                            <strong>Estado:</strong> El sistema está listo para recibir mensajes.
                        </div>
                        
                        <p style="color: #6c757d; font-size: 12px;">
                            Este correo se envía solo una vez por sesión de conexión.
                        </p>
                    </div>
                </div>
            `
        });
        
        connectionEmailSent = true;
        registrarLog('📧 Email de conexión enviado exitosamente');
        console.log('📧 Notificación de conexión enviada por email');
        
    } catch (error) {
        registrarLog(`❌ Error enviando email de conexión: ${error.message}`);
        console.error('❌ Error enviando email de conexión:', error.message);
    }
}

// Función para enviar email de desconexión
async function sendDisconnectionEmail() {
    try {
        const now = Date.now();
        const disconnectedMinutes = Math.floor((now - whatsappDisconnectedSince) / 60000);
        
        await transporter.sendMail({
            from: emailConfig.auth.user,
            to: TARGET_EMAIL,
            subject: '🚨 WhatsApp Bot Desconectado - SOLUCNET',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #dc3545; color: white; padding: 20px; text-align: center;">
                        <h1>🚨 WhatsApp Bot Desconectado</h1>
                    </div>
                    <div style="padding: 20px; background: #f8f9fa;">
                        <p><strong>Alerta:</strong> El bot de WhatsApp de SOLUCNET está desconectado.</p>
                        <p><strong>Tiempo desconectado:</strong> ${disconnectedMinutes} minutos</p>
                        <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-ES')}</p>
                        <p><strong>Servidor:</strong> ${process.env.NODE_ENV || 'desarrollo'}</p>
                        
                        <div style="background: #fff3cd; padding: 15px; margin: 20px 0; border-radius: 5px;">
                            <strong>Acción requerida:</strong> Por favor, revisa la conexión del bot y reconéctalo si es necesario.
                        </div>
                        
                        <p style="color: #6c757d; font-size: 12px;">
                            Este correo se envía automáticamente cada 5 minutos mientras el bot esté desconectado.
                        </p>
                    </div>
                </div>
            `
        });
        
        console.log(`📧 Email de desconexión enviado a ${TARGET_EMAIL}`);
        lastEmailSent = now;
        
    } catch (error) {
        console.error('❌ Error enviando email:', error.message);
    }
}

// ===== Función para verificar validez de sesión =====
function verificarValidezSesion() {
    const sessionPath = '/root/whatsapp-chatbot/.wwebjs_auth/session-whatsapp-bot-session';
    const sessionExists = fs.existsSync(sessionPath);

    if (!sessionExists) {
        console.log('📂 [SESIÓN] No existe sesión guardada');
        return { valida: false, razon: 'no_existe' };
    }

    try {
        // Verificar si los archivos esenciales de la sesión están presentes
        const defaultPath = path.join(sessionPath, 'Default');
        const cookiesPath = path.join(defaultPath, 'Cookies');
        const localStoragePath = path.join(defaultPath, 'Local Storage');

        const archivosEsenciales = [cookiesPath];
        const archivosFaltantes = archivosEsenciales.filter(archivo => !fs.existsSync(archivo));

        if (archivosFaltantes.length > 0) {
            console.log(`📂 [SESIÓN] Archivos faltantes: ${archivosFaltantes.join(', ')}`);
            return { valida: false, razon: 'archivos_faltantes', faltantes: archivosFaltantes };
        }

        // Verificar el tamaño de la sesión (debe ser > 1MB para considerarse válida)
        const { execSync } = require('child_process');
        const sizeOutput = execSync(`du -s "${sessionPath}"`).toString();
        const sizeKB = parseInt(sizeOutput.split('\t')[0]);

        if (sizeKB < 1024) { // Menos de 1MB
            console.log(`📂 [SESIÓN] Tamaño insuficiente: ${sizeKB}KB (mínimo: 1024KB)`);
            return { valida: false, razon: 'tamaño_insuficiente', tamaño: sizeKB };
        }

        console.log(`📂 [SESIÓN] Sesión válida: ${sizeKB}KB`);
        return { valida: true, tamaño: sizeKB };

    } catch (error) {
        console.log(`📂 [SESIÓN] Error verificando sesión: ${error.message}`);
        return { valida: false, razon: 'error_verificacion', error: error.message };
    }
}

// ===== Inicialización del cliente optimizada =====
let client;
let io; // Socket.io instance para comunicación en tiempo real

// Función helper para emitir actualizaciones de chats via WebSocket
let emitirChatsDebounceTimer = null;
function emitirActualizacionChats() {
    if (!io) return;

    // Debounce: solo emitir cada 2 segundos como máximo
    if (emitirChatsDebounceTimer) {
        clearTimeout(emitirChatsDebounceTimer);
    }

    emitirChatsDebounceTimer = setTimeout(() => {
        try {
            // Obtener todos los chats activos
            const allChats = Array.from(chatsActivos.values())
                .filter(chat => {
                    if (chat.id.includes('@g.us')) return false;
                    if (chatsFinalizados.has(chat.id)) return false;
                    return true;
                })
                .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
                .slice(0, 50);

            const chatsWithMessages = allChats.map(chat => {
                const modoActual = obtenerModoChat(chat.id);
                const cachedMessages = mensajesChat.get(chat.id) || [];

                return {
                    id: chat.id,
                    name: chat.name || 'Sin nombre',
                    lastActivity: chat.lastActivity,
                    lastMessage: chat.lastMessage || '',
                    messagesCount: cachedMessages.length,
                    unreadCount: chat.unreadCount || 0,
                    mode: modoActual,
                    pendiente: chat.pendiente || false,
                    recentMessages: cachedMessages.slice(-5).reverse()
                };
            });

            // Emitir a todos los clientes conectados
            io.emit('chats-update', {
                success: true,
                chats: chatsWithMessages,
                totalChats: chatsWithMessages.length,
                totalMessages: chatsWithMessages.reduce((total, chat) => total + chat.messagesCount, 0),
                timestamp: new Date().toISOString()
            });

            console.log(`📡 [SOCKET.IO] Actualización emitida: ${chatsWithMessages.length} chats`);
        } catch (error) {
            console.error('❌ [SOCKET.IO] Error emitiendo actualización de chats:', error);
        }
    }, 2000); // Debounce de 2 segundos
}

async function iniciarCliente() {
    console.log('🔍 [DEBUG] Entrando a iniciarCliente()');

    // Verificar validez de sesión antes de iniciar
    const sessionCheck = verificarValidezSesion();
    console.log(`📂 [SESIÓN] Estado: ${sessionCheck.valida ? 'VÁLIDA' : 'INVÁLIDA'} - ${sessionCheck.razon || 'OK'}`);

    // Si la sesión es inválida, limpiarla
    if (!sessionCheck.valida && ['archivos_faltantes', 'tamaño_insuficiente'].includes(sessionCheck.razon)) {
        console.log('🗑️ [SESIÓN] Limpiando sesión inválida antes de iniciar...');
        borrarSesion();
    }

    // Cargar datos persistidos al iniciar
    if (!whatsappListo) {
        cargarEstados();
    }

    // Verificar cooldown para evitar reinicios muy rápidos
    const ahora = Date.now();
    if (ahora - ultimoIntento < COOLDOWN_INICIAL) {
        const tiempoRestante = Math.ceil((COOLDOWN_INICIAL - (ahora - ultimoIntento)) / 1000);
        console.log(`⏳ [COOLDOWN] Esperando ${tiempoRestante}s antes de reintentar inicialización`);
        return;
    }

    if (clienteIniciando) {
        console.log('🔄 [DEBUG] Cliente ya está iniciando, se evita duplicar.');
        return;
    }

    console.log('🔍 [DEBUG] Estableciendo clienteIniciando = true');
    ultimoIntento = ahora;
    clienteIniciando = true;
    console.log('🔍 [DEBUG] Flag establecido, ahora intentando crear cliente...');

    try {
        registrarLog('🔍 [DEBUG] Entrando al bloque try para crear cliente');
        if (client) {
            try {
                registrarLog('Cerrando cliente anterior...');
                await client.destroy();
                registrarLog('✅ Cliente anterior cerrado');
            } catch (cerrarErr) {
                registrarLog(`❌ Error cerrando cliente anterior: ${cerrarErr.message}`);
            }
        } else {
            registrarLog('🔍 [DEBUG] No hay cliente anterior para cerrar');
        }

        // Limpiar procesos de Chrome huérfanos y archivos de bloqueo
        const lockFilePath = '/root/whatsapp-chatbot/.wwebjs_auth/session-whatsapp-bot-session/SingletonLock';
        try {
            // Matar procesos de Chrome huérfanos
            const { execSync } = require('child_process');
            try {
                execSync('pkill -9 -f "chrome.*whatsapp-bot-session"', { stdio: 'ignore' });
                registrarLog('🧹 [DEBUG] Procesos de Chrome huérfanos eliminados');
                // Esperar un momento para que los procesos terminen
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (killErr) {
                // Ignorar error si no hay procesos para matar
            }

            // Eliminar archivo de bloqueo
            if (fs.existsSync(lockFilePath)) {
                fs.unlinkSync(lockFilePath);
                registrarLog('🔓 [DEBUG] Archivo SingletonLock eliminado');
            }
        } catch (lockErr) {
            registrarLog(`⚠️ [DEBUG] No se pudo limpiar recursos: ${lockErr.message}`);
        }

        registrarLog('🔍 [DEBUG] Creando nuevo cliente...');
        client = new Client({
            authStrategy: new LocalAuth({
                clientId: "whatsapp-bot-session",
                dataPath: "/root/whatsapp-chatbot/.wwebjs_auth"
            }),
            takeoverOnConflict: false,
            takeoverTimeoutMs: 60000,  // Esperar 60 segundos antes de tomar control
            authTimeoutMs: 120000,     // Esperar 120 segundos para autenticación
            restartOnAuthFail: false,  // No reiniciar automáticamente en fallo de auth
            puppeteer: {
                headless: 'new',
                executablePath: '/usr/bin/google-chrome-stable',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-default-apps',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-blink-features=AutomationControlled',
                    // Flags adicionales para mayor estabilidad
                    '--disable-breakpad',
                    '--disable-crash-reporter',
                    '--disable-hang-monitor',
                    '--disable-ipc-flooding-protection',
                    '--disable-renderer-backgrounding',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-client-side-phishing-detection',
                    '--disable-popup-blocking',
                    '--disable-prompt-on-repost',
                    '--js-flags=--max-old-space-size=512',
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                    '--force-color-profile=srgb',
                    '--enable-features=NetworkService,NetworkServiceInProcess'
                ],
                timeout: 120000,
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false
            },
            // Usar versión local para evitar problemas de compatibilidad
            webVersionCache: {
                type: 'local'
            }
        });
        registrarLog('✅ [DEBUG] Cliente creado exitosamente');

        // ===== HANDLERS PARA EVENTOS DE CRASH DE PUPPETEER =====
        // Monitorear el navegador Puppeteer para detectar crashes
        if (client.pupBrowser) {
            client.pupBrowser.on('disconnected', async () => {
                console.log('🚨 [PUPPETEER] Navegador desconectado inesperadamente');
                if (whatsappListo) {
                    await reiniciarClientePorCrash('puppeteer_browser_disconnected');
                }
            });

            // Monitorear la página para detectar crashes
            try {
                const pages = await client.pupBrowser.pages();
                if (pages && pages.length > 0) {
                    const page = pages[0];

                    page.on('error', async (error) => {
                        console.log(`🚨 [PUPPETEER PAGE] Error en página: ${error.message}`);
                        if (whatsappListo) {
                            await reiniciarClientePorCrash('puppeteer_page_error');
                        }
                    });

                    page.on('close', async () => {
                        console.log('🚨 [PUPPETEER PAGE] Página cerrada inesperadamente');
                        if (whatsappListo && !clienteIniciando) {
                            await reiniciarClientePorCrash('puppeteer_page_closed');
                        }
                    });

                    console.log('✅ [PUPPETEER] Handlers de crash instalados correctamente');
                }
            } catch (pageErr) {
                console.log(`⚠️ [PUPPETEER] No se pudieron instalar handlers de página: ${pageErr.message}`);
            }
        }

        client.on('qr', qr => {
            try {
                registrarLog('🔍 [QR DEBUG] Evento QR disparado');
                registrarLog(`🔍 [QR REAL] ${qr}`);
                qrcode.generate(qr, { small: true });
                registrarLog('🔍 [QR DEBUG] QR generado en consola');
                registrarLog('Escanea el QR para iniciar sesion');
                // Guardar QR para API
                global.currentQR = qr;
                registrarLog(`🔍 [QR DEBUG] QR guardado en global: ${qr ? 'SÍ' : 'NO'}`);
            } catch (error) {
                registrarLog(`❌ [QR ERROR] Error en evento QR: ${error.message}`);
            }
        });

        // Evento cuando carga la sesión existente
        client.on('loading_screen', (percent, message) => {
            registrarLog(`📱 [LOADING] ${message} - ${percent}%`);
        });

        // Evento cuando el QR es escaneado exitosamente
        client.on('authenticated', () => {
            registrarLog('🔐 QR escaneado exitosamente - Autenticando...');
            global.currentQR = null; // Limpiar QR después de escanear
        });

        // Evento de fallo de autenticación
        client.on('auth_failure', (msg) => {
            registrarLog(`❌ Fallo de autenticación: ${msg}. Eliminando sesión y reiniciando...`);
            global.currentQR = null;
            clienteIniciando = false;

            // Borrar sesión corrupta y regenerar
            setTimeout(() => {
                borrarSesion();
                setTimeout(iniciarCliente, 3000);
            }, 2000);
        });

        // Evento de carga de sesión
        client.on('loading_screen', (percent, message) => {
            registrarLog(`📱 Cargando WhatsApp: ${percent}% - ${message}`);
        });

        client.on('ready', async () => {
            whatsappListo = true;
            clienteIniciando = false;
            // Resetear variables de control de email
            whatsappDisconnectedSince = 0;
            lastEmailSent = 0;
            // Resetear contador de fallos "Target closed"
            targetClosedFailures = 0;
            // Limpiar QR cuando se conecta exitosamente
            global.currentQR = null;
            registrarLog('✅ Cliente de WhatsApp listo');
            console.log('✅ WhatsApp conectado - notificaciones de email pausadas');

            // Proteger la página de Puppeteer contra cierres accidentales
            try {
                if (client.pupPage) {
                    // Prevenir que la página se cierre
                    client.pupPage.on('close', () => {
                        console.log('⚠️ [PUPPETEER] Página intentó cerrarse - esto puede causar problemas');
                    });

                    // Detectar si la página se desconecta
                    client.pupPage.on('error', (error) => {
                        console.log(`⚠️ [PUPPETEER] Error en página: ${error.message}`);
                    });

                    console.log('✅ [PUPPETEER] Protecciones de página activadas');
                }
            } catch (err) {
                console.log(`⚠️ [PUPPETEER] No se pudo configurar protección de página: ${err.message}`);
            }

            // ===== RESTAURAR ESTADO DE SINCRONIZACIÓN =====
            // Esto permite que la sincronización continúe después de reinicios del servidor
            try {
                await chatHistoryRoutes.restaurarEstadoSincronizacion();
                console.log('✅ Estado de sincronización restaurado desde base de datos');
            } catch (err) {
                console.log(`⚠️  No se pudo restaurar estado de sincronización: ${err.message}`);
            }

            // ===== RESTAURAR MODOS DE CHAT (HUMANO/BOT) =====
            // Restaurar modos de chat desde base de datos
            try {
                const resultado = await restaurarModosChat();
                console.log(`✅ Modos de chat restaurados: ${resultado.humano} humano, ${resultado.bot} bot`);
            } catch (err) {
                console.log(`⚠️  No se pudo restaurar modos de chat: ${err.message}`);
            }

            // Iniciar sincronización automática de mensajes
            iniciarSincronizacionAutomatica();

            // Iniciar procesador de cola de mensajes API desde BD
            iniciarProcesadorColaAPI();

            // Enviar correo de conexión
            await sendConnectionEmail();

            // Recuperar chats activos y limpiar grupos/estados para optimizar memoria
            try {
                const chats = await client.getChats();
                console.log(`🔎 [DEBUG getChats] Obtenidos ${chats.length} chats de WhatsApp`);
                let chatsLimpios = 0;
                let chatsRecuperados = 0;
                let chatsOmitidosPorFecha = 0;

                // Calcular inicio del día actual
                const hoy = new Date();
                hoy.setHours(0, 0, 0, 0);
                const inicioDia = hoy.getTime();

                // Leer chats pendientes del archivo ANTES del loop
                console.log(`📂 [DEBUG RECUPERACIÓN] Leyendo chats pendientes de: ${ESTADOS_FILE}`);
                let chatsPendientesEnJSON = new Set();
                try {
                    if (fs.existsSync(ESTADOS_FILE)) {
                        const savedData = JSON.parse(fs.readFileSync(ESTADOS_FILE, 'utf8'));
                        if (savedData.chatsActivos) {
                            for (const [chatId, data] of Object.entries(savedData.chatsActivos)) {
                                if (data.pendiente === true) {
                                    chatsPendientesEnJSON.add(chatId);
                                }
                            }
                            console.log(`📋 [RECUPERACIÓN] ${chatsPendientesEnJSON.size} chats marcados como pendientes en archivo`);
                        }
                    }
                } catch (error) {
                    console.error('❌ [RECUPERACIÓN] Error leyendo chats pendientes del archivo:', error.message);
                }

                // Crear conexión a BD para consultar modos guardados
                let conexionDB = null;
                try {
                    conexionDB = await mysql.createConnection({
                        host: process.env.DB_SYSTEM_HOST,
                        user: process.env.DB_SYSTEM_USER,
                        password: process.env.DB_SYSTEM_PASSWORD,
                        database: process.env.DB_SYSTEM_DATABASE
                    });
                } catch (error) {
                    console.error('❌ [RECUPERACIÓN] Error conectando a BD para recuperar modos:', error.message);
                }

                for (const chat of chats) {
                    // Recuperar chats individuales activos
                    const chatId = chat.id._serialized || chat.id;
                    if (chatId.includes('@c.us') && !chatId.includes('@g.us')) {
                        // Skip chats que han sido finalizados/limpiados
                        if (chatsFinalizados.has(chatId)) {
                            console.log(`🚫 [RECUPERACIÓN] Chat ${chatId} omitido por estar finalizado`);
                            continue;
                        }

                        // Verificar fecha del último mensaje
                        let lastMessageTimestamp = 0;
                        if (chat.lastMessage && chat.lastMessage.timestamp) {
                            lastMessageTimestamp = chat.lastMessage.timestamp * 1000;
                        }

                        // PRIORIDAD 1: Si está marcado como pendiente en JSON, SIEMPRE recuperar (sin importar fecha)
                        const estaPendienteEnJSON = chatsPendientesEnJSON.has(chatId);

                        if (!estaPendienteEnJSON && lastMessageTimestamp < inicioDia) {
                            // Solo aplicar filtro de fecha si NO está pendiente en JSON
                            // Log solo para los primeros 5 chats omitidos para no saturar logs
                            if (chatsOmitidosPorFecha < 5) {
                                console.log(`📅 [RECUPERACIÓN] Chat ${chatId} omitido - última actividad: ${new Date(lastMessageTimestamp).toLocaleString()}`);
                            }
                            chatsOmitidosPorFecha++;
                            continue;
                        }

                        if (estaPendienteEnJSON) {
                            console.log(`🔥 [RECUPERACIÓN PRIORITARIA] Chat ${chatId} PENDIENTE en JSON - recuperando SIN filtro de fecha`);
                        }

                        const numero = chatId.replace('@c.us', '');
                        const nombre = chat.name || `+${numero}`;

                        // Verificar si ya existe información guardada de este chat (consultar archivo directamente)
                        let pendienteValue = true; // Por defecto, marcar como pendiente
                        try {
                            if (fs.existsSync(ESTADOS_FILE)) {
                                const savedData = JSON.parse(fs.readFileSync(ESTADOS_FILE, 'utf8'));
                                if (savedData.chatsActivos && savedData.chatsActivos[chatId]) {
                                    pendienteValue = savedData.chatsActivos[chatId].pendiente;
                                    console.log(`🔍 [RECUPERACIÓN] Chat ${chatId} estado guardado: pendiente=${pendienteValue}`);
                                }
                            }
                        } catch (error) {
                            console.error(`❌ [RECUPERACIÓN] Error leyendo estado de ${chatId}:`, error.message);
                        }

                        // IMPORTANTE: Priorizar modo del archivo JSON sobre BD
                        let modoChat = modosChat.get(chatId) || 'bot'; // Primero verificar en modosChat (cargado del JSON)

                        // Solo consultar BD si NO existe en modosChat
                        if (!modosChat.has(chatId) && conexionDB) {
                            try {
                                const [rows] = await conexionDB.execute(
                                    'SELECT modo_chat FROM chat_sync_status WHERE numero_telefono = ?',
                                    [numero]
                                );
                                if (rows.length > 0 && rows[0].modo_chat) {
                                    modoChat = rows[0].modo_chat;
                                    console.log(`🔍 [RECUPERACIÓN] Chat ${chatId} modo recuperado de BD: ${modoChat}`);
                                } else {
                                    console.log(`✅ [RECUPERACIÓN] Chat ${chatId} usando modo del archivo JSON: ${modoChat}`);
                                }
                            } catch (error) {
                                console.error(`❌ [RECUPERACIÓN] Error consultando modo de ${chatId}:`, error.message);
                            }
                        } else if (modosChat.has(chatId)) {
                            console.log(`✅ [RECUPERACIÓN] Chat ${chatId} usando modo del archivo JSON: ${modoChat}`);
                        }

                        chatsActivos.set(chatId, {
                            id: chatId,
                            phone: numero,
                            name: nombre,
                            lastMessage: 'Chat recuperado tras reinicio',
                            lastActivity: lastMessageTimestamp, // Usar timestamp real del último mensaje
                            unreadCount: chat.unreadCount || 0,
                            mode: modoChat,
                            pendiente: pendienteValue // Respetar estado guardado, por defecto true para chats nuevos
                        });

                        // Eliminar de chatsFinalizados si estaba allí para permitir recuperación
                        if (chatsFinalizados.has(chatId)) {
                            chatsFinalizados.delete(chatId);
                            console.log(`🔄 [RECUPERACIÓN] Chat ${chatId} eliminado de chatsFinalizados para permitir recuperación`);
                        }

                        // Inicializar mensajes vacíos si no existen
                        if (!mensajesChat.has(chatId)) {
                            mensajesChat.set(chatId, []);
                        }

                        // Log del estado de recuperación
                        if (pendienteValue === false) {
                            console.log(`🔒 [RECUPERACIÓN] Chat ${chatId} recuperado con pendiente: false (desmarcado previamente)`);
                        }
                        if (modoChat === 'humano') {
                            console.log(`👤 [RECUPERACIÓN] Chat ${chatId} recuperado en modo HUMANO`);
                        }

                        chatsRecuperados++;
                    }
                    // DESHABILITADO: No eliminar chats de grupos
                    // else if (chatId.includes('@g.us') || chatId.includes('status@broadcast')) {
                    //     try {
                    //         await chat.delete();
                    //         chatsLimpios++;
                    //     } catch (error) {
                    //         // Ignorar errores al eliminar chats
                    //         console.log(`No se pudo eliminar chat ${chatId}: ${error.message}`);
                    //     }
                    // }
                }

                // Cerrar conexión a BD
                if (conexionDB) {
                    try {
                        await conexionDB.end();
                    } catch (error) {
                        console.error('❌ [RECUPERACIÓN] Error cerrando conexión a BD:', error.message);
                    }
                }

                if (chatsRecuperados > 0 || chatsOmitidosPorFecha > 0) {
                    const mensajeLog = `🔄 Se recuperaron ${chatsRecuperados} chats activos del día actual tras reinicio (${chatsOmitidosPorFecha} omitidos por fecha)`;
                    console.log(mensajeLog);
                    registrarLog(mensajeLog);
                }
                if (chatsLimpios > 0) {
                    registrarLog(`🧹 Se limpiaron ${chatsLimpios} chats de grupos y estados para optimizar rendimiento`);
                }

                // NUEVO: Cargar chats adicionales desde estados_chat.json que no estén en WhatsApp
                console.log(`📂 [RECUPERACIÓN JSON] Cargando chats desde ${ESTADOS_FILE}...`);
                let chatsCargadosDesdeJSON = 0;
                try {
                    if (fs.existsSync(ESTADOS_FILE)) {
                        const savedData = JSON.parse(fs.readFileSync(ESTADOS_FILE, 'utf8'));
                        if (savedData.chatsActivos) {
                            for (const [chatId, chatData] of Object.entries(savedData.chatsActivos)) {
                                // Solo cargar chats individuales (no grupos)
                                if (!chatId.includes('@c.us') || chatId.includes('@g.us')) {
                                    continue;
                                }

                                // Skip si ya está en chatsActivos
                                if (chatsActivos.has(chatId)) {
                                    continue;
                                }

                                // IMPORTANTE: Si el chat está en chatsActivos del archivo,
                                // eliminarlo de chatsFinalizados (prioridad al archivo)
                                if (chatsFinalizados.has(chatId)) {
                                    chatsFinalizados.delete(chatId);
                                    console.log(`🔄 [RECUPERACIÓN JSON] Chat ${chatId} removido de finalizados para recuperación`);
                                }

                                // Cargar el chat desde el archivo
                                // IMPORTANTE: Priorizar modo de modosChat (ya cargado del JSON) sobre chatData.mode
                                const modoRecuperado = modosChat.get(chatId) || chatData.mode || 'bot';
                                console.log(`📥 [RECUPERACIÓN JSON] Cargando chat ${chatId} desde archivo (modo: ${modoRecuperado})`);
                                chatsActivos.set(chatId, {
                                    id: chatId,
                                    phone: chatData.phone || chatId.replace('@c.us', ''),
                                    name: chatData.name || `+${chatId.replace('@c.us', '')}`,
                                    lastMessage: chatData.lastMessage || 'Chat recuperado desde archivo',
                                    lastActivity: chatData.lastActivity || Date.now(),
                                    unreadCount: chatData.unreadCount || 0,
                                    mode: modoRecuperado,
                                    pendiente: chatData.pendiente !== undefined ? chatData.pendiente : true
                                });

                                // Inicializar mensajes vacíos si no existen
                                if (!mensajesChat.has(chatId)) {
                                    mensajesChat.set(chatId, []);
                                }

                                chatsCargadosDesdeJSON++;
                            }

                            if (chatsCargadosDesdeJSON > 0) {
                                const mensajeLog = `📂 [RECUPERACIÓN JSON] ${chatsCargadosDesdeJSON} chats adicionales cargados desde archivo`;
                                console.log(mensajeLog);
                                registrarLog(mensajeLog);
                            }
                        }
                    }
                } catch (error) {
                    console.error('❌ [RECUPERACIÓN JSON] Error cargando chats desde archivo:', error.message);
                }
            } catch (error) {
                registrarLog(`⚠️ Error procesando chats: ${error.message}`);
            }

            // Agregar delay de estabilización después de reinicios
            const ahora = Date.now();
            const tiempoDesdeUltimoReinicio = ahora - ultimoReinicio;

            if (ultimoReinicio > 0 && tiempoDesdeUltimoReinicio < 30000) {
                // Fue un reinicio, esperar 15 segundos adicionales para estabilización
                console.log('⏳ [ESTABILIZACIÓN] Esperando 15 segundos para que WhatsApp se estabilice completamente...');
                setTimeout(() => {
                    whatsappEstabilizado = true;
                    console.log('✅ [ESTABILIZACIÓN] WhatsApp completamente estabilizado y listo para enviar archivos');
                }, 15000);
            } else {
                // Inicio normal, marcar como estabilizado inmediatamente
                whatsappEstabilizado = true;
                console.log('✅ [ESTABILIZACIÓN] WhatsApp listo para enviar archivos');
            }

            // Sistema de heartbeat desactivado para evitar conflictos de reconexión
            // const heartbeatInterval = setInterval(async () => {
            //     try {
            //         if (client && client.info) {
            //             await client.getState();
            //             console.log('💓 [HEARTBEAT] Conexión verificada');
            //         }
            //     } catch (error) {
            //         console.error(`💔 [HEARTBEAT] Error de conexión: ${error.message}`);
            //         clearInterval(heartbeatInterval);
            //         if (!clienteIniciando && whatsappListo) {
            //             console.log('🔄 [HEARTBEAT] Iniciando reconexión por fallo detectado');
            //             whatsappListo = false;
            //             setTimeout(iniciarCliente, 3000);
            //         }
            //     }
            // }, 30000); // Verificar cada 30 segundos

            // Heartbeat desactivado - no necesita limpieza
            // client.on('disconnected', () => {
            //     if (heartbeatInterval) {
            //         clearInterval(heartbeatInterval);
            //     }
            // });
        });

        client.on('disconnected', (reason) => {
            whatsappListo = false;
            connectionEmailSent = false; // Resetear para permitir nuevo correo de conexión

            console.log(`🔌 [DISCONNECT] Razón: ${reason}`);

            // Marcar momento de desconexión para emails
            if (whatsappDisconnectedSince === 0) {
                whatsappDisconnectedSince = Date.now();
                console.log('🚨 WhatsApp desconectado - iniciando notificaciones de email');

                // Enviar email de desconexión inmediatamente
                sendDisconnectionEmail().catch(err => {
                    console.log(`⚠️ Error enviando email de desconexión: ${err.message}`);
                });
            }

            // Limpiar QR al desconectarse
            global.currentQR = null;

            console.log(`🔌 [DESCONEXIÓN] Cliente desconectado: ${reason}`);
            registrarLog(`🔌 Cliente desconectado: ${reason}. Reiniciando...`);

            clienteIniciando = false;

            // Reconexión simple sin lógica compleja
            setTimeout(async () => {
                if (!clienteIniciando && !client) {
                    console.log('🔄 [RECONEXIÓN] Iniciando reconexión simple...');
                    await iniciarCliente();
                }
            }, 5000);
        });

        client.on('error', async (err) => {
            // Limpiar QR al haber error
            global.currentQR = null;
            registrarLog(`❌ Error de cliente: ${err.message}. Reiniciando sin eliminar sesión...`);

            // Marcar como no listo y enviar notificación
            if (whatsappListo) {
                whatsappListo = false;
                connectionEmailSent = false;

                // Marcar momento de desconexión para emails
                if (whatsappDisconnectedSince === 0) {
                    whatsappDisconnectedSince = Date.now();
                    console.log('🚨 WhatsApp desconectado por error - iniciando notificaciones de email');

                    // Enviar email de desconexión inmediatamente
                    sendDisconnectionEmail().catch(emailErr => {
                        console.log(`⚠️ Error enviando email de desconexión: ${emailErr.message}`);
                    });
                }
            }

            // Si el error es de "Session closed", limpiar procesos de Chrome
            if (err.message && (err.message.includes('Session closed') || err.message.includes('Protocol error'))) {
                registrarLog('⚠️ [SESSION CLOSED] Detectado error de sesión cerrada - Limpiando procesos...');
                try {
                    const { execSync } = require('child_process');
                    execSync('pkill -9 -f "chrome.*whatsapp-bot-session"', { stdio: 'ignore' });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (killErr) {
                    // Ignorar error
                }
            }

            // borrarSesion(); // Comentado para mantener sesión existente
            clienteIniciando = false;
            setTimeout(async () => {
                if (!clienteIniciando && !client) {
                    await iniciarCliente();
                }
            }, 5000);
        });

        // ===== Escucha de mensajes optimizada =====
        client.on('message', manejarMensaje);
        
        // Evento para mensajes enviados (outgoing messages)
        client.on('message_create', (msg) => {
            // Filtrar grupos, broadcasts, canales y comunidades antes de procesar
            if (msg.from.includes('status@broadcast') ||
                msg.from.includes('@g.us') ||
                msg.from.includes('@broadcast') ||
                msg.from.match(/^\d{15,}@/)) return; // Números muy largos suelen ser grupos/canales

            // Solo procesar mensajes enviados por nosotros
            if (msg.fromMe) {
                logOptimized(`📤 Mensaje enviado: ${msg.from} - ${msg.type}`, 'verbose');
                // Procesar como mensaje normal para que aparezca en el chat
                manejarMensaje(msg);
            }
        });

        registrarLog('🔄 [DEBUG] Llamando a client.initialize()...');
        await client.initialize().catch(async (err) => {
            registrarLog(`❌ [DEBUG] Error en client.initialize(): ${err.message}`);

            // Detectar error "Target closed" específicamente
            if (err.message && err.message.includes('Target closed')) {
                targetClosedFailures++;
                registrarLog(`⚠️ [TARGET CLOSED] Fallo #${targetClosedFailures} de ${MAX_TARGET_CLOSED_FAILURES}`);

                // Limpiar procesos Chrome siempre que ocurra Target closed
                registrarLog('🧹 [TARGET CLOSED] Limpiando procesos Chrome...');
                try {
                    const { execSync } = require('child_process');
                    execSync('pkill -9 -f "chrome.*whatsapp-bot-session"', { stdio: 'ignore' });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } catch (killErr) {
                    // Ignorar error
                }

                // Si alcanzamos el máximo de fallos, borrar sesión y regenerar
                if (targetClosedFailures >= MAX_TARGET_CLOSED_FAILURES) {
                    registrarLog('🚨 [TARGET CLOSED] Máximo de fallos alcanzado - Regenerando sesión...');
                    borrarSesion();
                    targetClosedFailures = 0; // Resetear contador
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } else {
                registrarLog(`Fallo al inicializar cliente: ${err.message}. Reiniciando sin eliminar sesión...`);
            }

            // Si el error es de procesos duplicados o SingletonLock, limpiar
            if (err.message && (err.message.includes('Failed to launch') || err.message.includes('SingletonLock'))) {
                registrarLog('⚠️ [BROWSER ERROR] Detectado error de procesos duplicados - Limpiando...');
                try {
                    const { execSync } = require('child_process');
                    execSync('pkill -9 -f "chrome.*whatsapp-bot-session"', { stdio: 'ignore' });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (killErr) {
                    // Ignorar error
                }
            }

            // Destruir cliente fallido antes de reintentar
            try {
                if (client) {
                    await client.destroy();
                    client = null;
                }
            } catch (destroyErr) {
                registrarLog(`⚠️ Error al destruir cliente fallido: ${destroyErr.message}`);
            }

            clienteIniciando = false;

            // Usar delay más largo si hay muchos fallos
            const retryDelay = targetClosedFailures >= 2 ? 10000 : 5000;
            registrarLog(`⏱️ [RETRY] Reintentando en ${retryDelay/1000} segundos...`);

            setTimeout(async () => {
                if (!clienteIniciando && !client) {
                    await iniciarCliente();
                }
            }, retryDelay);
        });
        registrarLog('✅ [DEBUG] client.initialize() completado sin errores');

        // Iniciar sincronización periódica de mensajes reales de WhatsApp
        if (whatsappListo) {
            iniciarSincronizacionAutomatica();
        }

    } catch (err) {
        registrarLog(`Excepción al iniciar cliente: ${err.message}. Reiniciando sin eliminar sesión...`);
        // Destruir cliente fallido antes de reintentar
        try {
            if (client) {
                await client.destroy();
                client = null;
            }
        } catch (destroyErr) {
            registrarLog(`⚠️ Error al destruir cliente fallido: ${destroyErr.message}`);
        }
        // borrarSesion(); // Comentado para mantener sesión existente
        clienteIniciando = false;
        setTimeout(async () => {
            if (!clienteIniciando && !client) {
                await iniciarCliente();
            }
        }, 5000);
    }
}


// ===== Sincronización automática de mensajes =====
function iniciarSincronizacionAutomatica() {
    console.log('🔄 [SYNC] Iniciando sincronización automática de mensajes cada 30 segundos');

    setInterval(async () => {
        if (!whatsappListo || !client) return;

        try {
            // Sincronizar solo chats activos (últimos 10 más recientes)
            const chatsParaSincronizar = Array.from(chatsActivos.values())
                .sort((a, b) => b.lastActivity - a.lastActivity)
                .slice(0, 10);

            for (const chatInfo of chatsParaSincronizar) {
                await sincronizarMensajesChat(chatInfo.id);
                // Pausa pequeña entre chats para no sobrecargar
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            console.error('❌ [SYNC] Error en sincronización automática:', error.message);
        }
    }, 30000); // Cada 30 segundos
}

async function sincronizarMensajesChat(chatId) {
    try {
        const whatsappChat = await client.getChatById(chatId);
        if (!whatsappChat) return;

        // Obtener solo los últimos 10 mensajes para no sobrecargar
        const messages = await whatsappChat.fetchMessages({ limit: 10 });
        const mensajesActuales = mensajesChat.get(chatId) || [];

        let mensajesNuevos = 0;

        for (const msg of messages) {
            const messageId = msg.id._serialized || msg.id;

            // Verificar si el mensaje ya existe en el cache
            const yaExiste = mensajesActuales.find(m =>
                m.id === messageId ||
                (Math.abs(m.timestamp - (msg.timestamp * 1000)) < 2000 && m.body === msg.body)
            );

            if (!yaExiste) {
                // Convertir mensaje y agregarlo al cache
                const mensajeConvertido = {
                    id: messageId,
                    body: msg.body || '[Media]',
                    fromMe: msg.fromMe,
                    timestamp: msg.timestamp * 1000,
                    type: msg.type,
                    mediaUrl: null
                };

                mensajesActuales.unshift(mensajeConvertido);
                mensajesNuevos++;
            }
        }

        if (mensajesNuevos > 0) {
            // Mantener solo los últimos 100 mensajes
            const mensajesOrdenados = mensajesActuales
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(-100);

            mensajesChat.set(chatId, mensajesOrdenados);
            console.log(`🔄 [SYNC] ${mensajesNuevos} mensajes nuevos sincronizados en ${chatId}`);
        }

    } catch (error) {
        // Error silencioso para no spam en logs
        if (error.message.includes('Chat not found')) {
            // Chat eliminado, remover del cache
            chatsActivos.delete(chatId);
            mensajesChat.delete(chatId);
        }
    }
}

// ===== Variables globales para control de rate limiting MEJORADO =====
const messageProcessingQueue = new Map(); // Cola de procesamiento por chat
const globalRateLimit = {
    lastProcessed: 0,
    messagesPerSecond: 0,
    maxPerSecond: 1, // REDUCIDO: Máximo 1 mensaje por segundo (comportamiento humano)
    messagesPerMinute: 0,
    maxPerMinute: 10, // REDUCIDO: Máximo 10 mensajes por minuto (comportamiento humano)
    mensajesConsecutivos: 0, // Contador para pausas humanas
    ultimaPausaLarga: Date.now()
};

// ===== SISTEMA DE COLA DE MENSAJES PENDIENTES =====
const colaMensajesPendientes = {
    cola: [], // Array de mensajes pendientes
    procesando: false, // Flag para evitar procesamiento concurrente
    maxCola: 1000, // Máximo de mensajes en cola
    stats: {
        encolados: 0,
        procesados: 0,
        rechazados: 0
    }
};

// Función para agregar mensaje a la cola
async function encolarMensaje(chatId, contenido, rutaImagen = null, esAPIExterna = false) {
    if (colaMensajesPendientes.cola.length >= colaMensajesPendientes.maxCola) {
        console.log(`❌ [COLA PENDIENTES] Cola llena (${colaMensajesPendientes.maxCola}). Mensaje rechazado.`);
        colaMensajesPendientes.stats.rechazados++;
        return false;
    }

    const mensajePendiente = {
        id: Date.now() + Math.random(),
        chatId: chatId,
        contenido: contenido,
        rutaImagen: rutaImagen,
        esAPIExterna: esAPIExterna,
        timestamp: Date.now(),
        intentos: 0
    };

    colaMensajesPendientes.cola.push(mensajePendiente);
    colaMensajesPendientes.stats.encolados++;

    console.log(`📥 [COLA PENDIENTES] Mensaje encolado. Cola: ${colaMensajesPendientes.cola.length} mensajes`);

    // Si es de API externa, también guardar en BD para persistencia
    if (esAPIExterna) {
        try {
            const tipoMensaje = rutaImagen ? (rutaImagen.includes('audio') ? 'audio' : 'image') : 'text';
            const mensaje = typeof contenido === 'string' ? contenido : '[Media]';

            await dbPool.execute(
                `INSERT INTO cola_mensajes_api (chat_id, mensaje, ruta_archivo, tipo_mensaje, estado, intentos)
                 VALUES (?, ?, ?, ?, 'pendiente', 0)`,
                [chatId, mensaje, rutaImagen || null, tipoMensaje]
            );

            console.log(`💾 [COLA BD] Mensaje de API guardado en BD para reintento persistente: ${chatId}`);
        } catch (error) {
            console.error(`❌ [COLA BD] Error guardando en BD: ${error.message}`);
            // Continuar aunque falle el guardado en BD
        }
    }

    return mensajePendiente.id;
}

// Función para procesar cola de mensajes pendientes
async function procesarColaPendientes() {
    if (colaMensajesPendientes.procesando) {
        console.log(`⏳ [COLA PENDIENTES] Ya hay un procesamiento en curso`);
        return;
    }

    if (colaMensajesPendientes.cola.length === 0) {
        return;
    }

    colaMensajesPendientes.procesando = true;
    console.log(`🔄 [COLA PENDIENTES] Iniciando procesamiento de ${colaMensajesPendientes.cola.length} mensajes pendientes`);

    while (colaMensajesPendientes.cola.length > 0) {
        const mensaje = colaMensajesPendientes.cola.shift();

        try {
            console.log(`📤 [COLA PENDIENTES] Procesando mensaje ${mensaje.id} para ${mensaje.chatId}`);

            // Intentar enviar el mensaje sin pasar por las verificaciones de pausa
            const exito = await enviarMensajeDirecto(
                mensaje.chatId,
                mensaje.contenido,
                mensaje.rutaImagen,
                mensaje.esAPIExterna
            );

            if (exito) {
                console.log(`✅ [COLA PENDIENTES] Mensaje ${mensaje.id} enviado exitosamente`);
                colaMensajesPendientes.stats.procesados++;
            } else {
                mensaje.intentos++;
                if (mensaje.intentos < 3) {
                    console.log(`⚠️ [COLA PENDIENTES] Mensaje ${mensaje.id} falló. Reintento ${mensaje.intentos}/3`);
                    colaMensajesPendientes.cola.push(mensaje); // Volver a encolar
                } else {
                    console.log(`❌ [COLA PENDIENTES] Mensaje ${mensaje.id} descartado después de 3 intentos`);
                    colaMensajesPendientes.stats.rechazados++;
                }
            }

            // Pequeño delay entre mensajes de la cola (200ms - reducido de 500ms)
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (error) {
            console.error(`❌ [COLA PENDIENTES] Error procesando mensaje ${mensaje.id}:`, error.message);
            mensaje.intentos++;
            if (mensaje.intentos < 3) {
                colaMensajesPendientes.cola.push(mensaje);
            } else {
                colaMensajesPendientes.stats.rechazados++;
            }
        }
    }

    colaMensajesPendientes.procesando = false;
    console.log(`✅ [COLA PENDIENTES] Procesamiento completado. Stats:`, colaMensajesPendientes.stats);
}

// ===== PROCESADOR DE COLA API DESDE BASE DE DATOS =====
let procesadorColaAPIInterval = null;

async function procesarColaAPIBD() {
    try {
        if (!whatsappListo) {
            return; // No procesar si WhatsApp no está listo
        }

        // Obtener mensajes pendientes que no hayan excedido el límite de reintentos
        const [mensajes] = await dbPool.execute(
            `SELECT * FROM cola_mensajes_api
             WHERE estado = 'pendiente' AND intentos < max_intentos
             ORDER BY fecha_creacion ASC
             LIMIT 10`
        );

        if (mensajes.length > 0) {
            console.log(`📋 [COLA API BD] Procesando ${mensajes.length} mensajes pendientes de la BD`);

            for (const msg of mensajes) {
                try {
                    // Marcar como procesando
                    await dbPool.execute(
                        `UPDATE cola_mensajes_api SET estado = 'procesando', intentos = intentos + 1 WHERE id = ?`,
                        [msg.id]
                    );

                    // Intentar enviar el mensaje
                    const exito = await enviarMensajeDirecto(
                        msg.chat_id,
                        msg.mensaje,
                        msg.ruta_archivo,
                        true // esAPIExterna
                    );

                    if (exito) {
                        // Marcar como enviado
                        await dbPool.execute(
                            `UPDATE cola_mensajes_api SET estado = 'enviado', fecha_envio = NOW() WHERE id = ?`,
                            [msg.id]
                        );
                        console.log(`✅ [COLA API BD] Mensaje ${msg.id} enviado exitosamente a ${msg.chat_id}`);
                    } else {
                        // Verificar si se excedió el límite de intentos
                        if (msg.intentos + 1 >= msg.max_intentos) {
                            await dbPool.execute(
                                `UPDATE cola_mensajes_api SET estado = 'error', error_mensaje = 'Máximo de intentos alcanzado' WHERE id = ?`,
                                [msg.id]
                            );
                            console.log(`❌ [COLA API BD] Mensaje ${msg.id} descartado después de ${msg.max_intentos} intentos`);
                        } else {
                            // Volver a pendiente para siguiente intento
                            await dbPool.execute(
                                `UPDATE cola_mensajes_api SET estado = 'pendiente' WHERE id = ?`,
                                [msg.id]
                            );
                            console.log(`⚠️ [COLA API BD] Mensaje ${msg.id} falló. Reintento ${msg.intentos + 1}/${msg.max_intentos}`);
                        }
                    }

                    // Delay entre mensajes
                    await new Promise(resolve => setTimeout(resolve, 300));

                } catch (error) {
                    console.error(`❌ [COLA API BD] Error procesando mensaje ${msg.id}:`, error.message);
                    await dbPool.execute(
                        `UPDATE cola_mensajes_api SET estado = 'pendiente', error_mensaje = ? WHERE id = ?`,
                        [error.message, msg.id]
                    );
                }
            }
        }

    } catch (error) {
        console.error(`❌ [COLA API BD] Error en procesador:`, error.message);
    }
}

function iniciarProcesadorColaAPI() {
    try {
        if (procesadorColaAPIInterval) {
            clearInterval(procesadorColaAPIInterval);
        }

        // Procesar cada 30 segundos
        procesadorColaAPIInterval = setInterval(() => {
            procesarColaAPIBD();
        }, 30000);

        // Ejecutar inmediatamente la primera vez
        setTimeout(() => procesarColaAPIBD(), 5000);

        console.log('✅ [COLA API BD] Procesador iniciado - revisando cada 30 segundos');
    } catch (error) {
        console.error('❌ [ERROR] Error en iniciarProcesadorColaAPI:', error.message, error.stack);
    }
}

// ===== SISTEMA DE DEBOUNCING PARA MENSAJES RÁPIDOS =====
const userMessageDebounce = new Map(); // Almacena timers de debouncing por usuario
const DEBOUNCE_TIME = 500; // Esperar 500ms después del último mensaje antes de procesar (reducido de 2s)

function debounceUserMessage(chatId, msg) {
    // Si ya existe un timer para este usuario, cancelarlo
    if (userMessageDebounce.has(chatId)) {
        const existingTimer = userMessageDebounce.get(chatId);
        clearTimeout(existingTimer.timer);
        console.log(`⏱️ [DEBOUNCE] Usuario ${chatId} escribiendo... mensaje anterior cancelado`);
    }

    // Crear nuevo timer que se ejecutará solo si el usuario deja de escribir
    const timer = setTimeout(async () => {
        console.log(`✅ [DEBOUNCE] Usuario ${chatId} terminó de escribir. Procesando último mensaje...`);

        // IMPORTANTE: Verificar si el usuario está en modo humano ANTES de procesar
        const estadoActualizado = obtenerEstadoUsuario(chatId);
        if (estadoActualizado.enEsperaHumano) {
            console.log(`⚠️ [DEBOUNCE] Usuario ${chatId} está en modo humano - NO procesar mensaje del debounce`);
            userMessageDebounce.delete(chatId);
            return; // No procesar el mensaje si está en modo humano
        }

        userMessageDebounce.delete(chatId);
        await procesarMensajeReal(msg);
    }, DEBOUNCE_TIME);

    // Guardar el timer y el mensaje más reciente
    userMessageDebounce.set(chatId, {
        timer: timer,
        lastMessage: msg,
        timestamp: Date.now()
    });

    console.log(`⏳ [DEBOUNCE] Esperando ${DEBOUNCE_TIME}ms para procesar mensaje de ${chatId}...`);
}

// ===== SISTEMA DE MONITOREO DE SALUD DEL BOT =====
const botHealthMonitor = {
    erroresEnvio: 0,
    mensajesExitosos: 0,
    ultimoError: null,
    ultimoChequeo: Date.now(),
    estadoWhatsApp: 'UNKNOWN',
    alertasActivas: [],
    inicioSesion: Date.now(),
    mensajesChatbot: [] // Almacena últimos 50 mensajes del chatbot
};

function registrarErrorEnvio(error, chatId) {
    botHealthMonitor.erroresEnvio++;
    botHealthMonitor.ultimoError = {
        mensaje: error.message,
        chatId: chatId,
        timestamp: new Date().toISOString()
    };
    verificarTasaError();
}

function registrarEnvioExitoso() {
    botHealthMonitor.mensajesExitosos++;
    dailyMessageLimit.totalSent = (dailyMessageLimit.totalSent || 0) + 1;
}

function registrarMensajeChatbot(tipo, chatId, mensaje, nombre = '') {
    const maxMensajes = 50;
    const nuevoMensaje = {
        tipo: tipo, // 'entrante' o 'saliente'
        chatId: chatId,
        mensaje: mensaje.length > 100 ? mensaje.substring(0, 100) + '...' : mensaje,
        nombre: nombre,
        timestamp: new Date().toISOString()
    };

    botHealthMonitor.mensajesChatbot.unshift(nuevoMensaje);

    // Mantener solo los últimos 50 mensajes
    if (botHealthMonitor.mensajesChatbot.length > maxMensajes) {
        botHealthMonitor.mensajesChatbot = botHealthMonitor.mensajesChatbot.slice(0, maxMensajes);
    }
}

function verificarTasaError() {
    const totalMensajes = botHealthMonitor.erroresEnvio + botHealthMonitor.mensajesExitosos;
    if (totalMensajes < 10) return; // Necesita al menos 10 mensajes para calcular

    const tasaError = (botHealthMonitor.erroresEnvio / totalMensajes) * 100;

    if (tasaError > 10 && !botHealthMonitor.alertasActivas.includes('TASA_ERROR_ALTA')) {
        const alerta = {
            tipo: 'TASA_ERROR_ALTA',
            mensaje: `⚠️ ALERTA: Tasa de error en ${tasaError.toFixed(1)}% (>10%)`,
            timestamp: new Date().toISOString(),
            datos: { tasaError: tasaError.toFixed(1), totalMensajes }
        };
        botHealthMonitor.alertasActivas.push('TASA_ERROR_ALTA');
        console.error(alerta.mensaje);
        registrarLog(alerta.mensaje);
    }

    // Limpiar alerta si baja del umbral
    if (tasaError <= 8 && botHealthMonitor.alertasActivas.includes('TASA_ERROR_ALTA')) {
        botHealthMonitor.alertasActivas = botHealthMonitor.alertasActivas.filter(a => a !== 'TASA_ERROR_ALTA');
        console.log(`✅ ALERTA RESUELTA: Tasa de error normalizada (${tasaError.toFixed(1)}%)`);
    }
}

// ===================================================================
// FUNCIÓN DE MONITOREO AUTOMÁTICO DE ESTADO DE WHATSAPP
// ===================================================================
// Esta función se ejecuta automáticamente cada 2 minutos (línea 2201)
// PROPÓSITO:
//   - Monitorear el estado de conexión de WhatsApp periódicamente
//   - Actualizar la variable global 'whatsappListo' que usa la interfaz web
//   - Actualizar 'botHealthMonitor.estadoWhatsApp' para diagnósticos
//   - Detectar y alertar problemas de conexión (CONFLICT, TIMEOUT, etc.)
//
// IMPORTANTE: Esta función actualiza whatsappListo automáticamente.
// NO confundir con verificarEstadoClienteWhatsApp() (línea 3979)
// que es para validación bajo demanda en envíos de mensajes.
// ===================================================================
async function verificarEstadoWhatsApp() {
    try {
        if (!client) {
            botHealthMonitor.estadoWhatsApp = 'DISCONNECTED';
            whatsappListo = false;
            return;
        }

        // Si el cliente se está iniciando, no verificar estado para no interferir
        if (clienteIniciando) {
            return;
        }

        // Si whatsappListo es true, significa que está funcionando correctamente
        // aunque getState() pueda fallar temporalmente
        if (whatsappListo) {
            // Intentar obtener estado, pero si falla, asumir que sigue conectado
            try {
                const state = await Promise.race([
                    client.getState(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]);

                botHealthMonitor.estadoWhatsApp = state;

                // Actualizar whatsappListo basado en el estado real
                const estadosConectados = ['CONNECTED', 'OPENING', 'PAIRING'];
                const estaConectado = estadosConectados.includes(state);

                if (!estaConectado && state !== 'INITIALIZING') {
                    console.log(`🔄 [MONITOR] WhatsApp cambió a estado: ${state}`);
                    whatsappListo = false;
                }

                // Detectar posible bloqueo
                if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'TIMEOUT') {
                    if (!botHealthMonitor.alertasActivas.includes('WHATSAPP_PROBLEMA')) {
                        const alerta = `🚨 ALERTA CRÍTICA: WhatsApp en estado ${state}`;
                        botHealthMonitor.alertasActivas.push('WHATSAPP_PROBLEMA');
                        console.error(alerta);
                        registrarLog(alerta);
                    }
                } else if (state === 'CONNECTED') {
                    // Limpiar alerta si se reconecta
                    if (botHealthMonitor.alertasActivas.includes('WHATSAPP_PROBLEMA')) {
                        botHealthMonitor.alertasActivas = botHealthMonitor.alertasActivas.filter(a => a !== 'WHATSAPP_PROBLEMA');
                        console.log('✅ ALERTA RESUELTA: WhatsApp reconectado');
                    }
                }
            } catch (stateError) {
                // Si falla getState() pero whatsappListo es true, mantener el estado
                console.log('⚠️ [MONITOR] No se pudo obtener estado, pero WhatsApp sigue funcionando');
                botHealthMonitor.estadoWhatsApp = 'CONNECTED';
            }
        } else {
            // Si whatsappListo es false, intentar obtener el estado real CON PROTECCIÓN
            try {
                const state = await Promise.race([
                    client.getState(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                ]);

                botHealthMonitor.estadoWhatsApp = state;

                const estadosConectados = ['CONNECTED', 'OPENING', 'PAIRING'];
                const estaConectado = estadosConectados.includes(state);

                if (estaConectado) {
                    console.log('🔄 [MONITOR] WhatsApp conectado - actualizando whatsappListo a TRUE');
                    whatsappListo = true;
                }
            } catch (stateError) {
                // Si falla getState() y whatsappListo es false, marcar como ERROR
                console.log(`⚠️ [MONITOR] Error obteniendo estado (whatsappListo=false): ${stateError.message}`);
                botHealthMonitor.estadoWhatsApp = 'INITIALIZING';
            }
        }

        botHealthMonitor.ultimoChequeo = Date.now();
    } catch (error) {
        console.error(`❌ Error verificando estado WhatsApp: ${error.message}`);

        // Si whatsappListo es true, mantenerlo así porque el bot está funcionando
        if (!whatsappListo) {
            botHealthMonitor.estadoWhatsApp = 'ERROR';
        } else {
            // Está funcionando aunque getState() falle
            botHealthMonitor.estadoWhatsApp = 'CONNECTED';
            console.log('✅ [MONITOR] WhatsApp sigue funcionando (ignorando error de getState)');
        }
    }
}

// Verificar estado cada 2 minutos
setInterval(verificarEstadoWhatsApp, 120000);

// ===== PROCESADOR AUTOMÁTICO DE COLA DE MENSAJES PENDIENTES =====
// Se ejecuta cada 2 segundos para procesar mensajes encolados (reducido de 30s para respuestas más rápidas)
setInterval(async () => {
    if (colaMensajesPendientes.cola.length > 0 && whatsappListo) {
        console.log(`🔄 [AUTO-COLA] Procesamiento automático de cola (${colaMensajesPendientes.cola.length} mensajes)`);
        await procesarColaPendientes();
    }
}, 2000); // Cada 2 segundos (reducido de 30s)

// También procesar cola cuando WhatsApp se vuelva a conectar
let whatsappListoAnterior = false;
setInterval(async () => {
    if (whatsappListo && !whatsappListoAnterior && colaMensajesPendientes.cola.length > 0) {
        console.log(`🔄 [AUTO-COLA] WhatsApp reconectado. Procesando mensajes pendientes (${colaMensajesPendientes.cola.length})`);
        await procesarColaPendientes();
    }
    whatsappListoAnterior = whatsappListo;
}, 10000); // Cada 10 segundos

// ===== Función de entrada con debouncing =====
async function manejarMensaje(msg) {
    try {
        console.log(`🔍 [DEBUG MANEJAR] Mensaje recibido de ${msg.from}: "${msg.body}" | fromMe: ${msg.fromMe} | type: ${msg.type}`);

        // ===== SINCRONIZACIÓN AUTOMÁTICA: Guardar mensaje en historial =====
        // Esto se ejecuta de forma asíncrona sin bloquear el procesamiento del mensaje
        (async () => {
            try {
                const chat = await msg.getChat();
                await chatHistoryRoutes.guardarMensajeAutomatico(msg, chat, client);
            } catch (syncError) {
                // Silencioso - no afecta el procesamiento normal del mensaje
                console.error(`⚠️ [AUTO-SYNC] Error: ${syncError.message}`);
            }
        })();

        // ===== PROTECCIÓN 1: Filtros básicos =====
        if (msg.from.includes('status@broadcast') ||
            msg.from.includes('@g.us') ||
            msg.from.includes('@broadcast') ||
            msg.from.match(/^\d{15,}@/)) {
            console.log(`🚫 [DEBUG MANEJAR] Mensaje bloqueado por filtros básicos`);
            return; // Bloquear grupos, canales y comunidades
        }
        if (msg.from.includes('573025961131')) {
            console.log(`🚫 [DEBUG MANEJAR] Mensaje bloqueado - número específico 573025961131`);
            return;
        }
        if (msg.from.includes('105097933635741')) {
            console.log(`🚫 [DEBUG MANEJAR] Mensaje bloqueado - canal/comunidad 105097933635741`);
            return; // Bloquear canal/comunidad específica
        }

        // Normalizar chatId
        let chatId = msg.from;
        if (chatId.endsWith('@c.us')) {
            chatId = chatId.replace(/@c\.us$/, '') + '@c.us';
        } else if (chatId.endsWith('@lid')) {
            chatId = chatId.replace(/@lid$/, '') + '@lid';
        }

        console.log(`🔍 [DEBUG MANEJAR] chatId normalizado: ${chatId}`);

        // Si el mensaje es propio o está en modo humano, procesarlo inmediatamente sin debouncing
        const estado = obtenerEstadoUsuario(chatId);
        console.log(`🔍 [DEBUG MANEJAR] Estado usuario - enEsperaHumano: ${!!estado.enEsperaHumano}`);

        if (msg.fromMe || estado.enEsperaHumano) {
            console.log(`⚡ [DEBUG MANEJAR] Procesando inmediatamente (fromMe: ${msg.fromMe}, modoHumano: ${!!estado.enEsperaHumano})`);
            await procesarMensajeReal(msg);
            return;
        }

        // Para mensajes normales de usuarios, aplicar debouncing
        console.log(`⏳ [DEBUG MANEJAR] Aplicando debouncing para ${chatId}`);
        debounceUserMessage(chatId, msg);

    } catch (error) {
        registrarLog(`❌ [ERROR] Error en manejarMensaje: ${error.message}`);
        console.error(`Error completo:`, error);
    }
}

// ===== Función principal de procesamiento de mensajes con protecciones =====
async function procesarMensajeReal(msg) {
    // ===== TIMEOUT DE 10 SEGUNDOS =====
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout de 10 segundos alcanzado')), 10000);
    });

    try {
        await Promise.race([
            procesarMensajeRealInterno(msg),
            timeoutPromise
        ]);
    } catch (error) {
        if (error.message === 'Timeout de 10 segundos alcanzado') {
            console.error(`⏱️ [TIMEOUT] Procesamiento de mensaje excedió 10 segundos para ${msg.from}`);
            registrarLog(`[TIMEOUT] Mensaje de ${msg.from} excedió tiempo límite de 10 segundos`);
        } else {
            registrarLog(`❌ [ERROR] Error procesando mensaje de ${msg.from}: ${error.message}`);
            registrarLog(`❌ [ERROR] Stack trace: ${error.stack}`);
            console.error(`Error completo:`, error);
        }
    }
}

async function procesarMensajeRealInterno(msg) {
    try {
        // ===== PROTECCIÓN 1: Filtros básicos =====
        if (msg.from.includes('status@broadcast') ||
            msg.from.includes('@g.us') ||
            msg.from.includes('@broadcast') ||
            msg.from.match(/^\d{15,}@/)) return; // Bloquear grupos, canales y comunidades
        if (msg.from.includes('573025961131')) return;
        if (msg.from.includes('105097933635741')) return; // Bloquear canal/comunidad específica

        // ===== PROTECCIÓN 2: Rate limiting global =====
        const now = Date.now();
        if (now - globalRateLimit.lastProcessed < 200) { // Mínimo 200ms entre mensajes
            console.log(`⏳ [RATE LIMIT] Mensaje retrasado para evitar sobrecarga`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Actualizar contadores de rate limiting
        if (now - globalRateLimit.lastProcessed < 1000) {
            globalRateLimit.messagesPerSecond++;
        } else {
            globalRateLimit.messagesPerSecond = 1;
        }

        if (now - globalRateLimit.lastProcessed < 60000) {
            globalRateLimit.messagesPerMinute++;
        } else {
            globalRateLimit.messagesPerMinute = 1;
        }

        // Verificar límites
        if (globalRateLimit.messagesPerSecond > globalRateLimit.maxPerSecond) {
            console.log(`🚫 [RATE LIMIT] Límite por segundo excedido, retrasando mensaje`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (globalRateLimit.messagesPerMinute > globalRateLimit.maxPerMinute) {
            console.log(`🚫 [RATE LIMIT] Límite por minuto excedido, pausando procesamiento`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        globalRateLimit.lastProcessed = now;

        // ===== PROTECCIÓN 3: Validar estructura del mensaje =====
        if (!msg.from) {
            console.log(`⚠️ [MENSAJE INVÁLIDO] Mensaje sin from recibido`);
            return;
        }
        
        // Permitir mensajes multimedia aunque no tengan texto
        if (!msg.body && !msg.hasMedia) {
            console.log(`⚠️ [MENSAJE INVÁLIDO] Mensaje sin body ni media recibido`);
            return;
        }
        
        // Si es mensaje propio, solo procesar si es para mostrar en el chat (no automático del sistema)
        if (msg.fromMe) {
            // Solo mostrar mensajes enviados por API o respuestas del bot
            console.log('📤 Procesando mensaje propio para mostrar en chat:', msg.body?.substring(0, 30));
        }

        // Normalizar chatId para la verificación de caché
        let chatId = msg.from;
        if (chatId.endsWith('@c.us')) {
            chatId = chatId.replace(/@c\.us$/, '') + '@c.us';
        } else if (chatId.endsWith('@lid')) {
            chatId = chatId.replace(/@lid$/, '') + '@lid';
        }

        // Verificar si este mensaje fue enviado por API (filtrar mensajes de API externa)
        if (esMensajeDeAPI(chatId, msg.body)) {
            logOptimized(`🚫 [FILTRADO] Mensaje de API filtrado: ${msg.body.substring(0, 50)}`, 'verbose');
            return; // Salir sin procesar
        }

        // VERIFICAR SI ESTÁ ESPERANDO RESPUESTA DE SOL
        const estadoUsuario = obtenerEstadoUsuario(chatId);
        if (estadoUsuario.esperandoRespuestaSol && !msg.fromMe) {
            console.log(`🤖 [SOL] Usuario ${chatId} respondió después del mensaje de Sol`);

            // IMPORTANTE: Actualizar chat activo para que aparezca en el panel web
            actualizarChatActivo(chatId, {
                body: msg.body || '[Media]',
                fromMe: false,
                hasMedia: msg.hasMedia || false
            });

            // Limpiar el flag de espera
            actualizarEstadoUsuario(chatId, {
                esperandoRespuestaSol: false
            });

            // Enviar menú apropiado según si el cliente está registrado o no
            if (estadoUsuario.clienteEncontrado && estadoUsuario.clienteEncontrado.cliente) {
                // Cliente registrado - Enviar menú de servicios
                const { cliente } = estadoUsuario.clienteEncontrado;
                await enviarMensaje(chatId, `👋 ¡Hola, ${cliente.nombre}! Bienvenido de nuevo. 😊\n\n✅ ESTADO: ${cliente.estado}\n\n💬 ¿En qué podemos ayudarte hoy?`);
                await enviarMensaje(chatId, `📋 *MENÚ DE SERVICIOS*\n\n1️⃣ 💰 Registrar pago (registro de plazos)\n\n2️⃣ 🔧 Soporte técnico (cambio de contraseña)\n\n3️⃣ 📊 Mi estado de cuenta (valor a cancelar y cuenta de pago)\n\n4️⃣ 🏠 Traslado de servicio\n\n5️⃣ ❌ Cancelar visita técnica generada\n\n#️⃣ ⬅️ Volver al menú principal`);
                actualizarEstadoUsuario(chatId, {
                    seguimiento: { paso: 'menu_usuario' }
                });
            } else {
                // Cliente no registrado - Enviar menú principal
                await mostrarMenuPrincipal(chatId);
            }

            registrarLog(`Sol envió menú a ${chatId} después de recibir respuesta del usuario`);
            return; // Salir después de enviar el menú
        }

        // VERIFICAR NÚMEROS OMITIDOS PRIMERO - ANTES DE CUALQUIER PROCESAMIENTO
        const numeroSinFormato = chatId.replace('@c.us', '').replace('@lid', '');
        
        try {
            const numeroOmitido = await verificarNumeroOmitidoConCache(numeroSinFormato);
            if (numeroOmitido) {
                registrarLog(`Número omitido detectado: ${numeroSinFormato} - Procesando en modo humano directo`);

                // Actualizar chat activo con el mensaje
                actualizarChatActivo(chatId, {
                    body: msg.body,
                    fromMe: false,
                    hasMedia: msg.hasMedia || false
                });

                // Verificar si ya está en modo humano
                const estado = obtenerEstadoUsuario(chatId);
                if (!estado.enEsperaHumano) {
                    // Intentar identificar al cliente primero antes de activar modo humano
                    const numeroTelefono = numeroSinFormato.startsWith('57') ? numeroSinFormato : '57' + numeroSinFormato;
                    const resultadoCliente = await consultarClientePorTelefono(numeroTelefono);

                    if (resultadoCliente) {
                        const { cliente, facturas, cuenta, bd } = resultadoCliente;

                        // Guardar información del cliente en el estado
                        actualizarEstadoUsuario(chatId, {
                            clienteEncontrado: { cliente, facturas, cuenta, bd },
                            primeraInteraccion: false,
                            erroresConsecutivos: 0
                        });

                        // Enviar saludo personalizado PRIMERO
                        registrarLog(`🔒 [OMITIDO] Cliente identificado: ${cliente.nombre} - Enviando saludo personalizado antes de modo humano`);
                        await enviarMensaje(chatId, `👋 ¡Hola, *${cliente.nombre}*! Bienvenido de nuevo. 😊\n\n✅ *ESTADO:* *${cliente.estado}*\n\n💬 ¿En qué podemos ayudarte hoy?`);
                    }

                    // DESPUÉS del saludo, activar modo humano
                    await activarModoHumano(chatId);
                    await enviarMensaje(chatId, '📩 *Tu mensaje ha sido transmitido al área encargada.* ✅\n\n⏰ Te pedimos un momento por favor, pronto nos comunicaremos contigo. ✨');
                } else {
                    // Solo manejar el mensaje en modo humano
                    await manejarModoHumano(chatId);
                }
                
                // DETENER TODO PROCESAMIENTO DEL BOT AQUÍ
                return;
            }
        } catch (error) {
            registrarLog(`Error verificando número omitido: ${error.message}`);
        }

        // DEBUG: Agregar logs específicos para multimedia
        registrarLog(`🔍 [DEBUG] Mensaje recibido de ${chatId}:`);
        registrarLog(`🔍 [DEBUG] - hasMedia: ${msg.hasMedia}`);
        registrarLog(`🔍 [DEBUG] - type: ${msg.type}`);
        registrarLog(`🔍 [DEBUG] - body: "${msg.body || '[SIN TEXTO]'}"`);
        
        const bodyPreview = msg.body ? msg.body.substring(0, 30) : '[MULTIMEDIA]';
        logOptimized(`📨 [LISTENER PRINCIPAL] ${chatId}: "${bodyPreview}..."`, 'verbose');
        registrarLog(`Mensaje entrante de ${chatId}: ${msg.body || '[MULTIMEDIA]'}`);

        // Registrar mensaje entrante del chatbot para el dashboard
        const nombreChat = obtenerNombreChat(chatId);
        registrarMensajeChatbot('entrante', chatId, msg.body || '[MULTIMEDIA]', nombreChat);

        // Procesar mensaje con posible imagen
        let bodyContent = msg.body;
        
        // Verificar si el mensaje tiene media (imagen, video, audio, etc.)
        if (msg.hasMedia) {
            try {
                registrarLog(`📹 [NUEVO MENSAJE] Procesando media tipo: ${msg.type} de ${chatId}`);
                const media = await msg.downloadMedia();
                
                if (!media || !media.data) {
                    registrarLog(`❌ [NUEVO MENSAJE] Error: No se pudo descargar media de ${chatId}`);
                    bodyContent = `[Media - Error al descargar: ${msg.type}]`;
                    if (msg.body && msg.body.trim()) {
                        bodyContent += ` ${msg.body}`;
                    }
                } else {
                    registrarLog(`✅ [NUEVO MENSAJE] Media descargado exitosamente: ${media.mimetype}, ${media.data.length} bytes`);
                }

                // Procesar imágenes
                if (media.mimetype.startsWith('image/')) {
                    // Generar nombre único para la imagen
                    const timestamp = Date.now();
                    const extension = media.mimetype.split('/')[1];
                    const filename = `user_image_${timestamp}.${extension}`;
                    const filePath = `./images/users/${filename}`;

                    // Crear directorio si no existe
                    const userImagesDir = './images/users';
                    if (!fs.existsSync(userImagesDir)) {
                        fs.mkdirSync(userImagesDir, { recursive: true });
                    }

                    // Guardar imagen usando Promise para asegurar descarga completa
                    try {
                        await new Promise((resolve, reject) => {
                            const buffer = Buffer.from(media.data, 'base64');
                            fs.writeFile(filePath, buffer, (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    } catch (error) {
                        registrarLog(`Error guardando imagen: ${error.message}`);
                        // Continuar con el flujo en lugar de salir
                        bodyContent = `[Imagen - Error al guardar: ${error.message}]`;
                        if (msg.body && msg.body.trim()) {
                            bodyContent += ` ${msg.body}`;
                        }
                    }

                    // Crear HTML para mostrar la imagen en la interfaz web
                    const webPath = `/images/users/${filename}`;
                    bodyContent = `<img src="${webPath}" alt="Imagen enviada por usuario" style="max-width: 200px; border-radius: 8px;">`;
                    if (msg.body && msg.body.trim()) {
                        bodyContent += `<br><span>${msg.body}</span>`;
                    }

                    registrarLog(`Imagen guardada: ${filePath}`);
                }
                // Procesar audios
                else if (media.mimetype.startsWith('audio/')) {
                    // Generar nombre único para el audio
                    const timestamp = Date.now();
                    // Limpiar el tipo MIME para obtener la extensión correcta
                    const cleanMimeType = media.mimetype.split(';')[0];
                    const extension = cleanMimeType.split('/')[1];
                    const filename = `user_audio_${timestamp}.${extension}`;
                    const filePath = `./uploads/audios/${filename}`;

                    // Crear directorio si no existe
                    const userAudiosDir = './uploads/audios';
                    if (!fs.existsSync(userAudiosDir)) {
                        fs.mkdirSync(userAudiosDir, { recursive: true });
                    }

                    // Guardar audio usando Promise para asegurar descarga completa
                    try {
                        await new Promise((resolve, reject) => {
                            const buffer = Buffer.from(media.data, 'base64');
                            registrarLog(`Guardando audio de ${buffer.length} bytes en ${filePath}`);

                            fs.writeFile(filePath, buffer, (err) => {
                                if (err) {
                                    registrarLog(`Error escribiendo archivo de audio: ${err.message}`);
                                    reject(err);
                                } else {
                                    // Verificar que el archivo se guardó correctamente
                                    const stats = fs.statSync(filePath);
                                    registrarLog(`Audio guardado exitosamente: ${filePath} (${stats.size} bytes)`);
                                    resolve();
                                }
                            });
                        });
                    } catch (error) {
                        registrarLog(`Error guardando audio: ${error.message}`);
                        // Continuar con el flujo en lugar de salir
                        bodyContent = `[Audio - Error al guardar: ${error.message}]`;
                        if (msg.body && msg.body.trim()) {
                            bodyContent += ` ${msg.body}`;
                        }
                    }

                    // Crear HTML para mostrar el reproductor de audio en la interfaz web
                    const webPath = `/uploads/audios/${filename}`;
                    // Limpiar el tipo MIME para eliminar los codecs
                    const cleanAudioMimeType = media.mimetype.split(';')[0];
                    bodyContent = `<div class="audio-player">
                        <audio controls preload="metadata" style="width: 100%; max-width: 300px;">
                            <source src="${webPath}" type="${cleanAudioMimeType}">
                            <source src="${webPath}" type="audio/mpeg">
                            <source src="${webPath}" type="audio/wav">
                            <source src="${webPath}" type="audio/ogg">
                            Tu navegador no soporta el elemento de audio.
                        </audio>
                        <div class="audio-info">
                            <small>🎵 Audio enviado por usuario • ${cleanAudioMimeType}</small>
                        </div>
                    </div>`;
                    if (msg.body && msg.body.trim()) {
                        bodyContent += `<br><span>${msg.body}</span>`;
                    }

                    registrarLog(`Audio guardado: ${filePath}`);
                }
                // Procesar videos
                else if (media && media.mimetype && media.mimetype.startsWith('video/')) {
                    registrarLog(`🎬 [NUEVO MENSAJE] Procesando video: ${media.mimetype}, ${media.data.length} bytes`);
                    // Generar nombre único para el video
                    const timestamp = Date.now();
                    // Limpiar el tipo MIME para obtener la extensión correcta
                    const cleanMimeType = media.mimetype.split(';')[0];
                    const extension = cleanMimeType.split('/')[1];
                    const filename = `user_video_${timestamp}.${extension}`;
                    const filePath = `./uploads/videos/${filename}`;

                    // Crear directorio si no existe
                    const userVideosDir = './uploads/videos';
                    if (!fs.existsSync(userVideosDir)) {
                        fs.mkdirSync(userVideosDir, { recursive: true });
                    }

                    // Guardar video usando Promise para asegurar descarga completa
                    try {
                        await new Promise((resolve, reject) => {
                            const buffer = Buffer.from(media.data, 'base64');
                            fs.writeFile(filePath, buffer, (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    } catch (error) {
                        registrarLog(`Error guardando video: ${error.message}`);
                        // Continuar con el flujo en lugar de salir
                        bodyContent = `[Video - Error al guardar: ${error.message}]`;
                        if (msg.body && msg.body.trim()) {
                            bodyContent += ` ${msg.body}`;
                        }
                    }

                    // Crear HTML para mostrar el video en la interfaz web
                    const webPath = `/uploads/videos/${filename}`;
                    // Limpiar el tipo MIME para eliminar los codecs
                    const cleanVideoMimeType = media.mimetype.split(';')[0];
                    bodyContent = `<div class="video-player">
                        <video controls style="width: 100%; max-width: 300px; border-radius: 8px;">
                            <source src="${webPath}" type="${cleanVideoMimeType}">
                            Tu navegador no soporta el elemento de video.
                        </video>
                        <div class="video-info">
                            <small>🎥 Video enviado por usuario</small>
                        </div>
                    </div>`;
                    if (msg.body && msg.body.trim()) {
                        bodyContent += `<br><span>${msg.body}</span>`;
                    }

                    registrarLog(`Video guardado: ${filePath}`);
                }
                // Procesar otros tipos de archivos
                else {
                    // Generar nombre único para el archivo
                    const timestamp = Date.now();
                    const extension = media.mimetype.split('/')[1] || 'file';
                    const filename = `user_file_${timestamp}.${extension}`;
                    const filePath = `./uploads/files/${filename}`;

                    // Crear directorio si no existe
                    const userFilesDir = './uploads/files';
                    if (!fs.existsSync(userFilesDir)) {
                        fs.mkdirSync(userFilesDir, { recursive: true });
                    }

                    // Guardar archivo usando Promise para asegurar descarga completa
                    try {
                        await new Promise((resolve, reject) => {
                            const buffer = Buffer.from(media.data, 'base64');
                            fs.writeFile(filePath, buffer, (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    } catch (error) {
                        registrarLog(`Error guardando archivo: ${error.message}`);
                        // Continuar con el flujo en lugar de salir
                        bodyContent = `[Documento - Error al guardar: ${error.message}]`;
                        if (msg.body && msg.body.trim()) {
                            bodyContent += ` ${msg.body}`;
                        }
                    }

                    // Crear HTML para mostrar el enlace de descarga
                    const webPath = `/uploads/files/${filename}`;
                    bodyContent = `<div class="file-attachment">
                        <a href="${webPath}" download="${filename}" class="file-link">
                            📎 ${filename}
                        </a>
                        <div class="file-info">
                            <small>${media.mimetype} • ${(media.data.length * 0.75 / 1024).toFixed(1)} KB</small>
                        </div>
                    </div>`;
                    if (msg.body && msg.body.trim()) {
                        bodyContent += `<br><span>${msg.body}</span>`;
                    }

                    registrarLog(`Archivo guardado: ${filePath}`);
                }
            } catch (error) {
                registrarLog(`Error descargando media: ${error.message}`);
                bodyContent = '[Media - Error al descargar]';
                if (msg.body && msg.body.trim()) {
                    bodyContent += ` ${msg.body}`;
                }
            }
        }
        
        // Actualizar chat activo con el mensaje entrante
        actualizarChatActivo(chatId, {
            body: bodyContent,
            fromMe: false,
            hasMedia: msg.hasMedia || false
        });

        // CRÍTICO: Obtener estado y actualizar ultimaInteraccion para asegurar persistencia
        const estado = obtenerEstadoUsuario(chatId);

        // Actualizar ultimaInteraccion SIEMPRE que llega un mensaje para garantizar persistencia
        actualizarEstadoUsuario(chatId, {
            ultimaInteraccion: Date.now(),
            primeraInteraccion: estado.primeraInteraccion !== undefined ? estado.primeraInteraccion : true
        });

        // Reiniciar con #
        if (msg.body && msg.body.trim() === '#') {
            // Cancelar timeout de Sol si existe
            if (timeoutsSol.has(chatId)) {
                clearTimeout(timeoutsSol.get(chatId));
                timeoutsSol.delete(chatId);
                console.log(`⏰ [SOL] Timeout cancelado para ${chatId} - usuario reinició con #`);
            }

            // Verificar si el cliente ya está identificado
            if (estado.clienteEncontrado && estado.clienteEncontrado.cliente) {
                const { cliente } = estado.clienteEncontrado;

                // Cliente identificado: llevar al menú personalizado de usuario
                registrarLog(`Usuario identificado ${cliente.nombre} (${chatId}) volvió al menú con #`);

                // Limpiar solo el seguimiento, pero mantener la información del cliente
                actualizarEstadoUsuario(chatId, {
                    seguimiento: null,
                    erroresConsecutivos: 0,
                    esperandoCedula: false,
                    esperandoCedula2: false,
                    enEsperaHumano: null,  // IMPORTANTE: Salir del modo humano
                    primerErrorTimestamp: null,
                    mensajeSolEnviado: false
                });

                // NUEVO: Persistir cambio a modo bot en BD
                await persistirModoChat(chatId, 'bot');

                // Mostrar menú personalizado de usuario
                await enviarMensaje(chatId, `👋 ¡Hola de nuevo, *${cliente.nombre}*! 😊\n\n✅ *ESTADO:* *${cliente.estado}*\n\n💬 ¿En qué podemos ayudarte hoy?`);
                await enviarMensaje(chatId, `📋 *MENÚ DE SERVICIOS*\n\n1️⃣ 💰 Registrar pago (registro de plazos)\n\n2️⃣ 🔧 Soporte técnico (cambio de contraseña)\n\n3️⃣ 📊 Mi estado de cuenta (valor a cancelar y cuenta de pago)\n\n4️⃣ 🏠 Traslado de servicio\n\n5️⃣ ❌ Cancelar visita técnica generada\n\n#️⃣ ⬅️ Volver al menú principal`);

                // Actualizar estado para seguimiento del menú de usuario
                actualizarEstadoUsuario(chatId, {
                    seguimiento: { paso: 'menu_usuario' },
                    erroresConsecutivos: 0
                });
            } else {
                // Cliente no identificado: limpiar solo el estado pero MANTENER el chat activo
                limpiarEstadoUsuario(chatId);
                registrarLog(`Usuario ${chatId} reinició la conversación con # - Volviendo a identificar`);

                // Intentar identificar al cliente nuevamente
                const numeroTelefono = chatId.replace('@c.us', '').replace('@lid', '');
                const resultadoCliente = await consultarClientePorTelefono(numeroTelefono);

                if (resultadoCliente) {
                    const { cliente, facturas, cuenta, bd } = resultadoCliente;
                    registrarLog(`✅ [REINICIO] Cliente identificado: ${cliente.nombre} - Estado: ${cliente.estado}`);

                    // Guardar información del cliente
                    actualizarEstadoUsuario(chatId, {
                        clienteEncontrado: { cliente, facturas, cuenta, bd },
                        primeraInteraccion: false,
                        erroresConsecutivos: 0
                    });

                    // Mostrar saludo personalizado y menú de usuario
                    await enviarMensaje(chatId, `👋 ¡Hola, ${cliente.nombre}! Bienvenido de nuevo. 😊\n\n✅ ESTADO: ${cliente.estado}\n\n💬 ¿En qué podemos ayudarte hoy?`);
                    await enviarMensaje(chatId, `📋 *MENÚ DE SERVICIOS*\n\n1️⃣ 💰 Registrar pago (registro de plazos)\n\n2️⃣ 🔧 Soporte técnico (cambio de contraseña)\n\n3️⃣ 📊 Mi estado de cuenta (valor a cancelar y cuenta de pago)\n\n4️⃣ 🏠 Traslado de servicio\n\n5️⃣ ❌ Cancelar visita técnica generada\n\n#️⃣ ⬅️ Volver al menú principal`);

                    actualizarEstadoUsuario(chatId, {
                        seguimiento: { paso: 'menu_usuario' },
                        erroresConsecutivos: 0
                    });
                } else {
                    // No encontrado, mostrar menú principal
                    registrarLog(`⚠️ [REINICIO] Cliente no encontrado - Mostrando menú principal`);
                    await mostrarMenuPrincipal(chatId);
                }
            }
            return;
        }

        // Activar modo humano con ##
        if (msg.body && msg.body.trim() === '##') {
            // Cancelar timeout de Sol si existe
            if (timeoutsSol.has(chatId)) {
                clearTimeout(timeoutsSol.get(chatId));
                timeoutsSol.delete(chatId);
                console.log(`⏰ [SOL] Timeout cancelado para ${chatId} - usuario activó modo humano con ##`);
            }
            await activarModoHumano(chatId);
            return;
        }

        // Resetear contador de errores cuando el usuario envía una opción válida en cualquier contexto
        const opcionesValidas = ['1', '2', '3', '4', '5', '9', '#', '##'];
        if (msg.body && opcionesValidas.includes(msg.body.trim())) {
            resetearSistemaErrores(chatId);
        }

        // Modo humano activo
        if (estado.enEsperaHumano) {
            await manejarModoHumano(chatId);
            return;
        }

        const ahora = Date.now();
        actualizarEstadoUsuario(chatId, { ultimaInteraccion: ahora });

        // Manejo de cédulas
        if (estado.esperandoCedula) {
            await procesarCedula(chatId, msg.body ? msg.body.trim() : '', 'usuario_registrado');
            return;
        }

        if (estado.esperandoCedula2) {
            await procesarCedula(chatId, msg.body ? msg.body.trim() : '', 'consulta_estado');
            return;
        }

        // Seguimiento de submenús
        if (estado.seguimiento) {
            await manejarSeguimiento(chatId, msg.body ? msg.body.trim() : '', estado.seguimiento);
            return;
        }

        // Verificar si es la primera interacción del usuario - buscar automáticamente en BD
        registrarLog(`🔍 [DEBUG] Verificando primera interacción para ${chatId}: ${estado.primeraInteraccion}`);
        if (estado.primeraInteraccion) {
            registrarLog(`🎬 [DEBUG] Primera interacción detectada para ${chatId} - Buscando cliente automáticamente`);

            // Extraer número de teléfono del chatId (sin @c.us o @lid)
            const numeroTelefono = chatId.replace('@c.us', '').replace('@lid', '');
            registrarLog(`📱 [AUTO-VALIDACIÓN] Buscando cliente con número: ${numeroTelefono}`);

            try {
                // Buscar cliente por número de teléfono
                const resultado = await consultarClientePorTelefono(numeroTelefono);

                if (resultado) {
                    const { cliente, facturas, cuenta, bd } = resultado;
                    registrarLog(`✅ [AUTO-VALIDACIÓN] Cliente encontrado: ${cliente.nombre} - Estado: ${cliente.estado}`);

                    // Guardar información del cliente en el estado
                    actualizarEstadoUsuario(chatId, {
                        clienteEncontrado: { cliente, facturas, cuenta, bd },
                        primeraInteraccion: false,
                        erroresConsecutivos: 0
                    });

                    // Verificar si el número está omitido
                    const numeroOmitido = await verificarNumeroOmitidoConCache(numeroTelefono);

                    if (numeroOmitido) {
                        // Cliente omitido: enviar mensaje personalizado PRIMERO y luego activar modo humano
                        registrarLog(`🔒 [AUTO-VALIDACIÓN] Cliente ${cliente.nombre} está omitido - Enviando saludo personalizado antes de modo humano`);

                        // PRIMERO: Enviar saludo personalizado con nombre y estado
                        await enviarMensaje(chatId, `👋 ¡Hola, *${cliente.nombre}*! Bienvenido de nuevo. 😊\n\n✅ *ESTADO:* *${cliente.estado}*\n\n💬 ¿En qué podemos ayudarte hoy?`);

                        // DESPUÉS: Activar modo humano automáticamente
                        await activarModoHumano(chatId);
                        await enviarMensaje(chatId, '📩 *Tu mensaje ha sido transmitido al área encargada.* ✅\n\n⏰ Te pedimos un momento por favor, pronto nos comunicaremos contigo. ✨');
                        return;
                    } else {
                        // Cliente registrado pero NO omitido: mostrar menú de usuario (opción #1)
                        registrarLog(`📋 [AUTO-VALIDACIÓN] Cliente ${cliente.nombre} registrado - Mostrando menú de usuario`);

                        // Mostrar mensaje de bienvenida con estado
                        await enviarMensaje(chatId, `👋 ¡Hola, ${cliente.nombre}! Bienvenido de nuevo. 😊\n\n✅ ESTADO: ${cliente.estado}\n\n💬 ¿En qué podemos ayudarte hoy?`);

                        // Mostrar el menú de usuario (igual que opción #1)
                        await enviarMensaje(chatId, `📋 *MENÚ DE SERVICIOS*\n\n1️⃣ 💰 Registrar pago (registro de plazos)\n\n2️⃣ 🔧 Soporte técnico (cambio de contraseña)\n\n3️⃣ 📊 Mi estado de cuenta (valor a cancelar y cuenta de pago)\n\n4️⃣ 🏠 Traslado de servicio\n\n5️⃣ ❌ Cancelar visita técnica generada\n\n#️⃣ ⬅️ Volver al menú principal`);

                        // Actualizar estado para seguimiento del menú de usuario
                        actualizarEstadoUsuario(chatId, {
                            seguimiento: { paso: 'menu_usuario' },
                            erroresConsecutivos: 0,
                            enEsperaHumano: null  // IMPORTANTE: Asegurar que NO esté en modo humano
                        });

                        // NUEVO: Persistir cambio a modo bot en BD
                        await persistirModoChat(chatId, 'bot');
                        return;
                    }
                } else {
                    // Cliente no encontrado: mostrar menú principal normal
                    registrarLog(`⚠️ [AUTO-VALIDACIÓN] Cliente no encontrado con número ${numeroTelefono} - Mostrando menú principal`);
                    await mostrarMenuPrincipal(chatId);
                    return;
                }
            } catch (error) {
                registrarLog(`❌ [AUTO-VALIDACIÓN] Error buscando cliente: ${error.message}`);
                // En caso de error, mostrar menú principal normal
                await mostrarMenuPrincipal(chatId);
                return;
            }
        }

        // Menú principal
        await manejarMenuPrincipal(chatId, msg.body ? msg.body.trim() : '');

    } catch (error) {
        registrarLog(`❌ [ERROR] Error procesando mensaje interno de ${msg.from}: ${error.message}`);
        registrarLog(`❌ [ERROR] Stack trace: ${error.stack}`);
        console.error(`Error completo:`, error);
        throw error; // Re-lanzar el error para que sea capturado por el wrapper
    } finally {
        // Programar guardado automático después de procesar mensaje
        // Usa debounce de 5 segundos para evitar escrituras excesivas
        programarGuardado(false);

        // Emitir actualización de chats via WebSocket después de procesar mensaje
        emitirActualizacionChats();
    }
}

// ===== Funciones especializadas =====

// ===== FUNCIONES DE PERSISTENCIA DE MODO CHAT =====
async function persistirModoChat(chatId, modo) {
    try {
        const numero = chatId.replace('@c.us', '').replace('@lid', '');
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        // Insertar o actualizar el modo del chat en la BD
        await conexion.execute(`
            INSERT INTO chat_sync_status (numero_telefono, modo_chat, updated_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                modo_chat = VALUES(modo_chat),
                updated_at = NOW()
        `, [numero, modo]);

        await conexion.end();
        console.log(`✅ [PERSISTENCIA] Modo '${modo}' guardado en BD para ${numero}`);
    } catch (error) {
        console.error(`❌ [PERSISTENCIA] Error guardando modo chat:`, error.message);
    }
}

async function restaurarModosChat() {
    try {
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        // Obtener todos los chats con modo persistido (incluir 'human' además de 'humano')
        const [chatsConModo] = await conexion.execute(`
            SELECT numero_telefono, nombre_contacto, modo_chat
            FROM chat_sync_status
            WHERE modo_chat IN ('humano', 'human', 'bot')
        `);

        await conexion.end();

        let restauradosHumano = 0;
        let restauradosBot = 0;
        let saltados = 0;

        for (const chat of chatsConModo) {
            const chatId = `${chat.numero_telefono}@c.us`;

            // IMPORTANTE: NO sobrescribir si ya existe en modosChat (prioridad al archivo JSON)
            if (modosChat.has(chatId)) {
                saltados++;
                continue;
            }

            if (chat.modo_chat === 'humano' || chat.modo_chat === 'human') {
                // Restaurar estado de modo humano en memoria
                actualizarEstadoUsuario(chatId, {
                    enEsperaHumano: {
                        contador: 0,
                        ultimaRespuesta: Date.now()
                    }
                });
                // También actualizar en modosChat Map
                modosChat.set(chatId, 'human');

                // Actualizar en chatsActivos si existe
                if (chatsActivos.has(chatId)) {
                    const chatInfo = chatsActivos.get(chatId);
                    chatInfo.mode = 'human';
                    chatsActivos.set(chatId, chatInfo);
                }

                restauradosHumano++;
            } else if (chat.modo_chat === 'bot') {
                // Restaurar estado de modo bot en memoria
                actualizarEstadoUsuario(chatId, {
                    enEsperaHumano: null
                });
                // También actualizar en modosChat Map
                modosChat.set(chatId, 'bot');

                // Actualizar en chatsActivos si existe
                if (chatsActivos.has(chatId)) {
                    const chatInfo = chatsActivos.get(chatId);
                    chatInfo.mode = 'bot';
                    chatsActivos.set(chatId, chatInfo);
                }

                restauradosBot++;
            }
        }

        if (restauradosHumano > 0 || restauradosBot > 0) {
            console.log(`✅ [PERSISTENCIA] Modos restaurados: ${restauradosHumano} humano, ${restauradosBot} bot`);
        }

        return { humano: restauradosHumano, bot: restauradosBot };
    } catch (error) {
        console.error(`❌ [PERSISTENCIA] Error restaurando modos chat:`, error.message);
        return { humano: 0, bot: 0 };
    }
}

async function activarModoHumano(chatId) {
    // Verificar si ya está en modo humano
    const estadoActual = obtenerEstadoUsuario(chatId);
    if (estadoActual.enEsperaHumano) {
        console.log(`⚠️ [MODO HUMANO] Usuario ${chatId} ya está en modo humano - Evitando reactivación`);
        return; // Ya está en modo humano, no reactivar
    }

    // IMPORTANTE: Cancelar cualquier debounce pendiente antes de activar modo humano
    if (userMessageDebounce.has(chatId)) {
        const debounceData = userMessageDebounce.get(chatId);
        clearTimeout(debounceData.timer);
        userMessageDebounce.delete(chatId);
        console.log(`🧹 [MODO HUMANO] Debounce cancelado para ${chatId} al activar modo humano`);
    }

    actualizarEstadoUsuario(chatId, {
        enEsperaHumano: {
            contador: 0,
            ultimaRespuesta: Date.now()
        },
        erroresConsecutivos: 0 // Reset errores al entrar en modo humano
    });

    // NUEVO: Persistir modo humano en base de datos
    await persistirModoChat(chatId, 'human');

    registrarLog(`Usuario ${chatId} activó modo humano`);
}

async function manejarModoHumano(chatId) {
    const estado = obtenerEstadoUsuario(chatId);
    
    actualizarEstadoUsuario(chatId, {
        enEsperaHumano: { 
            ...estado.enEsperaHumano,
            ultimaRespuesta: Date.now()
        }
    });
    
    registrarLog(`(HUMANO) Mensaje en modo humano de ${chatId}`);
}

async function procesarCedula(chatId, cedula, tipo) {
    registrarLog(`Usuario ${chatId} ingresó cédula: ${cedula}`);

    try {
        const resultado = await consultarCliente(cedula);

        actualizarEstadoUsuario(chatId, {
            esperandoCedula: false,
            esperandoCedula2: false,
            erroresConsecutivos: 0 // Reset errores después de procesar cédula exitosamente
        });

        if (resultado) {
            const { cliente, facturas, cuenta, bd } = resultado;
            actualizarEstadoUsuario(chatId, {
                clienteEncontrado: { cliente, facturas, cuenta, bd }
            });

            if (tipo === 'usuario_registrado') {
                // Mostrar mensaje de bienvenida y menú de opciones
                await enviarMensaje(chatId, `👋 ¡Hola, *${cliente.nombre}*! Bienvenido de nuevo. 😊\n\n✅ *ESTADO:* *${cliente.estado}*\n\n💬 ¿En qué podemos ayudarte hoy?`);

                // Mostrar el menú de usuario
                await enviarMensaje(chatId, `📋 *MENÚ DE SERVICIOS*\n\n1️⃣ 💰 Registrar pago (registro de plazos)\n\n2️⃣ 🔧 Soporte técnico (cambio de contraseña)\n\n3️⃣ 📊 Mi estado de cuenta (valor a cancelar y cuenta de pago)\n\n4️⃣ 🏠 Traslado de servicio\n\n#️⃣ ⬅️ Volver al menú principal`);

                // Actualizar estado para seguimiento del menú de usuario
                actualizarEstadoUsuario(chatId, {
                    seguimiento: { paso: 'menu_usuario' },
                    erroresConsecutivos: 0,
                    enEsperaHumano: null  // IMPORTANTE: Asegurar que NO esté en modo humano
                });

                // NUEVO: Persistir cambio a modo bot en BD
                await persistirModoChat(chatId, 'bot');

            } else if (tipo === 'consulta_estado') {
                await mostrarEstadoCuenta(chatId, cliente, facturas, cuenta);
            }
        } else {
            await enviarMensaje(chatId, '😢 *Lo sentimos, cliente no encontrado.*\n\nℹ️ Verifica que hayas ingresado tu cédula correctamente.');
            if (tipo === 'consulta_estado') {
                await transferirAsesor(chatId);
            } else {
                await mostrarMenuPrincipal(chatId);
            }
        }
    } catch (err) {
        registrarLog(`Error: ${err.message}`);
        await enviarMensaje(chatId, '🚫 *Error de conexión con la base de datos.*\n\n⏰ Por favor, intenta más tarde.');
    }
}

async function mostrarEstadoCuenta(chatId, cliente, facturas, cuenta) {
    if (facturas && facturas.length > 0) {
        let mensajeDeuda = `💸 *Estado de Cuenta - ${cliente.nombre}*\n\n`;
        if (cuenta) {
            mensajeDeuda += `📊 Estado: *${cliente.estado}*\n\n`;
        }
        mensajeDeuda += `📋 *Facturas Pendientes:*\n\n`;
        facturas.forEach((factura, i) => {
            mensajeDeuda += `${i + 1}️⃣ 📅 Vencimiento: *${factura.vencimiento}*\n   💵 Total: *$${factura.total}*\n\n`;
        });
        if (cuenta) {
            mensajeDeuda += `🏦 *Cuenta de pago:* ${cuenta.cuenta}\n\n`;
        }
        if (facturas.length > 2) {
            mensajeDeuda += `⚠️ *ATENCIÓN:* Tienes más de 2 facturas pendientes.\n⚡ Evita reportes negativos en las centrales de riesgo.`;
        }
        await enviarMensaje(chatId, mensajeDeuda);
    } else {
        await enviarMensaje(chatId, '🎉 *¡Excelente!* No tienes facturas pendientes de pago. ✅');
    }

    // Preguntar si desea hablar con un asesor en lugar de transferir automáticamente
    await enviarMensaje(chatId, '💬 *¿Deseas que te comuniquemos con un asesor?*\n\n1️⃣ ✅ Sí, por favor\n\n2️⃣ ❌ No, gracias\n\n#️⃣ ⬅️ Volver al menú principal');

    // Actualizar el estado para esperar la respuesta
    actualizarEstadoUsuario(chatId, {
        seguimiento: { paso: 'esperar_respuesta_asesor_estado' },
        erroresConsecutivos: 0
    });
}

async function transferirAsesor(chatId) {
    // Verificar si ya está en modo humano ANTES de enviar mensajes
    const estadoActual = obtenerEstadoUsuario(chatId);
    if (estadoActual.enEsperaHumano) {
        console.log(`⚠️ [TRANSFER] Usuario ${chatId} ya está en modo humano - No enviar mensajes de transferencia`);
        return; // Ya está en modo humano, no enviar mensajes duplicados
    }

    // IMPORTANTE: Cancelar cualquier debounce pendiente antes de activar modo humano
    if (userMessageDebounce.has(chatId)) {
        const debounceData = userMessageDebounce.get(chatId);
        clearTimeout(debounceData.timer);
        userMessageDebounce.delete(chatId);
        console.log(`🧹 [TRANSFER] Debounce cancelado para ${chatId} al transferir a asesor`);
    }

    // IMPORTANTE: Activar modo humano ANTES de enviar mensajes
    // para evitar condiciones de carrera donde el usuario responde rápidamente
    actualizarEstadoUsuario(chatId, {
        seguimiento: null,
        enEsperaHumano: {
            contador: 0,
            ultimaRespuesta: Date.now()
        },
        erroresConsecutivos: 0 // Reset errores al transferir a asesor
    });

    // Ahora sí enviar mensajes
    await enviarMensaje(chatId, '📨 *Estamos procesando tu solicitud...* ⏳\n\n👨‍💼 Te estamos conectando con un asesor especializado que te atenderá enseguida.');
    enviarMensajeFueraHorario(chatId);
}

async function manejarSeguimiento(chatId, texto, seguimiento) {
    const estado = obtenerEstadoUsuario(chatId);
    
    switch (seguimiento.paso) {
        case 'nuevo_usuario_nombre':
            actualizarEstadoUsuario(chatId, {
                seguimiento: { paso: 'nuevo_usuario_localidad', nombre: texto },
                erroresConsecutivos: 0
            });
            await enviarMensaje(chatId, `🔍 ¡Gracias *${texto}*! 😊\n\n📍 Ahora dime, ¿en qué localidad necesitas el servicio?`);
            break;

        case 'nuevo_usuario_localidad':
            await procesarLocalidad(chatId, texto, seguimiento.nombre);
            break;

        case 'menu_usuario':
            await manejarMenuUsuario(chatId, texto, estado.clienteEncontrado);
            break;

        case 'soporte_tecnico':
            await manejarSoporteTecnico(chatId, texto);
            break;

        case 'reporte_servicio':
            await manejarReporteServicio(chatId, texto);
            break;

        case 'luz_roja':
            await manejarLuzRoja(chatId, texto, estado.clienteEncontrado);
            break;

        case 'pregunta_asesor_visita_existente':
            await manejarPreguntaAsesorVisitaExistente(chatId, texto);
            break;

        case 'pregunta_duda_post_visita':
            await manejarPreguntaDudaPostVisita(chatId, texto);
            break;

        case 'confirmar_cancelacion_visita':
            await manejarConfirmacionCancelacionVisita(chatId, texto, seguimiento.visitaId, estado.clienteEncontrado);
            break;

        case 'paso4':
            await enviarMensaje(chatId, `🔍 ¡Gracias *${texto}*! 😊\n\n🆔 Ahora envíame tu número de cédula para transferirte con un asesor.`);
            await transferirAsesor(chatId);
            break;

        case 'problema_lento':
            await manejarProblemaLento(chatId, texto);
            break;

        case 'manejarRespuestaFormulario':
            await manejarRespuestaFormulario(chatId, texto);
            break;

        case 'traslado_localidad':
            await manejarTrasladoLocalidad(chatId, texto);
            break;

        case 'traslado_direccion':
            await manejarTrasladoDireccion(chatId, texto, seguimiento);
            break;

        case 'esperar_respuesta_asesor_estado':
            await manejarRespuestaAsesorEstado(chatId, texto);
            break;

        default:
            actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
            await mostrarMenuPrincipal(chatId);
            break;
    }
}

// Función para interpretar texto y extraer localidad mencionada
function interpretarLocalidadEnTexto(texto) {
    if (!texto) return null;
    
    const textoLimpio = texto.toLowerCase().trim();
    const palabrasTexto = textoLimpio.split(/\s+/);
    
    // Definir palabras clave principales y alternativas para cada localidad
    const localidadesDictionary = {
        "reposo": {
            principales: ["reposo"],
            alternativas: ["repos", "repoos", "repozo"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        },
        "salvador": {
            principales: ["salvador"],
            alternativas: ["salvad", "salvado", "salvator"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        },
        "bosque los almendros": {
            principales: ["bosque", "almendros", "almendro"],
            alternativas: ["bosques", "almendras", "almendra", "bosq"],
            contextos: ["en", "del", "por", "hacia", "desde", "los"]
        },
        "rio grande": {
            principales: ["rio", "río", "grande"],
            alternativas: ["rios", "ríos", "grand", "riogrande"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        },
        "osito": {
            principales: ["osito"],
            alternativas: ["oso", "ositos", "oseto"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        },
        "salsipuedes": {
            principales: ["salsipuedes", "salsi", "puedes"],
            alternativas: ["salsipuede", "salcipuedes", "salcipuede"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        },
        "milucha": {
            principales: ["milucha"],
            alternativas: ["milu", "milucho", "milucha"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        },
        "churido": {
            principales: ["churido"],
            alternativas: ["churi", "churidos", "churido"],
            contextos: ["en", "del", "por", "hacia", "desde"]
        }
    };
    
    let mejorCoincidencia = null;
    let mejorPuntaje = 0;
    
    // Evaluar cada localidad
    for (const [localidad, datos] of Object.entries(localidadesDictionary)) {
        let puntaje = 0;
        let palabrasEncontradas = 0;
        
        // Verificar palabras principales (mayor peso)
        for (const palabraPrincipal of datos.principales) {
            for (const palabra of palabrasTexto) {
                const similitud = similitudTexto(palabra, palabraPrincipal);
                if (similitud > 0.75) {
                    puntaje += similitud * 3;
                    palabrasEncontradas++;
                }
            }
        }
        
        // Verificar palabras alternativas (peso medio)
        for (const palabraAlternativa of datos.alternativas) {
            for (const palabra of palabrasTexto) {
                const similitud = similitudTexto(palabra, palabraAlternativa);
                if (similitud > 0.8) {
                    puntaje += similitud * 1.5;
                    palabrasEncontradas++;
                }
            }
        }
        
        // Bonificación si se encuentran múltiples palabras de la localidad
        if (palabrasEncontradas > 1) {
            puntaje += palabrasEncontradas * 0.5;
        }
        
        // Bonificación adicional para localidades con múltiples palabras
        if (localidad === "bosque los almendros") {
            const tieneBosque = palabrasTexto.some(p => similitudTexto(p, "bosque") > 0.75 || similitudTexto(p, "bosq") > 0.8);
            const tieneAlmendros = palabrasTexto.some(p => similitudTexto(p, "almendros") > 0.75 || similitudTexto(p, "almendro") > 0.75);
            if (tieneBosque && tieneAlmendros) {
                puntaje += 2;
            }
        }
        
        if (localidad === "rio grande") {
            const tieneRio = palabrasTexto.some(p => similitudTexto(p, "rio") > 0.75 || similitudTexto(p, "río") > 0.75);
            const tieneGrande = palabrasTexto.some(p => similitudTexto(p, "grande") > 0.75 || similitudTexto(p, "grand") > 0.8);
            if (tieneRio && tieneGrande) {
                puntaje += 2;
            }
        }
        
        // Actualizar mejor coincidencia
        if (puntaje > mejorPuntaje && puntaje > 0.8) {
            mejorPuntaje = puntaje;
            mejorCoincidencia = localidad;
        }
    }
    
    // Si encontramos una buena coincidencia, la devolvemos
    if (mejorCoincidencia) {
        return mejorCoincidencia;
    }
    
    // Método de respaldo: búsqueda directa en localidadesDisponibles
    for (const localidad of Object.keys(localidadesDisponibles)) {
        const palabrasLocalidad = localidad.toLowerCase().split(/\s+/);
        let coincidencias = 0;
        
        for (const palabraLocalidad of palabrasLocalidad) {
            for (const palabra of palabrasTexto) {
                if (similitudTexto(palabra, palabraLocalidad) > 0.75) {
                    coincidencias++;
                    break;
                }
            }
        }
        
        // Si encontramos la mayoría de palabras de la localidad
        if (coincidencias >= Math.max(1, Math.floor(palabrasLocalidad.length * 0.6))) {
            return localidad;
        }
    }
    
    return null;
}

async function procesarLocalidad(chatId, respuestaLocalidad, nombreUsuario) {
    // Primero intentar interpretar el texto completo para extraer la localidad
    let localidadEncontrada = interpretarLocalidadEnTexto(respuestaLocalidad);
    
    // Si no se encontró con la interpretación inteligente, usar el método original
    if (!localidadEncontrada) {
        localidadEncontrada = Object.keys(localidadesDisponibles).find(loc => {
            return similitudTexto(respuestaLocalidad.toLowerCase(), loc) > 0.7;
        });
    }

    if (localidadEncontrada) {
        const rutaImagen = localidadesDisponibles[localidadEncontrada];
        const media = MessageMedia.fromFilePath(rutaImagen);
        await enviarMensaje(chatId, `👋 ¡Genial *${nombreUsuario}*! 🎉\n\n✅ Tenemos cobertura en *${localidadEncontrada}*.`);
        await enviarMensaje(chatId, media, rutaImagen);
        
        await configurarRegistroUsuario(chatId);
    } else {
        await enviarMensaje(chatId, `⚠️ *Lo sentimos, ${nombreUsuario}*\n\n😔 Para esta zona lamentablemente no tenemos cobertura.\n\n👨‍💼 Te estamos conectando con un asesor para darte una respuesta concreta.`);
        await activarModoHumano(chatId);
    }

    actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
}

async function configurarRegistroUsuario(chatId) {
    const temporizador = setTimeout(async () => {
        await enviarMensaje(chatId, '📝 *¿Deseas llenar nuestro formulario de registro?*\n\n1️⃣ ✅ Sí, quiero registrarme\n\n2️⃣ ❌ No, prefiero hablar con un asesor');
        await manejarRespuestaFormulario(chatId);
    }, 3000); // 3 segundos en lugar de 5 minutos para testing

    actualizarEstadoUsuario(chatId, {
        enEsperaHumano: { 
            contador: 0, 
            ultimaRespuesta: Date.now(), 
            temporizador 
        },
        erroresConsecutivos: 0
    });
}

async function manejarRespuestaFormulario(chatId) {
    // PRIMERO: Remover cualquier listener de formulario existente para este chatId
    const estadoActual = obtenerEstadoUsuario(chatId);
    if (estadoActual.formularioListener) {
        try {
            client.removeListener('message', estadoActual.formularioListener);
            console.log('Listener de formulario anterior removido para', chatId);
        } catch (error) {
            console.error('Error removiendo listener anterior:', error.message);
        }
    }

    // Crear nuevo listener con ID único para evitar conflictos
    const listenerId = `formulario_${chatId}_${Date.now()}`;
    const listener = async respuesta => {
        // Verificar que sea para este chat específico
        if (respuesta.from !== chatId) return;

        // Ignorar mensajes enviados por el propio bot
        if (respuesta.fromMe) return;

        // 🔧 AGREGADO: Filtrar grupos, canales y comunidades como en manejarMensaje principal
        if (respuesta.from.includes('status@broadcast') ||
            respuesta.from.includes('@g.us') ||
            respuesta.from.includes('@broadcast') ||
            respuesta.from.match(/^\d{15,}@/)) return;

        const texto = respuesta.body.toLowerCase().trim();
        logOptimized(`🎧 [LISTENER FORMULARIO ${listenerId}] ${chatId}: "${texto.substring(0, 20)}..."`, 'verbose');

        if (texto === '1') {
            await enviarMensaje(chatId, `✅ *¡Perfecto!* 🎉\n\n🔗 Te comparto el enlace para iniciar tu proceso de solicitud:\n👉 https://solucnet.com/registro.html\n\n📋 *Instrucciones:*\n• Completa todos los datos que te pedirá el formulario\n• Son los requisitos para agendar tu instalación\n\n💬 Cuando termines, cuéntame a nombre de quién realizaste la inscripción para poder agendar tu instalación 📅\n\n💰 En la imagen que te envié está el valor del costo de instalación\n\n⚠️ *Importante:*\n• Manejamos una cláusula de permanencia mínima de 3 meses\n• Son 3 días hábiles para la instalación (trataremos de hacerlo lo antes posible)`);
            // Remover listener inmediatamente
            client.removeListener('message', listener);
            actualizarEstadoUsuario(chatId, { formularioListener: null });
        } else if (texto === '2') {
            await enviarMensaje(chatId, '✅ *De acuerdo* 👍\n\n👨‍💼 En un momento un asesor se pondrá en contacto contigo.');
            enviarMensajeFueraHorario(chatId);
            // Remover listener inmediatamente
            client.removeListener('message', listener);
            actualizarEstadoUsuario(chatId, { formularioListener: null });

        // rama de opción inválida - permitir más intentos
        } else {
            await manejarOpcionInvalida(chatId, 'manejarRespuestaFormulario');
        }
    };

    // Agregar el listener con ID único
    client.on('message', listener);

    // Guardar referencia del listener en el estado
    actualizarEstadoUsuario(chatId, {
        formularioListener: listener,
        formularioListenerId: listenerId
    });

    logOptimized(`Nuevo listener de formulario agregado para ${chatId} con ID: ${listenerId}`, 'verbose');

    // Timeout de seguridad más agresivo: 5 minutos
    setTimeout(() => {
        try {
            const estadoTimeout = obtenerEstadoUsuario(chatId);
            if (estadoTimeout.formularioListenerId === listenerId) {
                client.removeListener('message', listener);
                actualizarEstadoUsuario(chatId, { formularioListener: null, formularioListenerId: null });
                console.log(`Listener de formulario timeout para ${chatId} (ID: ${listenerId})`);
            }
        } catch (error) {
            console.error('Error en timeout de listener:', error.message);
        }
    }, 5 * 60 * 1000); // 5 minutos
}

async function manejarMenuUsuario(chatId, texto, clienteEncontrado) {
    if (texto === '1') {
        await enviarMensaje(chatId, '👉 *Por favor:*\n\n📸 Envíanos tu comprobante de pago, o\n📅 Indícanos la fecha hasta la cual requieres el plazo.');
        await transferirAsesor(chatId);
    } else if (texto === '3') {
        console.log(`🔍 [DEBUG OPCIÓN 3] clienteEncontrado:`, clienteEncontrado);
        if (clienteEncontrado) {
            const { cliente, facturas, cuenta } = clienteEncontrado;
            console.log(`🔍 [DEBUG OPCIÓN 3] Cliente: ${cliente?.nombre}, Facturas: ${facturas?.length}, Cuenta: ${cuenta?.cuenta}`);
            await mostrarEstadoCuenta(chatId, cliente, facturas, cuenta);
        } else {
            console.log(`⚠️ [DEBUG OPCIÓN 3] NO hay clienteEncontrado, transfiriendo a asesor`);
            await transferirAsesor(chatId);
        }
    } else if (texto === '2') {
        await enviarMensaje(chatId, `🔧 *SOPORTE TÉCNICO*\n\n1️⃣ 🔑 Cambio de nombre o contraseña\n\n2️⃣ ⚠️ Reportar daño de servicio\n\n#️⃣ ⬅️ Volver al menú principal`);
        actualizarEstadoUsuario(chatId, {
            seguimiento: { ...obtenerEstadoUsuario(chatId).seguimiento, paso: 'soporte_tecnico' },
            erroresConsecutivos: 0
        });
    } else if (texto === '4') {
        // Nueva opción: Traslado de servicio
        await enviarMensaje(chatId, `🏠 *TRASLADO DE SERVICIO*\n\n📍 Por favor, indícanos la *localidad* a la que te vas a mudar:`);
        actualizarEstadoUsuario(chatId, {
            seguimiento: { paso: 'traslado_localidad' },
            erroresConsecutivos: 0
        });
    } else if (texto === '5') {
        // Nueva opción: Cancelar visita técnica generada
        await manejarCancelacionVisitaTecnica(chatId, clienteEncontrado);
    } else if (texto === '9') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'menu_usuario');
    }
}

async function manejarCancelacionVisitaTecnica(chatId, clienteEncontrado) {
    if (!clienteEncontrado || !clienteEncontrado.cliente) {
        await enviarMensaje(chatId, '❌ Error: No pudimos identificar tu información de cliente.');
        return;
    }

    const { cliente } = clienteEncontrado;

    try {
        // Buscar visita técnica sin asignar del cliente
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        const [visitasPendientes] = await conexion.execute(
            `SELECT id, motivo_visita, fecha_creacion, observacion, estado
             FROM visitas_tecnicas
             WHERE cliente_cedula = ?
             AND tecnico_asignado_id IS NULL
             AND estado NOT IN ('completada', 'cancelada')
             ORDER BY fecha_creacion DESC
             LIMIT 1`,
            [cliente.cedula]
        );

        await conexion.end();

        if (visitasPendientes.length === 0) {
            await enviarMensaje(chatId, '❌ *NO TIENES VISITAS TÉCNICAS PENDIENTES*\n\n📋 No encontramos ninguna visita técnica generada sin asignar a tu nombre.\n\n💬 Si necesitas generar una nueva visita, ve a *Soporte Técnico* en el menú.');
            return;
        }

        const visita = visitasPendientes[0];

        // Formatear fecha de creación
        let fechaCreacion = 'No disponible';
        if (visita.fecha_creacion) {
            const fecha = new Date(visita.fecha_creacion);
            fechaCreacion = fecha.toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        // Mostrar información de la visita
        await enviarMensaje(chatId, `📋 *VISITA TÉCNICA ENCONTRADA*\n\n🆔 *ID:* ${visita.id}\n\n📅 *Fecha de creación:* ${fechaCreacion}\n\n📝 *Motivo:* ${visita.motivo_visita}\n\n⚠️ *¿Estás seguro que deseas CANCELAR esta visita técnica?*\n\n1️⃣ ✅ Sí, cancelar\n\n2️⃣ ❌ No, mantener visita\n\n#️⃣ ⬅️ Volver al menú principal`);

        // Guardar ID de visita en el estado
        actualizarEstadoUsuario(chatId, {
            seguimiento: { paso: 'confirmar_cancelacion_visita', visitaId: visita.id },
            erroresConsecutivos: 0
        });

    } catch (error) {
        console.error('❌ Error buscando visita técnica:', error);
        await enviarMensaje(chatId, '❌ Hubo un error al buscar tu visita técnica. Por favor, intenta nuevamente.');
    }
}

async function manejarConfirmacionCancelacionVisita(chatId, texto, visitaId, clienteEncontrado) {
    if (texto === '1') {
        // CONFIRMA cancelación
        if (!clienteEncontrado || !clienteEncontrado.cliente) {
            await enviarMensaje(chatId, '❌ Error: No pudimos identificar tu información.');
            return;
        }

        const { cliente } = clienteEncontrado;
        const numeroCliente = chatId.replace('@c.us', '').replace('@lid', '');

        try {
            const conexion = await mysql.createConnection({
                host: process.env.DB_SYSTEM_HOST,
                user: process.env.DB_SYSTEM_USER,
                password: process.env.DB_SYSTEM_PASSWORD,
                database: process.env.DB_SYSTEM_DATABASE
            });

            // Obtener información actual de observaciones
            const [visitaActual] = await conexion.execute(
                'SELECT observacion FROM visitas_tecnicas WHERE id = ?',
                [visitaId]
            );

            const fechaHoraCancelacion = new Date().toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // Preparar nueva observación
            let nuevaObservacion = `Cancelada por el cliente desde WhatsApp - Número: ${numeroCliente} - Fecha: ${fechaHoraCancelacion}`;
            if (visitaActual.length > 0 && visitaActual[0].observacion) {
                nuevaObservacion = visitaActual[0].observacion + ' | ' + nuevaObservacion;
            }

            // Actualizar visita a estado completada con observación de cancelación
            await conexion.execute(
                `UPDATE visitas_tecnicas
                 SET estado = 'completada',
                     fecha_completada = NOW(),
                     observacion = ?
                 WHERE id = ?`,
                [nuevaObservacion, visitaId]
            );

            // Crear registro en reportes_visitas para que aparezca en reportes
            const notasReporte = `CANCELACIÓN POR CLIENTE\n\nVisita técnica cancelada por el cliente desde WhatsApp.\nNúmero: ${numeroCliente}\nFecha cancelación: ${fechaHoraCancelacion}\n\nMotivo: Solicitud del cliente`;

            await conexion.execute(
                `INSERT INTO reportes_visitas (
                    visita_id,
                    tecnico_id,
                    notas,
                    problemas_encontrados,
                    solucion_aplicada,
                    cliente_satisfecho,
                    requiere_seguimiento,
                    fecha_reporte
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    visitaId,
                    null, // NULL para mostrar "Ninguno" como técnico
                    notasReporte,
                    'Visita cancelada por solicitud del cliente',
                    'Cancelada - No requirió atención técnica',
                    'si', // Cliente satisfecho porque canceló voluntariamente
                    0
                ]
            );

            await conexion.end();

            console.log(`✅ Visita técnica ${visitaId} cancelada por cliente ${cliente.nombre} (${numeroCliente}) - Reporte creado`);
            registrarLog(`Visita técnica ${visitaId} cancelada por cliente ${cliente.nombre} desde WhatsApp ${numeroCliente} - Reporte generado`);

            await enviarMensaje(chatId, '✅ *VISITA TÉCNICA CANCELADA*\n\n📋 Tu visita técnica ha sido cancelada exitosamente.\n\n✨ Si en el futuro necesitas soporte, puedes generar una nueva visita desde el menú de *Soporte Técnico*.\n\n😊 ¡Gracias por informarnos!');

            // Limpiar chat completamente sin activar modo humano
            limpiarChatCompleto(chatId);

        } catch (error) {
            console.error('❌ Error cancelando visita técnica:', error);
            await enviarMensaje(chatId, '❌ Hubo un error al cancelar la visita técnica. Por favor, contacta con un asesor.');
        }

    } else if (texto === '2') {
        // NO cancela - Mantener visita activa
        await enviarMensaje(chatId, '✅ Perfecto, tu visita técnica se mantiene activa.\n\n📋 Un técnico será asignado próximamente.');

        // Limpiar chat completamente sin activar modo humano
        limpiarChatCompleto(chatId);
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'confirmar_cancelacion_visita');
    }
}

async function manejarRespuestaAsesorEstado(chatId, texto) {
    if (texto === '1') {
        // Usuario quiere hablar con un asesor - Transferir a modo humano
        await transferirAsesor(chatId);
    } else if (texto === '2') {
        // Usuario no desea hablar con asesor - Finalizar chat con mensaje de despedida
        await enviarMensaje(chatId, '😊 *¡Perfecto!* Gracias por contactarnos.\n\n✨ Si necesitas algo más, no dudes en escribirnos.\n\n¡Que tengas un excelente día! 👋');

        // Limpiar el chat completamente
        limpiarChatCompleto(chatId);
        registrarLog(`Chat finalizado para ${chatId} después de consultar estado de cuenta`);
    } else if (texto === '#') {
        // Usuario quiere volver al menú principal
        const estado = obtenerEstadoUsuario(chatId);
        if (estado.clienteEncontrado && estado.clienteEncontrado.cliente) {
            const { cliente } = estado.clienteEncontrado;
            await enviarMensaje(chatId, `👋 ¡Hola de nuevo, *${cliente.nombre}*! 😊\n\n✅ *ESTADO:* *${cliente.estado}*\n\n💬 ¿En qué podemos ayudarte hoy?`);
            await enviarMensaje(chatId, `📋 *MENÚ DE SERVICIOS*\n\n1️⃣ 💰 Registrar pago (registro de plazos)\n\n2️⃣ 🔧 Soporte técnico (cambio de contraseña)\n\n3️⃣ 📊 Mi estado de cuenta (valor a cancelar y cuenta de pago)\n\n4️⃣ 🏠 Traslado de servicio\n\n#️⃣ ⬅️ Volver al menú principal`);
            actualizarEstadoUsuario(chatId, {
                seguimiento: { paso: 'menu_usuario' },
                erroresConsecutivos: 0,
                enEsperaHumano: null  // IMPORTANTE: Asegurar que NO esté en modo humano
            });

            // NUEVO: Persistir cambio a modo bot en BD
            await persistirModoChat(chatId, 'bot');
        } else {
            actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
            await mostrarMenuPrincipal(chatId);
        }
    } else {
        // Opción inválida
        await manejarOpcionInvalida(chatId, 'esperar_respuesta_asesor_estado');
    }
}

async function manejarSoporteTecnico(chatId, texto) {
    if (texto === '1') {
        await enviarMensaje(chatId, '✉️ Por favor, envía tu nuevo nombre o contraseña. 🔑\n\nEscribe claramente el cambio que deseas realizar.');
        await transferirAsesor(chatId);
    } else if (texto === '2') {
        await enviarMensaje(chatId, `📶 *PROBLEMAS DE SERVICIO*\n\n1️⃣ 🚫 No tienes internet\n\n2️⃣ 🐌 Internet lento o intermitente\n\n3️⃣ 💬 Otro problema o inquietud\n\n#️⃣ ⬅️ Volver al menú principal`);
        actualizarEstadoUsuario(chatId, {
            seguimiento: { ...obtenerEstadoUsuario(chatId).seguimiento, paso: 'reporte_servicio' },
            erroresConsecutivos: 0
        });
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'soporte_tecnico');
    }
}

async function manejarReporteServicio(chatId, texto) {
    if (texto === '1') {
        await enviarMensaje(chatId, '🚨 *¿Presentas alguna luz roja en tu módem?*\n\n1️⃣ ✅ Sí\n\n2️⃣ ❌ No');
        actualizarEstadoUsuario(chatId, {
            seguimiento: { ...obtenerEstadoUsuario(chatId).seguimiento, paso: 'luz_roja' },
            erroresConsecutivos: 0
        });
    } else if (texto === '2') {
        const rutaImagen = './images/desconectarmodem.jpg';
        const media = MessageMedia.fromFilePath(rutaImagen);
        await enviarMensaje(chatId, media, rutaImagen);
        await enviarMensaje(chatId, '📶 *Después de este paso, ¿funciona con normalidad tu servicio?*\n\n1️⃣ ✅ Sí, funciona bien\n\n2️⃣ ❌ No, sigue el problema');
        actualizarEstadoUsuario(chatId, {
            seguimiento: { ...obtenerEstadoUsuario(chatId).seguimiento, paso: 'problema_lento' },
            erroresConsecutivos: 0
        });
    } else if (texto === '3') {
        await enviarMensaje(chatId, '🔧 *Conectándote con nuestro equipo técnico especializado...* 👨‍💻\n\n📝 Mientras tanto, cuéntanos qué inconveniente presentas con el servicio:');
        await transferirAsesor(chatId);
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'reporte_servicio');
    }
}

async function manejarLuzRoja(chatId, texto, clienteEncontrado) {
    if (texto === '2') {
        const rutaImagen = './images/desconectarmodem.jpg';
        const media = MessageMedia.fromFilePath(rutaImagen);
        await enviarMensaje(chatId, media, rutaImagen);
        await enviarMensaje(chatId, '📶 Despues de este paso, Funciona con normalidad tu servicio ?\n1.SI\n2.No');
        actualizarEstadoUsuario(chatId, {
            seguimiento: { ...obtenerEstadoUsuario(chatId).seguimiento, paso: 'problema_lento' },
            erroresConsecutivos: 0
        });
    } else if (texto === '1') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });

        await enviarMensaje(chatId, '🔍 VERIFICANDO VISITAS PENDIENTES...');

        let visitaGenerada = false;

        if (clienteEncontrado) {
            const { cliente, bd } = clienteEncontrado;
            try {
                // Buscar cliente con todos los datos completos usando buscarClientesConSerial
                console.log(`🔍 [LUZ ROJA] Buscando datos completos del cliente con cédula: ${cliente.cedula}`);
                const resultadoBusqueda = await buscarClientesConSerial(cliente.cedula);

                let clienteCompleto = null;
                let bdOrigen = null;

                if (resultadoBusqueda.success && resultadoBusqueda.clientes.length > 0) {
                    // Tomar el primer resultado que coincida con la cédula exacta
                    clienteCompleto = resultadoBusqueda.clientes.find(c => c.cedula === cliente.cedula) || resultadoBusqueda.clientes[0];
                    bdOrigen = clienteCompleto.bd_info;
                    console.log(`✅ [LUZ ROJA] Cliente encontrado: ${clienteCompleto.nombre} - ${clienteCompleto.cedula}`);
                } else {
                    // Fallback: usar datos del cliente encontrado originalmente
                    console.log(`⚠️ [LUZ ROJA] No se encontró cliente completo, usando datos básicos`);
                    clienteCompleto = cliente;
                    bdOrigen = bd;
                }

                // VERIFICAR SI YA TIENE VISITAS SIN ASIGNAR
                const conexion = await mysql.createConnection({
                    host: process.env.DB_SYSTEM_HOST,
                    user: process.env.DB_SYSTEM_USER,
                    password: process.env.DB_SYSTEM_PASSWORD,
                    database: process.env.DB_SYSTEM_DATABASE
                });

                const [visitasExistentes] = await conexion.execute(
                    `SELECT id, motivo_visita, fecha_creacion, observacion
                     FROM visitas_tecnicas
                     WHERE cliente_cedula = ?
                     AND tecnico_asignado_id IS NULL
                     AND estado NOT IN ('completada', 'cancelada')
                     ORDER BY fecha_creacion DESC
                     LIMIT 1`,
                    [clienteCompleto.cedula]
                );

                await conexion.end();

                if (visitasExistentes.length > 0) {
                    // YA TIENE UNA VISITA PENDIENTE
                    const visitaExistente = visitasExistentes[0];
                    console.log(`⚠️ [LUZ ROJA] Cliente ${clienteCompleto.nombre} ya tiene una visita sin asignar (ID: ${visitaExistente.id})`);

                    // Formatear fecha de creación
                    let fechaGeneracion = 'recientemente';
                    if (visitaExistente.fecha_creacion) {
                        const fecha = new Date(visitaExistente.fecha_creacion);
                        fechaGeneracion = fecha.toLocaleString('es-CO', {
                            timeZone: 'America/Bogota',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                    }

                    // Si tiene observación con fecha, usarla
                    if (visitaExistente.observacion && visitaExistente.observacion.includes('Generada desde el chatbot')) {
                        const fechaMatch = visitaExistente.observacion.match(/(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2})/);
                        if (fechaMatch) {
                            fechaGeneracion = fechaMatch[1];
                        }
                    }

                    await enviarMensaje(chatId, `⚠️ *NO SE PUEDE GENERAR OTRA VISITA*\n\n📋 Ya cuentas con una visita técnica pendiente en nuestro sistema.\n\n📅 *Generada:* ${fechaGeneracion}\n\n👨‍🔧 Un técnico será asignado próximamente para atender tu solicitud.\n\n📩 Recibirás un mensaje de confirmación con la fecha exacta de tu visita.\n\n🙏 Gracias por tu comprensión.`);
                    visitaGenerada = false;

                    // Preguntar si quiere hablar con asesor (Escenario A)
                    await enviarMensaje(chatId, '💬 *¿Deseas hablar con un asesor?*\n\n1️⃣ ✅ Sí\n\n2️⃣ ❌ No');

                    actualizarEstadoUsuario(chatId, {
                        seguimiento: { paso: 'pregunta_asesor_visita_existente' },
                        erroresConsecutivos: 0
                    });
                    return;
                } else {
                    // NO TIENE VISITAS PENDIENTES, CREAR NUEVA
                    console.log(`✅ [LUZ ROJA] Cliente ${clienteCompleto.nombre} no tiene visitas pendientes, procediendo a crear nueva`);

                    // Crear soporte en la base de datos del cliente
                    await crearSoporte(clienteCompleto.id, bdOrigen);

                    // Crear visita técnica sin fecha asignada con todos los datos completos
                    const fechaHoraActual = new Date().toLocaleString('es-CO', {
                        timeZone: 'America/Bogota',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });

                    const datosVisita = {
                        cliente_id: clienteCompleto.id,
                        cliente_nombre: clienteCompleto.nombre,
                        cliente_cedula: clienteCompleto.cedula,
                        cliente_telefono: clienteCompleto.telefono || '',
                        cliente_movil: clienteCompleto.movil || '',
                        cliente_direccion: clienteCompleto.direccion || clienteCompleto.direccion_principal || '',
                        cliente_coordenadas: clienteCompleto.coordenadas || '',
                        mikrotik_nombre: clienteCompleto.mikrotik_nombre || '',
                        usuario_ppp: clienteCompleto.usuario_ppp || '',
                        motivo_visita: 'Luz roja en el equipo',
                        fecha_programada: null, // Sin fecha asignada
                        bd_origen: clienteCompleto.bd_origen || bdOrigen.host,
                        notas_admin: `Generada desde el chatbot - ${fechaHoraActual}`,
                        observacion: `Generada desde el chatbot - ${fechaHoraActual}`,
                        serial_equipo_asignado: clienteCompleto.serial_equipo_asignado || null,
                        equipo_tipo: clienteCompleto.equipo_tipo || null,
                        equipo_estado: clienteCompleto.equipo_estado || null
                    };

                    console.log(`📋 [LUZ ROJA] Datos de visita preparados:`, {
                        cliente_id: datosVisita.cliente_id,
                        cliente_nombre: datosVisita.cliente_nombre,
                        cliente_cedula: datosVisita.cliente_cedula,
                        cliente_direccion: datosVisita.cliente_direccion,
                        motivo_visita: datosVisita.motivo_visita,
                        fecha_programada: datosVisita.fecha_programada,
                        bd_origen: datosVisita.bd_origen
                    });

                    // Usar usuario del sistema (admin) para crear la visita
                    const resultadoVisita = await crearVisitaTecnica(datosVisita, 1);

                    if (resultadoVisita.success) {
                        console.log(`✅ [LUZ ROJA] Visita técnica creada exitosamente para ${clienteCompleto.nombre} (${clienteCompleto.cedula})`);
                        registrarLog(`Visita técnica sin fecha creada para cliente ${clienteCompleto.nombre} (${clienteCompleto.cedula}) por luz roja en modem`);
                        await enviarMensaje(chatId, '✅ *VISITA TÉCNICA GENERADA*\n\n📋 Hemos registrado tu solicitud de visita técnica.\n\n⏰ *Tiempo estimado:* Serás visitado dentro de 3 días hábiles, aunque vamos a tratar de hacerlo lo antes posible.\n\n👨‍🔧 Es exclusivo que el técnico te visite para resolver tu problema.\n\n📩 *Importante:* Recibirás un mensaje de confirmación con la fecha exacta en que se realizará tu visita.\n\n🙏 Disculpa las molestias generadas.');
                        visitaGenerada = true;

                        // PREGUNTAR SI TIENE ALGUNA DUDA ADICIONAL (Escenario B - cuando se generó la visita)
                        await enviarMensaje(chatId, '❓ *¿Tienes alguna duda o consulta adicional?*\n\n1️⃣ ✅ Sí\n\n2️⃣ ❌ No');

                        actualizarEstadoUsuario(chatId, {
                            seguimiento: { paso: 'pregunta_duda_post_visita' },
                            erroresConsecutivos: 0
                        });
                    } else {
                        console.error(`❌ [LUZ ROJA] Error al crear visita técnica: ${resultadoVisita.message}`);
                        registrarLog(`Error creando visita técnica: ${resultadoVisita.message}`);
                        await enviarMensaje(chatId, '❌ Hubo un error al generar la visita técnica. Por favor, intenta nuevamente o contacta a un asesor.');
                    }
                }
            } catch (error) {
                console.error(`❌ [LUZ ROJA] Error en proceso de creación de visita: ${error.message}`);
                registrarLog(`Error creando soporte o visita: ${error.message}`);
                await enviarMensaje(chatId, '❌ Hubo un error al procesar tu solicitud. Por favor, intenta nuevamente.');
            }
        }
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'luz_roja');
    }
}

// Escenario A: Ya tiene visita existente - Preguntar si quiere hablar con asesor
async function manejarPreguntaAsesorVisitaExistente(chatId, texto) {
    if (texto === '1') {
        // SÍ quiere hablar con asesor
        await transferirAsesor(chatId);
    } else if (texto === '2') {
        // NO quiere hablar con asesor - FINALIZAR CHAT (sin modo humano)
        await enviarMensaje(chatId, '😊 *¡Gracias por contactarnos!*\n\n✨ Ha sido un placer atenderte.\n\n📞 Recuerda que estamos disponibles cuando nos necesites.\n\n🌟 Que tengas un excelente día.\n\n💚 *SOLUCNET.SAS*');

        // Limpiar estado completamente sin activar modo humano
        limpiarChatCompleto(chatId);
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'pregunta_asesor_visita_existente');
    }
}

// Escenario B: Visita generada exitosamente - Preguntar si tiene duda adicional
async function manejarPreguntaDudaPostVisita(chatId, texto) {
    if (texto === '1') {
        // SÍ tiene duda adicional - Transferir a asesor
        await transferirAsesor(chatId);
    } else if (texto === '2') {
        // NO tiene duda adicional - FINALIZAR CHAT (sin modo humano)
        await enviarMensaje(chatId, '😊 *¡Gracias por contactarnos!*\n\n✨ Ha sido un placer atenderte.\n\n📞 Recuerda que estamos disponibles cuando nos necesites.\n\n🌟 Que tengas un excelente día.\n\n💚 *SOLUCNET.SAS*');

        // Limpiar estado completamente sin activar modo humano
        limpiarChatCompleto(chatId);
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'pregunta_duda_post_visita');
    }
}

async function manejarProblemaLento(chatId, texto) {
    if (texto === '1') {
        await enviarMensaje(chatId, '😊 Me alegra que ya tengas servicio, fue un placer ayudarte. Que tengas un excelente dia!');

        actualizarEstadoUsuario(chatId, {
            seguimiento: null,
            enEsperaHumano: {
                contador: 0,
                ultimaRespuesta: Date.now()
            },
            erroresConsecutivos: 0
        });
    } else if (texto === '2') {
        await enviarMensaje(chatId, '💬 Te estamos conectando con un especialista en soporte técnico...\nMientras tanto, descríbenos detalladamente el problema que presentas: ');
        await transferirAsesor(chatId);
    } else if (texto === '9' || texto === '#') {
        actualizarEstadoUsuario(chatId, { seguimiento: null, erroresConsecutivos: 0 });
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'problema_lento');
    }
}

// Función para manejar la localidad del traslado
async function manejarTrasladoLocalidad(chatId, texto) {
    const localidad = texto.trim();

    if (localidad.length < 3) {
        await enviarMensaje(chatId, '⚠️ Por favor, escribe el nombre completo de la localidad.');
        return;
    }

    // Guardar localidad y pedir dirección
    actualizarEstadoUsuario(chatId, {
        seguimiento: {
            paso: 'traslado_direccion',
            localidad: localidad
        },
        erroresConsecutivos: 0
    });

    await enviarMensaje(chatId, `✅ Localidad registrada: *${localidad}*\n\n🏠 Ahora, por favor indícanos la *dirección completa* de tu nueva ubicación:`);
}

// Función para manejar la dirección del traslado
async function manejarTrasladoDireccion(chatId, texto, seguimiento) {
    const direccion = texto.trim();
    const localidad = seguimiento.localidad || 'No especificada';

    if (direccion.length < 5) {
        await enviarMensaje(chatId, '⚠️ Por favor, escribe la dirección completa.');
        return;
    }

    // Enviar resumen de la solicitud
    await enviarMensaje(chatId,
        `📋 *RESUMEN DE SOLICITUD DE TRASLADO*\n\n` +
        `📍 *Localidad:* ${localidad}\n` +
        `🏠 *Dirección:* ${direccion}\n\n` +
        `✅ Hemos registrado tu solicitud de traslado de servicio.\n\n` +
        `👨‍💼 Te estamos conectando con un asesor para procesar tu traslado...`
    );

    // Registrar en logs para seguimiento
    registrarLog(`[TRASLADO] Cliente ${chatId} solicita traslado a: ${localidad} - ${direccion}`);

    // Transferir a modo humano para que el asesor gestione el traslado
    await transferirAsesor(chatId);
}

async function manejarMenuPrincipal(chatId, texto) {
    if (texto === '1') {
        await enviarMensaje(chatId, '👤 Por favor, introduce tu numero de cedula, Recuerda que no debe de llevar espacios:');
        actualizarEstadoUsuario(chatId, { esperandoCedula: true, erroresConsecutivos: 0 });
    } else if (texto === '2') {
        await enviarMensaje(chatId, '👤 Perfecto, para comenzar dime tu *nombre completo*:');
        actualizarEstadoUsuario(chatId, { 
            seguimiento: { paso: 'nuevo_usuario_nombre' },
            erroresConsecutivos: 0
        });
    } else if (texto === '3') {
        await enviarMensaje(chatId, '👤 Nos alegra que quieras regresar, introduce tu numero de cedula, Recuerda que no debe de llevar espacios:');
        actualizarEstadoUsuario(chatId, { esperandoCedula2: true, erroresConsecutivos: 0 });
    } else if (texto === '4') {
        await enviarMensaje(chatId, '👤 Perfecto, para comenzar dime tu *nombre completo*:');
        actualizarEstadoUsuario(chatId, { 
            seguimiento: { paso: 'paso4' },
            erroresConsecutivos: 0
        });
    } else if (texto === '9') {
        await mostrarMenuPrincipal(chatId);
    } else {
        await manejarOpcionInvalida(chatId, 'menu_principal');
    }
}

// ===== Funciones de utilidad =====

// ===================================================================
// FUNCIÓN DE VALIDACIÓN DE ESTADO BAJO DEMANDA
// ===================================================================
// Esta función se llama MANUALMENTE cuando se necesita verificar
// el estado del cliente antes de operaciones críticas.
// PROPÓSITO:
//   - Verificar estado del cliente bajo demanda (no periódica)
//   - Usada ANTES de enviar mensajes para validar conexión
//   - Puede actualizar whatsappListo si detecta discrepancia
//   - Retorna true/false indicando si el cliente está conectado
//
// DIFERENCIA con verificarEstadoWhatsApp() (línea 2157):
//   - Esta NO se ejecuta automáticamente
//   - Esta RETORNA un valor (true/false)
//   - Esta es para validaciones específicas, no monitoreo general
// ===================================================================
async function verificarEstadoClienteWhatsApp() {
    try {
        if (!client) {
            return false;
        }

        // Si el cliente se está iniciando, no verificar estado para no interferir
        if (clienteIniciando) {
            return whatsappListo;
        }

        // Intentar obtener información del cliente para verificar conexión real
        const info = await client.getState();

        // Estados válidos para considerar como conectado
        const estadosConectados = ['CONNECTED', 'OPENING', 'PAIRING'];
        const estaConectado = estadosConectados.includes(info);

        // Solo actualizar whatsappListo si hay una discrepancia significativa
        if (estaConectado && !whatsappListo) {
            console.log('🔄 [ESTADO WHATSAPP] Cliente conectado, actualizando estado...');
            whatsappListo = true;
        } else if (!estaConectado && whatsappListo && info !== 'INITIALIZING') {
            // Solo marcar como desconectado si no está inicializando
            console.log('🔄 [ESTADO WHATSAPP] Cliente desconectado, actualizando estado...');
            whatsappListo = false;
        }

        return estaConectado;
    } catch (error) {
        // Solo actuar si es un error grave, no errores normales durante inicialización
        if (!error.message.includes('Target closed') && !error.message.includes('Session closed') && !clienteIniciando) {
            console.log(`❌ [ESTADO WHATSAPP] Error verificando estado: ${error.message}`);
            if (whatsappListo) {
                whatsappListo = false;
            }
        }
        return whatsappListo; // Durante errores, mantener el estado actual
    }
}

// ===== FUNCIÓN DE SIMULACIÓN DE COMPORTAMIENTO HUMANO MEJORADA =====
// SOLO para mensajes del chatbot (respuestas automáticas a usuarios)
async function simularComportamientoHumano(chatId, mensaje) {
    try {
        const chat = await client.getChatById(chatId);

        // 1. Delay aleatorio antes de marcar como visto (0.1-0.3 segundos) - ULTRA OPTIMIZADO
        const delayVisto = 100 + Math.random() * 200;
        console.log(`👁️ [HUMANO] Esperando ${Math.round(delayVisto)}ms antes de marcar como visto`);
        await new Promise(r => setTimeout(r, delayVisto));

        // 2. Marcar como visto (no siempre - 70% de las veces, reducido para más fluidez)
        if (Math.random() < 0.7) {
            try {
                await chat.sendSeen();
                console.log(`✅ [HUMANO] Mensaje marcado como visto`);
            } catch (e) {
                console.log(`⚠️ [HUMANO] No se pudo marcar como visto: ${e.message}`);
            }
        } else {
            console.log(`👻 [HUMANO] Simulando no marcar como visto (más humano)`);
        }

        // 3. Calcular tiempo de "escritura" ULTRA OPTIMIZADO para máximo 1.5 segundos
        const longitudMensaje = typeof mensaje === 'string' ? mensaje.length : 50;

        // Velocidad de escritura variable: 3-8ms por carácter - ULTRA OPTIMIZADO
        const velocidadPorCaracter = 3 + Math.random() * 5;

        const tiempoBase = Math.min(
            200 + (longitudMensaje * velocidadPorCaracter),
            1500 // máximo 1.5 segundos - ULTRA REDUCIDO
        );

        // Agregar variación aleatoria menor
        const variacion = tiempoBase * (0.6 + Math.random() * 0.4);
        const tiempoEscritura = Math.round(variacion);

        console.log(`⌨️ [HUMANO] Simulando escritura por ${tiempoEscritura}ms (${longitudMensaje} caracteres a ${velocidadPorCaracter.toFixed(0)}ms/char)`);

        // 4. Enviar estado "escribiendo" (reducido a 60% para más fluidez)
        if (Math.random() < 0.6) {
            try {
                await chat.sendStateTyping();
                console.log(`✅ [HUMANO] Estado "escribiendo..." activado`);
            } catch (e) {
                console.log(`⚠️ [HUMANO] No se pudo activar estado escribiendo: ${e.message}`);
            }
        }

        // 5. Esperar el tiempo de escritura SIN pausas intermedias - OPTIMIZADO
        await new Promise(r => setTimeout(r, tiempoEscritura));

        // 6. Pausa adicional aleatoria ELIMINADA para mejorar fluidez
        // Se elimina la pausa de "revisión" para evitar pérdida de mensajes

        console.log(`✅ [HUMANO] Simulación de comportamiento completada`);
        return true;
    } catch (error) {
        console.log(`⚠️ [HUMANO] Error en simulación: ${error.message}`);
        // Delay mínimo reducido
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
        return false;
    }
}

// ===== FUNCIÓN DE SIMULACIÓN DE COMPORTAMIENTO HUMANO PARA MENSAJES API =====
// SOLO para mensajes enviados desde la API externa (más realista y lento)
async function simularComportamientoHumanoAPI(chatId, mensaje, chatObjeto = null) {
    try {
        // Reutilizar objeto chat si se proporciona, evita llamada duplicada a getChatById
        const chat = chatObjeto || await client.getChatById(chatId);

        // 1. Delay aleatorio antes de marcar como visto (1-4 segundos) - MÁS HUMANO
        const delayVisto = 1000 + Math.random() * 3000;
        console.log(`👁️ [API-HUMANO] Esperando ${Math.round(delayVisto)}ms antes de marcar como visto`);
        await new Promise(r => setTimeout(r, delayVisto));

        // 2. Marcar como visto (solo el 80% de las veces - más humano)
        if (Math.random() < 0.8) {
            try {
                await chat.sendSeen();
                console.log(`✅ [API-HUMANO] Mensaje marcado como visto`);
            } catch (e) {
                console.log(`⚠️ [API-HUMANO] No se pudo marcar como visto: ${e.message}`);
            }
        } else {
            console.log(`👻 [API-HUMANO] Simulando no marcar como visto (más humano)`);
        }

        // 3. Calcular tiempo de "escritura" realista (2-6 segundos según longitud)
        const longitudMensaje = typeof mensaje === 'string' ? mensaje.length : 50;

        // Velocidad de escritura humana: 40-80ms por carácter
        const velocidadPorCaracter = 40 + Math.random() * 40;

        const tiempoBase = Math.min(
            2000 + (longitudMensaje * velocidadPorCaracter),
            6000 // máximo 6 segundos
        );

        // Agregar variación aleatoria
        const variacion = tiempoBase * (0.8 + Math.random() * 0.4);
        const tiempoEscritura = Math.round(variacion);

        console.log(`⌨️ [API-HUMANO] Simulando escritura por ${tiempoEscritura}ms (${longitudMensaje} caracteres a ${velocidadPorCaracter.toFixed(0)}ms/char)`);

        // 4. Enviar estado "escribiendo" (90% de las veces)
        if (Math.random() < 0.9) {
            try {
                await chat.sendStateTyping();
                console.log(`✅ [API-HUMANO] Estado "escribiendo..." activado`);
            } catch (e) {
                console.log(`⚠️ [API-HUMANO] No se pudo activar estado escribiendo: ${e.message}`);
            }
        }

        // 5. Esperar el tiempo de escritura
        await new Promise(r => setTimeout(r, tiempoEscritura));

        // 6. Pausa adicional de "revisión" antes de enviar (0.5-2 segundos)
        const pausaRevision = 500 + Math.random() * 1500;
        console.log(`🔍 [API-HUMANO] Pausa de revisión: ${Math.round(pausaRevision)}ms`);
        await new Promise(r => setTimeout(r, pausaRevision));

        console.log(`✅ [API-HUMANO] Simulación de comportamiento API completada`);
        return true;
    } catch (error) {
        console.log(`⚠️ [API-HUMANO] Error en simulación: ${error.message}`);
        // Delay mínimo de 2 segundos en caso de error
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        return false;
    }
}

// ===== CACHE DE NÚMEROS VALIDADOS EN WHATSAPP =====
const numerosValidadosCache = new Map(); // chatId -> { existe: boolean, timestamp: number }
const CACHE_VALIDACION_TIEMPO = 24 * 60 * 60 * 1000; // 24 horas

// ===== FUNCIÓN PARA VERIFICAR SI UN NÚMERO EXISTE EN WHATSAPP =====
async function verificarNumeroExisteEnWhatsApp(chatId) {
    // Verificar si está en caché y es reciente
    if (numerosValidadosCache.has(chatId)) {
        const cached = numerosValidadosCache.get(chatId);
        const ahora = Date.now();

        // Si el caché es reciente (menos de 24 horas), usarlo
        if (ahora - cached.timestamp < CACHE_VALIDACION_TIEMPO) {
            console.log(`✅ [VALIDAR] Número ${chatId} en caché: ${cached.existe ? 'EXISTE' : 'NO EXISTE'}`);
            return cached.existe;
        } else {
            // Caché expirado, eliminar
            numerosValidadosCache.delete(chatId);
        }
    }

    try {
        console.log(`🔍 [VALIDAR] Verificando si ${chatId} existe en WhatsApp...`);

        // Normalizar el chatId
        let numeroParaValidar = chatId;

        // Si es un @c.us o @lid, extraer solo el número
        if (chatId.includes('@')) {
            numeroParaValidar = chatId.split('@')[0];
        }

        // Usar el método isRegisteredUser de whatsapp-web.js
        const isRegistered = await client.isRegisteredUser(chatId);

        if (isRegistered) {
            console.log(`✅ [VALIDAR] ${chatId} EXISTE en WhatsApp`);
            // Guardar en caché
            numerosValidadosCache.set(chatId, {
                existe: true,
                timestamp: Date.now()
            });
            return true;
        } else {
            console.log(`❌ [VALIDAR] ${chatId} NO EXISTE en WhatsApp`);
            // Guardar en caché (también los que no existen)
            numerosValidadosCache.set(chatId, {
                existe: false,
                timestamp: Date.now()
            });
            return false;
        }
    } catch (error) {
        console.error(`⚠️ [VALIDAR] Error verificando ${chatId}: ${error.message}`);

        // Si es error de sesión cerrada, asumir que el número existe (permitir intento de envío)
        if (error.message.includes('Session closed') || error.message.includes('Protocol error')) {
            console.log(`⚠️ [VALIDAR] Error de sesión en isRegisteredUser, asumiendo que ${chatId} existe para permitir envío`);
            // No guardar en caché, solo permitir que continúe el flujo
            return true; // Permitir envío, el error de sesión se manejará en enviarMensaje()
        }

        // En caso de error, intentar validar por método alternativo
        try {
            const chat = await client.getChatById(chatId);
            if (chat) {
                console.log(`✅ [VALIDAR] ${chatId} validado por método alternativo (chat existe)`);
                numerosValidadosCache.set(chatId, {
                    existe: true,
                    timestamp: Date.now()
                });
                return true;
            }
        } catch (chatError) {
            // Si el método alternativo también falla por sesión cerrada, permitir envío
            if (chatError.message.includes('Session closed') || chatError.message.includes('Protocol error')) {
                console.log(`⚠️ [VALIDAR] Error de sesión en getChatById alternativo, permitiendo envío de ${chatId}`);
                return true; // Permitir envío, el error se manejará en enviarMensaje()
            }

            console.log(`❌ [VALIDAR] ${chatId} no pudo ser validado: ${chatError.message}`);
            // No guardar en caché si hay error, para reintentar después
            return false;
        }

        return false;
    }
}

// Limpiar caché de validación periódicamente (cada 6 horas)
setInterval(() => {
    const ahora = Date.now();
    let eliminados = 0;

    for (const [chatId, data] of numerosValidadosCache.entries()) {
        if (ahora - data.timestamp > CACHE_VALIDACION_TIEMPO) {
            numerosValidadosCache.delete(chatId);
            eliminados++;
        }
    }

    if (eliminados > 0) {
        console.log(`🧹 [VALIDAR] Limpieza de caché: ${eliminados} entradas eliminadas. Cache actual: ${numerosValidadosCache.size}`);
    }
}, 6 * 60 * 60 * 1000); // Cada 6 horas

// ===== FUNCIÓN PARA VERIFICAR Y APLICAR PAUSAS HUMANAS MEJORADA =====
async function verificarPausasHumanas() {
    globalRateLimit.mensajesConsecutivos++;

    // Umbral más variable: entre 8-12 mensajes (aumentado para permitir más fluidez)
    const umbralPausa = 8 + Math.floor(Math.random() * 5); // 8-12 mensajes

    if (globalRateLimit.mensajesConsecutivos >= umbralPausa) {
        // Pausa reducida: 1-2 segundos (reducido para evitar pérdida de mensajes)
        const pausaLarga = 1000 + Math.random() * 1000; // 1s - 2s
        console.log(`⏸️ [PAUSA HUMANA] Aplicando pausa de ${Math.round(pausaLarga/1000)}s después de ${globalRateLimit.mensajesConsecutivos} mensajes`);
        console.log(`📊 [PAUSA HUMANA] Mensajes en cola pendiente: ${colaMensajesPendientes.cola.length}`);

        globalRateLimit.mensajesConsecutivos = 0;
        globalRateLimit.ultimaPausaLarga = Date.now();
        await new Promise(r => setTimeout(r, pausaLarga));

        // Después de la pausa, procesar mensajes pendientes
        console.log(`🔄 [PAUSA HUMANA] Pausa completada. Procesando cola pendiente...`);
        await procesarColaPendientes();
    }
}

// ===== FUNCIÓN PARA ENVIAR MENSAJE DIRECTO (sin verificaciones de pausa) =====
// Usada por la cola de mensajes pendientes
async function enviarMensajeDirecto(chatId, contenido, rutaImagen = null, esAPIExterna = false) {
    console.log(`📤 [ENVIAR DIRECTO] Enviando a ${chatId}: "${typeof contenido === 'string' ? contenido.substring(0, 50) : '[Media]'}"`);

    // Verificar si el número está bloqueado
    const chatIdLimpio = chatId.replace('@c.us', '').replace('@lid', '');
    if (NUMEROS_BLOQUEADOS.includes(chatId) || NUMEROS_BLOQUEADOS.includes(chatIdLimpio)) {
        console.log(`🚫 [BLOQUEADO] Mensaje directo rechazado para número bloqueado: ${chatId}`);
        registrarLog(`[BLOQUEADO] Mensaje directo rechazado para número bloqueado: ${chatId}`);
        return false;
    }

    // Verificaciones básicas
    if (!whatsappListo || !client) {
        console.log(`❌ [ENVIAR DIRECTO] WhatsApp no disponible`);
        return false;
    }

    if (!chatId || chatId.trim() === '') {
        console.log(`❌ [ENVIAR DIRECTO] ChatId inválido: ${chatId}`);
        return false;
    }

    // VALIDAR QUE EL NÚMERO EXISTE EN WHATSAPP
    const numeroExiste = await verificarNumeroExisteEnWhatsApp(chatId);
    if (!numeroExiste) {
        console.log(`❌ [ENVIAR DIRECTO] Número ${chatId} NO EXISTE en WhatsApp - mensaje rechazado`);
        registrarLog(`[VALIDACIÓN COLA] Mensaje rechazado: ${chatId} no existe en WhatsApp`);
        return false;
    }

    // Verificar que el chat existe
    try {
        const chat = await client.getChatById(chatId);
        if (!chat) {
            console.log(`❌ [ENVIAR DIRECTO] Chat ${chatId} no encontrado`);
            return false;
        }
    } catch (chatError) {
        console.log(`⚠️ [ENVIAR DIRECTO] Chat ${chatId} no accesible: ${chatError.message}`);
        if (chatError.message.includes('Lid is missing') ||
            chatError.message.includes('getChat') ||
            chatError.message.includes('chat table')) {
            console.log(`🚫 [ENVIAR DIRECTO] Chat inexistente: ${chatId}`);
            return false;
        }
    }

    // Simular comportamiento humano (más rápido para cola)
    try {
        const chat = await client.getChatById(chatId);
        const delayMinimo = 200 + Math.random() * 300; // 200-500ms
        await new Promise(r => setTimeout(r, delayMinimo));

        if (Math.random() < 0.5) {
            await chat.sendSeen();
        }
    } catch (e) {
        console.log(`⚠️ [ENVIAR DIRECTO] Error en simulación: ${e.message}`);
    }

    // Enviar el mensaje
    try {
        if (typeof contenido === 'string') {
            await client.sendMessage(chatId, contenido);

            const nombreChat = obtenerNombreChat(chatId);
            registrarMensajeChatbot('saliente', chatId, contenido, nombreChat);
            incrementarContadorMensajes();

            if (esAPIExterna) {
                agregarMensajeAPICache(chatId, contenido, 300000);
            }

            actualizarChatActivo(chatId, {
                body: contenido,
                fromMe: true
            });
        } else {
            await client.sendMessage(chatId, contenido);

            if (esAPIExterna && rutaImagen) {
                const mediaIdentifier = `[MEDIA:${path.basename(rutaImagen)}]`;
                agregarMensajeAPICache(chatId, mediaIdentifier, 300000);
            }

            let bodyContent = '[Media]';
            if (rutaImagen) {
                const webPath = rutaImagen.replace('./images/', '/images/')
                                         .replace('./imagenes/', '/imagenes/')
                                         .replace('./uploads/', '/uploads/');

                if (rutaImagen.includes('.jpg') || rutaImagen.includes('.jpeg') || rutaImagen.includes('.png') || rutaImagen.includes('.gif')) {
                    bodyContent = `<img src="${webPath}" alt="Imagen enviada" style="max-width: 200px; border-radius: 8px;">`;
                } else if (rutaImagen.includes('.ogg') || rutaImagen.includes('.webm') || rutaImagen.includes('.mp3') || rutaImagen.includes('.m4a') || rutaImagen.includes('.wav')) {
                    const fileName = rutaImagen.split('/').pop();
                    bodyContent = `<div class="audio-message-container"><div class="audio-message-header"><i class="fas fa-microphone" style="color: #0084ff;"></i><span>Audio enviado</span></div><audio controls preload="metadata" class="sent-audio-player"><source src="${webPath}" type="audio/${rutaImagen.includes('.ogg') ? 'ogg' : rutaImagen.includes('.webm') ? 'webm' : rutaImagen.includes('.mp3') ? 'mpeg' : rutaImagen.includes('.m4a') ? 'mp4' : 'wav'}"><p>Tu navegador no soporta la reproducción de audio. <a href="${webPath}" download="${fileName}">Descargar audio</a></p></audio></div>`;
                } else {
                    const fileName = rutaImagen.split('/').pop();
                    bodyContent = `<a href="${webPath}" download="${fileName}">📁 ${fileName}</a>`;
                }
            }

            actualizarChatActivo(chatId, {
                body: bodyContent,
                fromMe: true,
                isMedia: true
            });
        }

        console.log(`✅ [ENVIAR DIRECTO] Mensaje enviado exitosamente a ${chatId}`);
        registrarEnvioExitoso();
        return true;
    } catch (err) {
        console.error(`❌ [ENVIAR DIRECTO] Error: ${err.message}`);
        registrarErrorEnvio(err, chatId);
        return false;
    }
}

async function enviarMensaje(chatId, contenido, rutaImagen = null, esAPIExterna = false, desdeColaPrincipal = false) {
    console.log(`📤 [ENVIAR MENSAJE] Enviando a ${chatId}: "${typeof contenido === 'string' ? contenido.substring(0, 50) : '[Media]'}"`);
    console.log(`🔍 [ENVIAR MENSAJE] Stack trace:`, new Error().stack.split('\n')[2]?.trim());

    // ===== PROTECCIÓN 0: Verificar si el número está bloqueado =====
    const chatIdLimpio = chatId.replace('@c.us', '').replace('@lid', '');
    if (NUMEROS_BLOQUEADOS.includes(chatId) || NUMEROS_BLOQUEADOS.includes(chatIdLimpio)) {
        console.log(`🚫 [BLOQUEADO] Mensaje rechazado para número bloqueado: ${chatId}`);
        registrarLog(`[BLOQUEADO] Mensaje rechazado para número bloqueado: ${chatId}`);
        return false;
    }

    // ===== PROTECCIÓN 1: Verificaciones básicas mejoradas =====
    if (!whatsappListo) {
        console.log(`❌ [ENVIAR MENSAJE] WhatsApp no está listo para ${chatId} - ENCOLANDO`);
        registrarLog(`Mensaje a ${chatId} encolado porque WhatsApp no está listo.`);
        // Solo encolar si NO viene desde la cola principal (evitar recursión)
        if (!desdeColaPrincipal) {
            await encolarMensaje(chatId, contenido, rutaImagen, esAPIExterna);
        }
        return false;
    }

    if (!client) {
        console.log(`❌ [ENVIAR MENSAJE] Cliente WhatsApp no disponible - ENCOLANDO`);
        // Solo encolar si NO viene desde la cola principal (evitar recursión)
        if (!desdeColaPrincipal) {
            await encolarMensaje(chatId, contenido, rutaImagen, esAPIExterna);
        }
        return false;
    }

    if (!chatId || chatId.trim() === '') {
        console.log(`❌ [ENVIAR MENSAJE] ChatId inválido: ${chatId}`);
        return false;
    }

    // ===== PROTECCIÓN 2: Verificar horario disponible (con encolamiento) =====
    const horarioCheck = estaEnHorarioDisponible();
    if (!horarioCheck.disponible && horarioCheck.encolar) {
        console.log(`⏰ [HORARIO] Mensaje ENCOLADO - ${horarioCheck.razon}`);
        // Solo encolar si NO viene desde la cola principal (evitar recursión)
        if (!desdeColaPrincipal) {
            await encolarMensaje(chatId, contenido, rutaImagen, esAPIExterna);
        }
        return false;
    }

    // ===== PROTECCIÓN 3: Verificar límites diarios y por hora =====
    if (!verificarLimiteDiario()) {
        console.log(`⚠️ [LIMITE] Mensaje ENCOLADO - límite alcanzado`);
        // Solo encolar si NO viene desde la cola principal (evitar recursión)
        if (!desdeColaPrincipal) {
            await encolarMensaje(chatId, contenido, rutaImagen, esAPIExterna);
        }
        return false;
    }

    // ===== PROTECCIÓN 4: VALIDAR QUE EL NÚMERO EXISTE EN WHATSAPP =====
    const numeroExiste = await verificarNumeroExisteEnWhatsApp(chatId);
    if (!numeroExiste) {
        console.log(`❌ [ENVIAR MENSAJE] Número ${chatId} NO EXISTE en WhatsApp - mensaje rechazado`);
        registrarLog(`[VALIDACIÓN] Mensaje rechazado: ${chatId} no existe en WhatsApp`);
        return false;
    }

    // ===== PROTECCIÓN 5: Aplicar pausas humanas cada 8-12 mensajes =====
    await verificarPausasHumanas();

    // ===== PROTECCIÓN 6: Validar que el chat existe antes de enviar =====
    let chatObjeto = null;
    try {
        chatObjeto = await client.getChatById(chatId);
        if (!chatObjeto) {
            console.log(`❌ [ENVIAR MENSAJE] Chat ${chatId} no encontrado`);
            return false;
        }
    } catch (chatError) {
        // Si el chat no existe, intentar crearlo enviando un mensaje simple primero
        console.log(`⚠️ [ENVIAR MENSAJE] Chat ${chatId} no accesible: ${chatError.message}`);

        // Si es error de sesión cerrada, encolar para reintento
        if (chatError.message.includes('Session closed') || chatError.message.includes('Protocol error')) {
            console.log(`🔄 [REINTENTO] Error de sesión detectado en getChatById - Encolando mensaje para reintento`);
            if (!desdeColaPrincipal) {
                await encolarMensaje(chatId, contenido, rutaImagen, esAPIExterna);
            }
            return false;
        }

        if (chatError.message.includes('Lid is missing') ||
            chatError.message.includes('getChat') ||
            chatError.message.includes('chat table')) {
            console.log(`🚫 [ENVIAR MENSAJE] Chat inexistente detectado: ${chatId}`);
            registrarLog(`[API SKIP] Saltando mensaje a chat inexistente: ${chatId} - Error: ${chatError.message}`);
            return false; // No intentar enviar a chats que no existen realmente
        }
    }

    // ===== PROTECCIÓN 6: Simular comportamiento humano antes de enviar =====
    // Si es de API externa, usar simulación más lenta y realista
    if (esAPIExterna) {
        // Pasar el objeto chat para evitar llamada duplicada a getChatById
        await simularComportamientoHumanoAPI(chatId, contenido, chatObjeto);
    } else {
        // Si es del panel web (esAPIExterna = false), usar simulación ULTRA rápida
        console.log(`⚡ [PANEL WEB RÁPIDO] Enviando mensaje sin delays largos`);
        // Reutilizar chatObjeto que ya tenemos, evita llamada duplicada
        if (chatObjeto) {
            try {
                await chatObjeto.sendSeen();
                // Delay mínimo para evitar ser detectado como bot (50-100ms)
                await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
            } catch (e) {
                // Si es error de sesión, solo registrar pero continuar con el envío
                if (e.message.includes('Session closed') || e.message.includes('Protocol error')) {
                    console.log(`⚠️ [PANEL WEB] Error de sesión en sendSeen (ignorando): ${e.message}`);
                } else {
                    console.log(`⚠️ [PANEL WEB] Error en simulación mínima: ${e.message}`);
                }
            }
        }
    }

    try {
        if (typeof contenido === 'string') {
            await client.sendMessage(chatId, contenido);

            // Registrar mensaje saliente del chatbot para el dashboard
            const nombreChat = obtenerNombreChat(chatId);
            registrarMensajeChatbot('saliente', chatId, contenido, nombreChat);

            // Incrementar contador de mensajes
            incrementarContadorMensajes();

            // Si es de API externa, agregarlo al caché para filtrar cuando regrese
            if (esAPIExterna) {
                agregarMensajeAPICache(chatId, contenido, 300000); // 5 minutos para darle tiempo al frontend
                // NO actualizar chat activo para mensajes de API - no deben aparecer en el dashboard
            } else {
                // Solo actualizar chat activo si NO es de API externa
                actualizarChatActivo(chatId, {
                    body: contenido,
                    fromMe: true
                });
            }
        } else {
            // Es un MessageMedia
            await client.sendMessage(chatId, contenido);
            
            // Si es de API externa, agregarlo al caché con identificador especial
            if (esAPIExterna && rutaImagen) {
                const mediaIdentifier = `[MEDIA:${path.basename(rutaImagen)}]`;
                agregarMensajeAPICache(chatId, mediaIdentifier, 300000); // 5 minutos
            }

            // NO actualizar chat activo para mensajes de API externa
            if (!esAPIExterna) {
                // Actualizar chat activo con media enviado solo si NO es de API externa
                let bodyContent = '[Media]';

                // Si tenemos la ruta del archivo, generar HTML apropiado
                if (rutaImagen) {
                    // Convertir ruta relativa a URL web
                    const webPath = rutaImagen.replace('./images/', '/images/')
                                             .replace('./imagenes/', '/imagenes/')
                                             .replace('./uploads/', '/uploads/');

                    // Detectar tipo de archivo y generar HTML apropiado
                    if (rutaImagen.includes('.jpg') || rutaImagen.includes('.jpeg') || rutaImagen.includes('.png') || rutaImagen.includes('.gif')) {
                        // Es una imagen
                        bodyContent = `<img src="${webPath}" alt="Imagen enviada" style="max-width: 200px; border-radius: 8px;">`;
                    } else if (rutaImagen.includes('.ogg') || rutaImagen.includes('.webm') || rutaImagen.includes('.mp3') || rutaImagen.includes('.m4a') || rutaImagen.includes('.wav')) {
                        // Es un archivo de audio
                        const fileName = rutaImagen.split('/').pop();
                        bodyContent = `<div class="audio-message-container"><div class="audio-message-header"><i class="fas fa-microphone" style="color: #0084ff;"></i><span>Audio enviado</span></div><audio controls preload="metadata" class="sent-audio-player"><source src="${webPath}" type="audio/${rutaImagen.includes('.ogg') ? 'ogg' : rutaImagen.includes('.webm') ? 'webm' : rutaImagen.includes('.mp3') ? 'mpeg' : rutaImagen.includes('.m4a') ? 'mp4' : 'wav'}"><p>Tu navegador no soporta la reproducción de audio. <a href="${webPath}" download="${fileName}">Descargar audio</a></p></audio></div>`;
                    } else {
                        // Otros tipos de archivos
                        const fileName = rutaImagen.split('/').pop();
                        bodyContent = `<a href="${webPath}" download="${fileName}">📁 ${fileName}</a>`;
                    }
                }

                actualizarChatActivo(chatId, {
                    body: bodyContent,
                    fromMe: true,
                    isMedia: true
                });
            }
        }
        console.log(`✅ [ENVIAR MENSAJE] Mensaje enviado exitosamente a ${chatId}`);
        registrarEnvioExitoso(); // Registrar envío exitoso para monitoreo
        return true;
    } catch (err) {
        console.error(`❌ [ENVIAR MENSAJE] Error enviando mensaje a ${chatId}: ${err.message}`);
        registrarLog(`Error enviando mensaje a ${chatId}: ${err.message}`);
        registrarErrorEnvio(err, chatId); // Registrar error para monitoreo

        // Si es un error específico de WhatsApp Web, manejarlo adecuadamente
        if (err.message.includes('Evaluation failed') || err.message.includes('Protocol error')) {
            // Verificar si es el error de "Lid is missing" que indica chat inexistente
            if (err.message.includes('Lid is missing') || err.message.includes('chat table')) {
                console.log(`🚫 [CHAT INEXISTENTE] No se puede enviar a ${chatId} - Chat no existe en WhatsApp Web`);
                registrarLog(`[API ERROR] Chat inexistente: ${chatId} - ${err.message}`);
                return false; // Salir sin reiniciar el bot
            }

            // Si es error de "Session closed", encolar para reintento
            if (err.message.includes('Session closed')) {
                console.log(`🔄 [REINTENTO] Error de sesión cerrada en sendMessage - Encolando mensaje para reintento`);
                registrarLog(`[REINTENTO] Mensaje encolado por Session closed: ${chatId}`);
                if (!desdeColaPrincipal) {
                    await encolarMensaje(chatId, contenido, rutaImagen, esAPIExterna);
                }
                return false;
            }

            logOptimized(`🔄 [REINICIO] Error de WhatsApp Web detectado. Intentando solución alternativa...`, 'warn');
            registrarLog(`Error de WhatsApp Web detectado: ${err.message}`);

            // En lugar de reiniciar todo WhatsApp, intentar una solución más específica
            // para archivos multimedia: marcar como error pero no reiniciar toda la sesión

                            if (rutaImagen && (rutaImagen.includes('audio') || rutaImagen.includes('m4a') || rutaImagen.includes('wav') || rutaImagen.includes('grabado'))) {
                    console.log(`🎵 [AUDIO] Error específico con archivo de audio: ${err.message}`);
                    console.log(`🎵 [AUDIO] WhatsApp Web tiene restricciones temporales para archivos multimedia`);

                    // Marcar globalmente que hay un error de WhatsApp Web con audio
                    if (!global.lastAudioError) {
                        global.lastAudioError = {};
                    }
                    global.lastAudioError.isWhatsAppError = true;
                    global.lastAudioError.errorMessage = err.message;
                    global.lastAudioError.timestamp = new Date().toISOString();

                    // Para archivos de audio, intentar enviar como mensaje de texto alternativo
                    console.log(`🎵 [AUDIO] Intentando enviar mensaje alternativo sobre el audio...`);

                    try {
                        // Intentar extraer chatId de diferentes formas
                        let chatId = null;

                        // Intentar del stack trace si está disponible
                        if (err.stack) {
                            const chatMatch = err.stack.match(/573\d+@c\.us/);
                            if (chatMatch) {
                                chatId = chatMatch[0];
                            }
                        }

                        // Si no se pudo extraer, al menos registrar el error sin chat específico
                        if (!chatId) {
                            console.log(`🎵 [AUDIO] No se pudo determinar el chatId para mensaje alternativo`);
                            console.log(`🎵 [AUDIO] Error registrado en logs para análisis`);
                            registrarLog(`Error de audio sin chat específico - WhatsApp Web restricciones: ${err.message}`);
                            return false;
                        }

                        const mensajeAlternativo = `🎵 No se pudo enviar el audio grabado. Esto puede deberse a restricciones temporales de WhatsApp Web.\n\n💡 Sugerencias:\n• Espera 5-10 minutos e intenta nuevamente\n• Graba un audio más corto (menos de 30 segundos)\n• Verifica tu conexión a internet\n\nSi el problema persiste, intenta enviar un mensaje de texto en su lugar.`;

                        // Intentar enviar el mensaje alternativo
                        const success = await enviarMensaje(chatId, mensajeAlternativo);
                        if (success) {
                            console.log(`✅ [AUDIO] Mensaje alternativo enviado exitosamente a ${chatId}`);
                            registrarLog(`Mensaje alternativo sobre audio fallido enviado a ${chatId}`);
                        } else {
                            console.log(`❌ [AUDIO] No se pudo enviar mensaje alternativo a ${chatId}`);
                        }
                    } catch (altError) {
                        console.log(`❌ [AUDIO] Error enviando mensaje alternativo: ${altError.message}`);
                        registrarLog(`Error enviando mensaje alternativo sobre audio fallido: ${altError.message}`);
                    }

                    registrarLog(`Error con archivo de audio - WhatsApp Web restricciones: ${err.message}`);

                    // No marcar como no listo para no afectar otros mensajes
                    return false;
                }

            // Para errores de notificaciones, NO reiniciar - solo registrar error
            console.log(`⚠️ [NOTIFICACIÓN] Error enviando mensaje. NO reiniciando sesión...`);
            registrarLog(`Error en notificación (no crítico): ${err.message}`);

            // NO marcar como no listo ni reiniciar por errores de notificaciones
            // whatsappListo = false; // COMENTADO para evitar reinicios innecesarios
            // whatsappEstabilizado = false; // COMENTADO

            console.log(`📊 [NOTIFICACIÓN] Error manejado sin afectar la sesión principal`);
            return false; // Simplemente retornar false sin reiniciar
        }

        return false;
    }
}

async function mostrarMenuPrincipal(chatId) {
    const estado = obtenerEstadoUsuario(chatId);
    const ahora = Date.now();
    const TIEMPO_MIN_ENTRE_MENUS = 10000; // 10 segundos mínimo entre menús consecutivos
    
    // Verificar si ya se envió recientemente el menú
    if (estado.ultimoMenuEnviado && (ahora - estado.ultimoMenuEnviado) < TIEMPO_MIN_ENTRE_MENUS) {
        registrarLog(`Evitando envío duplicado de menú para ${chatId}`);
        return;
    }
    
    // Solo enviar mensaje de bienvenida en la primera interacción
    if (estado.primeraInteraccion) {
        const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
        await enviarMensaje(chatId, mensaje);
    }
    
    await enviarMensaje(chatId, `📋 *MENÚ PRINCIPAL*\n\n✨ *Recuerda completar el proceso para que tu solicitud sea atendida*\n\n*Elige el número que corresponda a tu solicitud:*\n\n1️⃣ Usuarios registrados\n  *reportes de daño, pagos e intermitencias*)\n\n2️⃣ Adquirir un nuevo servicio\n   (*nuevos usuarios*)\n\n3️⃣ Reactivación de servicio\n    (*servicio suspendido o retirado*)\n\n4️⃣ Problema con identificación\n    (*cliente activo no reconocido*)\n\n#️⃣ Volver al menú principal`);
    
    actualizarEstadoUsuario(chatId, { 
        ultimaInteraccion: ahora, 
        erroresConsecutivos: 0,
        ultimoMenuEnviado: ahora,
        primeraInteraccion: false // Marcar que ya no es la primera interacción
    });
}

// ===== LIMPIEZA PERIÓDICA OPTIMIZADA PARA MÁS USUARIOS =====
setInterval(() => {
    const ahora = Date.now();
    const TIEMPO_LIMPIEZA = 1 * 60 * 60 * 1000; // 1 hora (más agresivo)
    let eliminados = 0;
    
    // Usar for-of para mejor rendimiento que forEach en Map
    // Crear array de chatIds a limpiar para evitar modificar Map durante iteración
    const chatsParaLimpiar = [];
    for (const [chatId, estado] of estadosUsuario.entries()) {
        if (ahora - estado.ultimaInteraccion > TIEMPO_LIMPIEZA) {
            chatsParaLimpiar.push(chatId);
        }
    }
    
    // Limpiar chats identificados usando función completa
    for (const chatId of chatsParaLimpiar) {
        limpiarChatCompleto(chatId);
        eliminados++;
    }
    
    if (eliminados > 0) {
        registrarLog(`Limpieza: ${eliminados} estados de usuario eliminados por inactividad`);
        // Forzar garbage collection si está disponible
        if (global.gc) {
            global.gc();
        }
    }
}, 30 * 60 * 1000); // Ejecutar cada 30 minutos

// ===== API Endpoints =====

// ===== ENDPOINTS DE AUTENTICACIÓN =====

// Endpoint para login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Usuario y contraseña son requeridos'
            });
        }

        const usuario = await buscarUsuario(username, password);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        const token = await crearToken(usuario.id, usuario);

        if (!token) {
            return res.status(500).json({
                success: false,
                message: 'Error creando token'
            });
        }

        res.json({
            success: true,
            message: 'Login exitoso',
            user: {
                id: usuario.id,
                username: usuario.username,
                nombre: usuario.nombre,
                rol: usuario.rol
            },
            token: token
        });
    } catch (error) {
        console.error('Error en login:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint específico para login de técnicos
app.post('/api/login-tecnicos', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Usuario y contraseña son requeridos'
            });
        }

        const usuario = await buscarUsuario(username, password);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Credenciales inválidas'
            });
        }

        // Verificar que el usuario sea un técnico
        if (usuario.rol !== 'tecnico') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo usuarios con rol de técnico pueden acceder.'
            });
        }

        // Verificar que el usuario esté activo
        if (!usuario.activo) {
            return res.status(403).json({
                success: false,
                message: 'Usuario inactivo. Contacta al administrador.'
            });
        }

        const token = await crearToken(usuario.id, usuario);

        if (!token) {
            return res.status(500).json({
                success: false,
                message: 'Error creando token'
            });
        }

        res.json({
            success: true,
            message: 'Login exitoso',
            user: {
                id: usuario.id,
                username: usuario.username,
                nombre: usuario.nombre,
                rol: usuario.rol
            },
            token: token
        });
    } catch (error) {
        console.error('Error en login de técnicos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para verificar sesión
app.get('/api/session', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') ||
                     req.query.token ||
                     req.cookies?.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token no proporcionado'
            });
        }

        const usuario = await verificarToken(token);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        res.json({
            success: true,
            user: {
                id: usuario.usuario_id,
                username: usuario.username,
                nombre: usuario.nombre,
                rol: usuario.rol
            }
        });
    } catch (error) {
        console.error('Error verificando sesión:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para extender sesión
app.get('/api/session/extend', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') ||
                     req.query.token ||
                     req.cookies?.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token no proporcionado'
            });
        }

        const usuario = await verificarToken(token);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        // Crear un nuevo token con tiempo extendido (equivale a renovar la sesión)
        const nuevoToken = await crearToken(usuario.usuario_id, usuario);
        
        // Opcionalmente invalidar el token anterior
        await cerrarSesion(token);

        res.json({
            success: true,
            message: 'Sesión extendida exitosamente',
            token: nuevoToken,
            user: {
                id: usuario.usuario_id,
                username: usuario.username,
                nombre: usuario.nombre,
                rol: usuario.rol
            }
        });
    } catch (error) {
        console.error('Error extendiendo sesión:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor al extender sesión'
        });
    }
});

// Endpoint de salud para monitoreo
app.get('/api/health', (req, res) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    try {
        res.status(200).json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            whatsapp: {
                connected: whatsappListo || false,
                ready: whatsappListo || false,
                hasClient: !!client,
                disconnectedSince: whatsappDisconnectedSince || null
            },
            memory: {
                used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memoryUsage.rss / 1024 / 1024)
            },
            cpu: {
                user: Math.round(cpuUsage.user / 1000),
                system: Math.round(cpuUsage.system / 1000)
            },
            process: {
                pid: process.pid,
                version: process.version,
                platform: process.platform
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para logout
app.post('/api/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') ||
                     req.body.token ||
                     req.cookies?.token;

        if (token) {
            await cerrarSesion(token);
        }

        res.json({
            success: true,
            message: 'Token invalidado correctamente'
        });
    } catch (error) {
        console.error('Error en logout:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== MIDDLEWARES DE AUTENTICACIÓN =====

// Middleware para verificar autenticación
const requireAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') ||
                     req.query.token ||
                     req.cookies?.token ||
                     req.headers.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token requerido'
            });
        }

        // Primero intentar verificar como token eterno
        let usuario = await verificarTokenEterno(token);

        // Si no es token eterno, intentar verificar como token normal
        if (!usuario) {
            usuario = await verificarToken(token);
        }

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        req.user = usuario;
        next();
    } catch (error) {
        console.error('Error en autenticación:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};

// Middleware para verificar autenticación en rutas web (redirecciona al login)
const requireWebAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') ||
                     req.query.token ||
                     req.cookies?.token ||
                     req.headers.token;

        if (!token) {
            // Redireccionar al login en lugar de devolver JSON
            return res.redirect('/?error=auth_required');
        }

        // Primero intentar verificar como token eterno
        let usuario = await verificarTokenEterno(token);

        // Si no es token eterno, intentar verificar como token normal
        if (!usuario) {
            usuario = await verificarToken(token);
        }

        if (!usuario) {
            // Redireccionar al login en lugar de devolver JSON
            return res.redirect('/?error=token_invalid');
        }

        req.user = usuario;
        next();
    } catch (error) {
        console.error('Error en autenticación web:', error.message);
        // Redireccionar al login en caso de error
        res.redirect('/?error=server_error');
    }
};

// Middleware para verificar rol de administrador
const requireAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') ||
                     req.query.token ||
                     req.cookies?.token ||
                     req.headers.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token requerido'
            });
        }

        const usuario = await verificarToken(token);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        if (usuario.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado: Se requiere rol de administrador'
            });
        }

        req.user = usuario;
        next();
    } catch (error) {
        console.error('Error en verificación de admin:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
};

// ========== ENDPOINTS DE GESTIÓN DE USUARIOS ==========

// Verificar si el usuario es admin
app.get('/api/verificar-admin', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuario = await verificarToken(token);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido'
            });
        }

        res.json({
            success: true,
            rol: usuario.rol,
            esAdmin: usuario.rol === 'admin'
        });
    } catch (error) {
        console.error('Error verificando admin:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Obtener usuario actual
app.get('/api/usuario-actual', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuario = await verificarToken(token);

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido'
            });
        }

        res.json({
            success: true,
            usuario: {
                id: usuario.usuario_id,
                username: usuario.username,
                nombre: usuario.nombre,
                rol: usuario.rol,
                puede_agregar_naps: usuario.puede_agregar_naps
            }
        });
    } catch (error) {
        console.error('Error obteniendo usuario actual:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== RUTAS DEL HISTORIAL DE CHAT =====

// Obtener lista de contactos con mensajes
app.get('/api/chat/contactos', requireAuth, (req, res) => {
    chatHistoryRoutes.getContactsList(req, res);
});

// Obtener mensajes de un contacto específico
app.get('/api/chat/mensajes/:numero', requireAuth, (req, res) => {
    chatHistoryRoutes.getContactMessages(req, res);
});

// Sincronizar historial de chats desde WhatsApp
app.post('/api/chat/sync', requireAuth, (req, res) => {
    chatHistoryRoutes.syncChatHistory(req, res, client);
});

// Obtener estado de sincronización
app.get('/api/chat/sync-status', requireAuth, (req, res) => {
    chatHistoryRoutes.getSyncStatus(req, res);
});

// Buscar mensajes
app.get('/api/chat/search', requireAuth, (req, res) => {
    chatHistoryRoutes.searchMessages(req, res);
});

// Descargar archivo multimedia de un mensaje
app.get('/api/chat/media/:messageId', requireAuth, (req, res) => {
    chatHistoryRoutes.downloadMedia(req, res, client);
});

// Limpiar estado de sincronización (forzar re-sincronización)
app.post('/api/chat/clear-sync', requireAuth, (req, res) => {
    chatHistoryRoutes.clearSyncStatus(req, res);
});

// Listar todos los chats disponibles en WhatsApp
app.get('/api/chat/available-chats', requireAuth, (req, res) => {
    chatHistoryRoutes.listAvailableChats(req, res, client);
});

// Cambiar modo de chat (bot/humano)
console.log('📝 [INIT] Registrando ruta POST /api/chat/cambiar-modo');
app.post('/api/chat/cambiar-modo', requireAuth, async (req, res) => {
    console.log('🔄 [API] Solicitud recibida para cambiar modo');
    await chatHistoryRoutes.cambiarModoChat(req, res);

    // Actualizar estado en memoria del bot
    const { numero, modo } = req.body;
    if (numero && modo) {
        const chatId = `${numero}@c.us`;

        if (modo === 'humano') {
            // Activar modo humano en memoria
            actualizarEstadoUsuario(chatId, {
                enEsperaHumano: {
                    contador: 0,
                    ultimaRespuesta: Date.now()
                }
            });
            // Actualizar mapa de modos
            modosChat.set(chatId, 'human');

            // IMPORTANTE: Quitar de chats finalizados si estaba ahí
            if (chatsFinalizados.has(chatId)) {
                chatsFinalizados.delete(chatId);
                console.log(`♻️ Chat ${numero} removido de finalizados (ahora en modo humano)`);
            }

            // Asegurarse de que el chat esté activo
            actualizarChatActivo(chatId);

        } else {
            // Desactivar modo humano en memoria
            actualizarEstadoUsuario(chatId, {
                enEsperaHumano: null
            });
            // Actualizar mapa de modos
            modosChat.set(chatId, 'bot');
        }

        console.log(`🔄 Modo actualizado en memoria: ${numero} → ${modo}`);

        // IMPORTANTE: Emitir actualización a todos los clientes conectados
        setTimeout(() => {
            emitirActualizacionChats();
        }, 500);
    }
});

// Listar todos los usuarios (solo admin)
app.get('/api/usuarios', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        const [usuarios] = await conexion.execute(
            'SELECT id, username, nombre, rol, activo, fecha_creacion, ultimo_acceso FROM usuarios_sistema ORDER BY id ASC'
        );

        await conexion.end();

        res.json({
            success: true,
            usuarios
        });
    } catch (error) {
        console.error('Error obteniendo usuarios:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Crear nuevo usuario (solo admin)
app.post('/api/usuarios', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const { username, password, nombre, rol, activo } = req.body;

        if (!username || !password || !nombre || !rol) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        const [resultado] = await conexion.execute(
            'INSERT INTO usuarios_sistema (username, password, nombre, rol, activo) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, nombre, rol, activo ? 1 : 0]
        );

        await conexion.end();

        res.json({
            success: true,
            message: 'Usuario creado exitosamente',
            usuarioId: resultado.insertId
        });
    } catch (error) {
        console.error('Error creando usuario:', error.message);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({
                success: false,
                message: 'El nombre de usuario ya existe'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Error interno del servidor'
            });
        }
    }
});

// Actualizar usuario (solo admin)
app.put('/api/usuarios/:id', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const { id } = req.params;
        const { username, nombre, rol, activo, password } = req.body;

        if (!username || !nombre || !rol) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        if (password) {
            const bcrypt = require('bcrypt');
            const hashedPassword = await bcrypt.hash(password, 10);
            await conexion.execute(
                'UPDATE usuarios_sistema SET username = ?, password = ?, nombre = ?, rol = ?, activo = ? WHERE id = ?',
                [username, hashedPassword, nombre, rol, activo ? 1 : 0, id]
            );
        } else {
            await conexion.execute(
                'UPDATE usuarios_sistema SET username = ?, nombre = ?, rol = ?, activo = ? WHERE id = ?',
                [username, nombre, rol, activo ? 1 : 0, id]
            );
        }

        await conexion.end();

        res.json({
            success: true,
            message: 'Usuario actualizado exitosamente'
        });
    } catch (error) {
        console.error('Error actualizando usuario:', error.message);
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({
                success: false,
                message: 'El nombre de usuario ya existe'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Error interno del servidor'
            });
        }
    }
});

// Cambiar contraseña de usuario (solo admin)
app.put('/api/usuarios/:id/password', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const { id } = req.params;
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({
                success: false,
                message: 'La contraseña es requerida'
            });
        }

        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'UPDATE usuarios_sistema SET password = ? WHERE id = ?',
            [hashedPassword, id]
        );

        await conexion.end();

        res.json({
            success: true,
            message: 'Contraseña actualizada exitosamente'
        });
    } catch (error) {
        console.error('Error cambiando contraseña:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Eliminar usuario (solo admin)
app.delete('/api/usuarios/:id', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const { id } = req.params;

        // No permitir eliminar el propio usuario
        if (parseInt(id) === usuarioActual.id) {
            return res.status(400).json({
                success: false,
                message: 'No puedes eliminar tu propio usuario'
            });
        }

        console.log(`🗑️ [API] Solicitud de eliminación de usuario ID: ${id}`);

        // Usar la función eliminarUsuario que maneja todas las dependencias
        const result = await eliminarUsuario(id);
        res.json(result);
    } catch (error) {
        console.error('❌ [API] Error eliminando usuario:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor: ' + error.message
        });
    }
});

// Obtener lista de técnicos con permisos NAP (solo admin)
app.get('/api/tecnicos-permisos-nap', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        const [tecnicos] = await conexion.execute(`
            SELECT id, username, nombre, puede_agregar_naps
            FROM usuarios_sistema
            WHERE rol = 'tecnico' AND activo = 1
            ORDER BY nombre ASC
        `);

        await conexion.end();

        res.json({
            success: true,
            tecnicos
        });
    } catch (error) {
        console.error('Error obteniendo técnicos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Actualizar permiso NAP de un técnico (solo admin)
app.put('/api/tecnicos/:id/permiso-nap', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        if (!usuarioActual || usuarioActual.rol !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo administradores.'
            });
        }

        const { id } = req.params;
        const { puede_agregar_naps } = req.body;

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        // Verificar que el usuario sea técnico
        const [usuario] = await conexion.execute(
            'SELECT rol FROM usuarios_sistema WHERE id = ?',
            [id]
        );

        if (usuario.length === 0 || usuario[0].rol !== 'tecnico') {
            await conexion.end();
            return res.status(400).json({
                success: false,
                message: 'El usuario no es un técnico'
            });
        }

        // Actualizar permiso
        await conexion.execute(
            'UPDATE usuarios_sistema SET puede_agregar_naps = ? WHERE id = ?',
            [puede_agregar_naps ? 1 : 0, id]
        );

        await conexion.end();

        console.log(`✅ Permiso NAP ${puede_agregar_naps ? 'activado' : 'desactivado'} para técnico ${id}`);

        res.json({
            success: true,
            message: 'Permiso actualizado exitosamente'
        });
    } catch (error) {
        console.error('Error actualizando permiso NAP:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ========== FIN ENDPOINTS DE GESTIÓN DE USUARIOS ==========

// Endpoint para validar conexión de base de datos
app.get('/api/validate-db-connection', requireAuth, async (req, res) => {
    try {
        // Validar conexión al sistema de autenticación
        const authResult = await validarConexionBD({
            host: process.env.DB_SYSTEM_HOST || 'localhost',
            user: process.env.DB_SYSTEM_USER || 'root',
            password: process.env.DB_SYSTEM_PASSWORD || '',
            database: 'solucnet_auth_system'
        });

        // Validar conexiones a las bases de datos principales
        const basesDatos = [
            { host: '19.168.99.50', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', name: 'BD 1' },
            { host: '19.168.99.11', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', name: 'BD 2' },
            { host: '19.168.99.2', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', name: 'BD 3' },
            { host: '19.168.99.51', user: 'ADFZ2I', password: 'MOZ1BWZ86BRMXFW', database: 'Mikrowisp6', name: 'BD 4' }
        ];

        const resultadosBD = [];
        
        for (const bd of basesDatos) {
            const resultado = await validarConexionBD({
                host: bd.host,
                user: bd.user,
                password: bd.password,
                database: bd.database
            });
            
            resultadosBD.push({
                name: bd.name,
                host: bd.host,
                database: bd.database,
                status: resultado.success ? 'conectado' : 'error',
                message: resultado.message
            });
        }

        res.json({
            success: true,
            connections: {
                auth_system: {
                    name: 'Sistema de Autenticación',
                    status: authResult.success ? 'conectado' : 'error',
                    message: authResult.message
                },
                databases: resultadosBD
            }
        });
    } catch (error) {
        console.error('Error validando conexiones:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== ENDPOINTS PARA NÚMEROS OMITIDOS =====

// Endpoint para obtener números omitidos
app.get('/api/omitted-numbers', requireAuth, async (req, res) => {
    try {
        const { status } = req.query; // 'active', 'inactive', 'all'
        let result;

        if (status === 'inactive') {
            result = await obtenerNumerosOmitidosInactivos();
        } else if (status === 'active') {
            // Mostrar solo activos cuando se especifique explícitamente
            result = await obtenerNumerosOmitidosActivos();
        } else {
            // Por defecto mostrar todos los números (activos e inactivos)
            result = await obtenerTodosLosNumerosOmitidos();
        }

        res.json(result);
    } catch (error) {
        console.error('Error obteniendo números omitidos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para obtener números omitidos inactivos
app.get('/api/omitted-numbers/inactive', requireAuth, async (req, res) => {
    try {
        const result = await obtenerNumerosOmitidosInactivos();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo números omitidos inactivos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para agregar número omitido
app.post('/api/omitted-numbers', requireAuth, async (req, res) => {
    try {
        const { numero, motivo } = req.body;
        const usuarioId = req.user.usuario_id;

        if (!numero) {
            return res.status(400).json({
                success: false,
                message: 'El número es requerido'
            });
        }

        const result = await agregarNumeroOmitido(numero, motivo, usuarioId);
        res.json(result);
    } catch (error) {
        console.error('Error agregando número omitido:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para eliminar número omitido
app.delete('/api/omitted-numbers/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const result = await eliminarNumeroOmitido(id);
        res.json(result);
    } catch (error) {
        console.error('Error eliminando número omitido:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== ENDPOINTS PARA GESTIÓN DE USUARIOS =====

// Endpoint de prueba para verificar que funciona
app.get('/api/users-test', (req, res) => {
    console.log('Endpoint de prueba /api/users-test llamado');
    res.json({
        success: true,
        message: 'Endpoint de usuarios funcionando',
        timestamp: new Date().toISOString()
    });
});

// Endpoint para obtener usuarios (solo admin)
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        console.log('Endpoint /api/users llamado por usuario:', req.user); // Debug
        const result = await obtenerUsuarios();
        console.log('Resultado obtenerUsuarios:', result); // Debug
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo usuarios:', error.message);
        console.error('Stack:', error.stack); // Debug
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para crear usuario (solo admin)
app.post('/api/users', requireAdmin, async (req, res) => {
    try {
        const { username, password, nombre, rol } = req.body;
        const usuarioId = req.user.usuario_id;

        if (!username || !password || !nombre || !rol) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos son requeridos'
            });
        }

        // Validar rol
        if (!['admin', 'soporte'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Rol inválido'
            });
        }

        const result = await crearUsuario(username, password, nombre, rol);
        res.json(result);
    } catch (error) {
        console.error('Error creando usuario:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para eliminar usuario (solo admin)
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        
        // No permitir que se elimine a sí mismo
        if (parseInt(id) === req.user.usuario_id) {
            return res.status(400).json({
                success: false,
                message: 'No puedes eliminar tu propio usuario'
            });
        }

        const result = await eliminarUsuario(id);
        res.json(result);
    } catch (error) {
        console.error('Error eliminando usuario:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para actualizar usuario (solo admin)
app.put('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { username, password, nombre, rol, sessionId } = req.body;

        // Validar datos requeridos
        if (!username || !nombre || !rol) {
            return res.status(400).json({
                success: false,
                message: 'Los campos username, nombre y rol son obligatorios'
            });
        }

        // Validar rol
        if (!['admin', 'soporte'].includes(rol)) {
            return res.status(400).json({
                success: false,
                message: 'Rol inválido'
            });
        }

        // No permitir que un usuario se quite el rol de admin a sí mismo
        if (parseInt(id) === req.user.usuario_id && rol !== 'admin') {
            return res.status(400).json({
                success: false,
                message: 'No puedes quitarte el rol de administrador a ti mismo'
            });
        }

        // Preparar datos para actualizar
        const datosActualizar = {
            username,
            nombre,
            rol
        };

        // Solo incluir contraseña si se proporcionó
        if (password && password.trim()) {
            datosActualizar.password = password.trim();
        }

        const result = await actualizarUsuario(id, datosActualizar);
        res.json(result);
    } catch (error) {
        console.error('Error actualizando usuario:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== ENDPOINTS PARA LOGS DE API =====

// Endpoint para obtener logs de API
app.get('/api/logs-api', requireAuth, async (req, res) => {
    try {
        const limite = parseInt(req.query.limit) || 100;
        const result = await obtenerLogsAPI(limite);
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo logs API:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint para limpiar logs antiguos (solo admin)
app.post('/api/logs-api/cleanup', requireAdmin, async (req, res) => {
    try {
        const dias = parseInt(req.body.dias) || 30;
        const result = await limpiarLogsAPI(dias);
        res.json(result);
    } catch (error) {
        console.error('Error limpiando logs API:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== ENDPOINTS PARA SISTEMA DE VISITAS TÉCNICAS =====

// Importar funciones del módulo de visitas técnicas
const {
    inicializarSistemaVisitas,
    buscarClientesPorCedulaONombre,
    crearVisitaTecnica,
    crearClienteYVisita,
    obtenerVisitasPendientes,
    obtenerVisitasNoAsignadas,
    obtenerVisitasAsignadas,
    obtenerVisitasEnProgreso,
    obtenerEstadisticasVisitas,
    desasignarTecnicoDeVisita,
    editarVisitaSinAgendar,
    asignarTecnicoAVisita,
    obtenerVisitasTecnico,
    crearReporteVisita,
    obtenerTecnicos,
    obtenerReportesCompletados,
    obtenerFotosReporte,
    guardarFotosReporte,
    eliminarVisitaTecnica,
    obtenerArchivosPdfVisita,
    obtenerOrdenesParaAdmin,
    obtenerDetalleOrden,
    guardarUbicacionTecnico,
    obtenerUltimasUbicacionesTecnicos,
    obtenerHistorialUbicacionesTecnico,
    obtenerSerialEquipoCliente
} = require('./db_visitas_tecnicas.js');

// Importar funciones del módulo de clientes externos
const {
    obtenerConfigBDExterna,
    actualizarConfigBDExterna,
    sincronizarClientesExternos,
    obtenerClientesExternos,
    obtenerEstadisticasClientesExternos,
    probarConexionBDExterna
} = require('./db_clientes_externos.js');

// Importar funciones del módulo de instalaciones
const {
    registrarInstalacion
} = require('./db_instalaciones.js');

// Ruta principal para la página de administración de visitas
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_visitas.html'));
});

// API para buscar clientes por cédula o nombre (con seriales de equipos)
app.post('/api/buscar-clientes', async (req, res) => {
    try {
        const { termino } = req.body;
        if (!termino || termino.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'El término de búsqueda debe tener al menos 2 caracteres'
            });
        }

        console.log(`🔍 [API] Buscando cliente con seriales: "${termino}"`);
        const result = await buscarClientesConSerial(termino);
        res.json(result);
    } catch (error) {
        console.error('Error buscando clientes:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// =======================================================
// ENDPOINTS PARA ÓRDENES DE TÉCNICOS (ADMIN)
// =======================================================

// Endpoint para obtener órdenes de técnicos con estado actual
app.get('/api/admin/visitas/ordenes-tecnicos', async (req, res) => {
    // Configurar timeout para respuesta rápida
    const timeoutId = setTimeout(() => {
        if (!res.headersSent) {
            console.log('⏰ [ADMIN] Timeout: enviando respuesta rápida');
            res.json({
                success: true,
                ordenes: [],
                timestamp: new Date().toISOString(),
                source: 'timeout_fallback',
                message: 'Servidor ocupado - reintentando...'
            });
        }
    }, 2000); // 2 segundos timeout

    try {
        console.log('📊 [ADMIN] Obteniendo órdenes de técnicos...');

        // Intentar obtener datos reales de la base de datos PRIMERO
        try {
            const resultado = await obtenerOrdenesParaAdmin();
            if (resultado.success) {
                console.log(`✅ [ADMIN] ${resultado.ordenes.length} órdenes obtenidas de BD (técnico 1, día actual)`);

                // Verificar estados en visitasEnMemoria para actualizar BD
                const ordenesActualizadas = resultado.ordenes.map(orden => {
                    const visitaMemoria = visitasEnMemoria[orden.id];
                    if (visitaMemoria && visitaMemoria.estado) {
                        return {
                            ...orden,
                            estado: visitaMemoria.estado,
                            fecha_inicio_real: visitaMemoria.fechaInicio || orden.fecha_inicio_real
                        };
                    }
                    return orden;
                });

                clearTimeout(timeoutId);
                if (!res.headersSent) {
                    return res.json({
                        success: true,
                        ordenes: ordenesActualizadas,
                        timestamp: new Date().toISOString(),
                        source: 'database_real',
                        message: `${ordenesActualizadas.length} órdenes del técnico 1 - ${new Date().toLocaleDateString()}`
                    });
                }
            }
        } catch (dbError) {
            console.warn('⚠️ [ADMIN] Error BD, usando fallback:', dbError.message);
        }

        // Fallback: solo usar visitasEnMemoria si BD falla
        const ordenesReales = [];
        const visitasEnProgresoCount = Object.keys(visitasEnMemoria).filter(id => visitasEnMemoria[id].estado === 'en_progreso').length;

        // Procesar solo visitas en memoria (más rápido)
        Object.keys(visitasEnMemoria).forEach(visitaId => {
            const visitaMemoria = visitasEnMemoria[visitaId];

            if (visitaMemoria && visitaMemoria.estado) {
                const orden = {
                    id: parseInt(visitaId),
                    fecha_creacion: visitaMemoria.fechaInicio || new Date().toISOString(),
                    fecha_programada: visitaMemoria.fechaInicio || new Date().toISOString(),
                    estado: visitaMemoria.estado,
                    descripcion: 'Visita técnica en curso',
                    cliente_nombre: visitaMemoria.cliente_nombre || `Cliente #${visitaId}`,
                    cliente_direccion: visitaMemoria.cliente_direccion || 'Dirección en campo',
                    tecnico_nombre: visitaMemoria.tecnico_nombre || 'Técnico asignado',
                    tecnico_telefono: 'N/A',
                    tecnico_estado: visitaMemoria.estado === 'en_progreso' ? 'ocupado' : 'disponible',
                    tecnico_ubicacion: visitaMemoria.estado === 'en_progreso' ? 'Trabajando en campo' : 'Disponible',
                    prioridad: 'normal',
                    fecha_completado: visitaMemoria.fechaCompletada || null,
                    fecha_inicio_real: visitaMemoria.fechaInicio || null
                };

                ordenesReales.push(orden);
            }
        });

        // Si no hay datos reales, mostrar mensaje informativo
        if (ordenesReales.length === 0) {
            console.log('📋 [ADMIN] No hay órdenes del técnico 1 para hoy');
        }

        // Ordenar por prioridad de estado
        ordenesReales.sort((a, b) => {
            const estadoPrioridad = {
                'en_progreso': 1,
                'asignada': 2,
                'programada': 3,
                'completada': 4,
                'cancelada': 5
            };
            return (estadoPrioridad[a.estado] || 999) - (estadoPrioridad[b.estado] || 999);
        });

        console.log(`📊 [ADMIN] ${ordenesReales.length} órdenes (${visitasEnProgresoCount} en progreso)`);

        // Cancelar timeout si llegamos aquí
        clearTimeout(timeoutId);

        if (!res.headersSent) {
            res.json({
                success: true,
                ordenes: ordenesReales,
                timestamp: new Date().toISOString(),
                source: 'memory_fallback',
                message: ordenesReales.length === 0
                    ? 'No hay órdenes del técnico 1 para hoy'
                    : `${ordenesReales.length} órdenes - ${visitasEnProgresoCount} en progreso actualmente`
            });
        }

    } catch (error) {
        console.error('❌ [ADMIN ERROR] Error obteniendo órdenes:', error);
        clearTimeout(timeoutId);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Error obteniendo órdenes de técnicos',
                error: error.message
            });
        }
    }
});

// Endpoint para obtener detalle completo de una orden
app.get('/api/admin/visitas/orden/:id/detalle', async (req, res) => {
    try {
        const ordenId = parseInt(req.params.id);
        console.log(`📋 [ADMIN] Obteniendo detalle de orden ${ordenId}...`);

        // Intentar obtener de la base de datos primero
        try {
            const resultado = await obtenerDetalleOrden(ordenId);
            if (resultado.success) {
                const orden = resultado.orden;

                // Obtener historial de cambios (simplificado)
                const historial = [
                    {
                        fecha: orden.fecha_creacion,
                        accion: 'Orden creada',
                        usuario: 'Sistema',
                        detalles: 'Orden creada en el sistema'
                    }
                ];

                if (orden.tecnico_id) {
                    historial.push({
                        fecha: orden.fecha_creacion,
                        accion: 'Técnico asignado',
                        usuario: 'Admin',
                        detalles: `Asignado a ${orden.tecnico_nombre}`
                    });
                }

                if (orden.estado === 'en_progreso') {
                    historial.push({
                        fecha: new Date().toISOString(),
                        accion: 'Trabajo iniciado',
                        usuario: orden.tecnico_nombre,
                        detalles: 'El técnico inició el trabajo'
                    });
                }

                if (orden.estado === 'completada') {
                    historial.push({
                        fecha: orden.fecha_completado,
                        accion: 'Trabajo completado',
                        usuario: orden.tecnico_nombre,
                        detalles: 'Trabajo finalizado y reporte enviado'
                    });
                }

                const ordenDetallada = {
                    ...orden,
                    historial: historial
                };

                console.log(`✅ [ADMIN] Detalle de orden ${ordenId} obtenido de BD`);

                return res.json({
                    success: true,
                    orden: ordenDetallada,
                    timestamp: new Date().toISOString(),
                    source: 'database'
                });
            }
        } catch (dbError) {
            console.warn(`⚠️ [ADMIN] Error BD para orden ${ordenId}, usando datos de ejemplo:`, dbError.message);
        }

        // Buscar en datos reales
        let orden = null;

        // Buscar en visitasEnMemoria primero
        const visitaMemoria = visitasEnMemoria[ordenId];
        let visitaBD = null;

        // Buscar en BD
        try {
            const visitasPendientes = await obtenerVisitasPendientes();
            if (visitasPendientes.success) {
                visitaBD = visitasPendientes.visitas.find(v => v.id == ordenId);
            }
        } catch (error) {
            console.warn(`⚠️ [ADMIN] Error obteniendo visita ${ordenId} de BD:`, error.message);
        }

        if (visitaMemoria || visitaBD) {
            orden = {
                id: parseInt(ordenId),
                fecha_creacion: visitaBD ? visitaBD.fecha_creacion : (visitaMemoria?.fechaInicio || new Date().toISOString()),
                fecha_programada: visitaBD ? visitaBD.fecha_programada : new Date().toISOString(),
                estado: visitaMemoria?.estado || visitaBD?.estado || 'programada',
                descripcion: visitaBD ? visitaBD.motivo_visita : 'Visita técnica',
                cliente_nombre: visitaBD ? visitaBD.cliente_nombre : 'Cliente',
                cliente_cedula: visitaBD ? visitaBD.cliente_cedula : 'N/A',
                cliente_direccion: visitaBD ? visitaBD.cliente_direccion : 'Dirección no disponible',
                cliente_telefono: visitaBD ? visitaBD.cliente_telefono : 'N/A',
                tecnico_nombre: visitaBD ? visitaBD.tecnico_asignado_nombre : visitaMemoria?.tecnico_nombre,
                tecnico_telefono: visitaBD ? visitaBD.tecnico_telefono : 'N/A',
                tecnico_especialidad: 'Técnico de campo',
                tecnico_estado: visitaMemoria?.estado === 'en_progreso' ? 'ocupado' : 'disponible',
                tecnico_ubicacion: visitaMemoria?.estado === 'en_progreso' ? 'En campo' : 'Disponible',
                prioridad: visitaBD ? visitaBD.prioridad || 'normal' : 'normal',
                fecha_completado: visitaMemoria?.fechaCompletada || visitaBD?.fecha_completada || null,
                fecha_inicio_real: visitaMemoria?.fechaInicio || null,
                reporte_comentarios: visitaMemoria?.reporte?.comentarios || null,
                trabajo_realizado: visitaMemoria?.reporte?.trabajo_realizado || null,
                materiales_utilizados: visitaMemoria?.reporte?.materiales_utilizados || null,
                recomendaciones: visitaMemoria?.reporte?.recomendaciones || null
            };
        }

        if (!orden) {
            return res.status(404).json({
                success: false,
                message: 'Orden no encontrada'
            });
        }

        // Generar historial basado en datos reales
        const historial = [
            {
                fecha: orden.fecha_creacion,
                accion: 'Orden creada',
                usuario: 'Admin',
                detalles: `Visita programada: ${orden.descripcion}`
            }
        ];

        if (orden.tecnico_nombre) {
            historial.push({
                fecha: orden.fecha_programada,
                accion: 'Técnico asignado',
                usuario: 'Admin',
                detalles: `Asignado a ${orden.tecnico_nombre}`
            });
        }

        if (orden.fecha_inicio_real) {
            historial.push({
                fecha: orden.fecha_inicio_real,
                accion: 'Trabajo iniciado',
                usuario: orden.tecnico_nombre || 'Técnico',
                detalles: 'El técnico inició el trabajo en campo'
            });
        }

        if (orden.estado === 'completada' && orden.fecha_completado) {
            historial.push({
                fecha: orden.fecha_completado,
                accion: 'Trabajo completado',
                usuario: orden.tecnico_nombre || 'Técnico',
                detalles: 'Trabajo finalizado y reporte enviado'
            });
        }

        const ordenDetallada = {
            ...orden,
            historial: historial
        };

        console.log(`✅ [ADMIN] Detalle de orden ${ordenId} obtenido (ejemplo)`);

        res.json({
            success: true,
            orden: ordenDetallada,
            timestamp: new Date().toISOString(),
            source: 'example_data'
        });

    } catch (error) {
        console.error(`❌ [ADMIN ERROR] Error obteniendo detalle de orden ${req.params.id}:`, error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo detalle de la orden',
            error: error.message
        });
    }
});

// Endpoint de debug para ver visitasEnMemoria
app.get('/api/debug/visitas-memoria', async (req, res) => {
    // Timeout rápido para debug
    const timeoutId = setTimeout(() => {
        if (!res.headersSent) {
            res.json({
                success: false,
                error: 'Timeout debug',
                timestamp: new Date().toISOString()
            });
        }
    }, 1000);

    try {
        const visitasInfo = {
            total: Object.keys(visitasEnMemoria).length,
            visitas: visitasEnMemoria,
            enProgreso: Object.keys(visitasEnMemoria).filter(id => visitasEnMemoria[id].estado === 'en_progreso'),
            estados: {}
        };

        // Contar estados
        Object.keys(visitasEnMemoria).forEach(id => {
            const estado = visitasEnMemoria[id].estado || 'sin_estado';
            visitasInfo.estados[estado] = (visitasInfo.estados[estado] || 0) + 1;
        });

        console.log('🔍 [DEBUG] Estado de visitasEnMemoria:', visitasInfo);

        clearTimeout(timeoutId);
        if (!res.headersSent) {
            res.json({
                success: true,
                debug: visitasInfo,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('❌ [DEBUG ERROR]', error);
        clearTimeout(timeoutId);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Endpoint para crear visita de prueba programada
app.post('/api/debug/crear-visita-programada', async (req, res) => {
    try {
        const { cliente_nombre, cliente_telefono, fecha_programada } = req.body;

        const mysql = require('mysql2/promise');
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        // Insertar visita de prueba
        const [result] = await conexion.execute(`
            INSERT INTO visitas_tecnicas (
                cliente_nombre,
                cliente_cedula,
                cliente_telefono,
                estado,
                fecha_programada,
                fecha_creacion,
                motivo_visita,
                tecnico_asignado_id,
                tecnico_asignado_nombre
            ) VALUES (?, ?, ?, 'programada', ?, NOW(), 'Visita de prueba para notificaciones', NULL, NULL)
        `, [
            cliente_nombre || 'Cliente de Prueba',
            cliente_telefono || '3001234567',
            cliente_telefono || '3001234567',
            fecha_programada || new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0] + ' 10:00:00'
        ]);

        await conexion.end();

        console.log(`✅ [DEBUG] Visita de prueba creada con ID: ${result.insertId}`);

        res.json({
            success: true,
            mensaje: 'Visita de prueba programada creada exitosamente',
            visitaId: result.insertId,
            datos: {
                cliente_nombre: cliente_nombre || 'Cliente de Prueba',
                cliente_telefono: cliente_telefono || '3001234567',
                fecha_programada: fecha_programada || 'mañana',
                estado: 'programada'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [DEBUG] Error creando visita:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para probar envío de notificaciones de visitas
app.post('/api/debug/test-notificacion-visita', async (req, res) => {
    try {
        const { telefono, nombre } = req.body;

        if (!telefono) {
            return res.status(400).json({
                success: false,
                message: 'Número de teléfono es requerido'
            });
        }

        // Limpiar número de teléfono
        let numeroTelefono = telefono.toString().replace(/\D/g, '');
        if (!numeroTelefono.startsWith('57') && numeroTelefono.length === 10) {
            numeroTelefono = '57' + numeroTelefono;
        }

        const chatId = numeroTelefono + '@c.us';
        const nombreCliente = nombre || 'Cliente de Prueba';
        const fecha = new Date().toLocaleDateString('es-ES', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const mensaje = `Hola ${nombreCliente},

Le informamos que el día ${fecha} será visitado por nuestro equipo técnico de *SOLUCNET SAS*.

🔧 *VISITA TÉCNICA PROGRAMADA - PRUEBA*

Agradecemos contar con su disponibilidad para recibir la visita técnica.

⚠️ *IMPORTANTE:* No podemos indicarle una hora precisa ya que el tiempo de los técnicos es muy rotativo por la demora en las visitas anteriores y eventos climáticos.

Nuestro técnico se comunicará con usted cuando esté cerca de su ubicación.

Este es un mensaje de PRUEBA del sistema de notificaciones.
*SOLUCNET SAS*`;

        console.log(`🧪 [TEST NOTIFICACIÓN] Enviando mensaje de prueba a ${nombreCliente} (${numeroTelefono})`);

        const resultado = await enviarMensaje(chatId, mensaje);

        res.json({
            success: resultado,
            mensaje: resultado
                ? 'Notificación de prueba enviada exitosamente'
                : 'Error enviando notificación de prueba',
            detalles: {
                cliente: nombreCliente,
                telefono: numeroTelefono,
                chatId: chatId,
                conexionLocal: true
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [TEST NOTIFICACIÓN] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para marcar visita real como en progreso
app.get('/api/debug/marcar-en-progreso/:visitaId', async (req, res) => {
    try {
        const visitaId = req.params.visitaId;
        console.log(`🧪 [DEBUG] Marcando visita ${visitaId} como en progreso...`);

        // Marcar en visitasEnMemoria
        if (!visitasEnMemoria[visitaId]) {
            visitasEnMemoria[visitaId] = {};
        }

        visitasEnMemoria[visitaId].estado = 'en_progreso';
        visitasEnMemoria[visitaId].fechaInicio = new Date().toISOString();
        visitasEnMemoria[visitaId].cliente_nombre = visitasEnMemoria[visitaId].cliente_nombre || `Cliente ID:${visitaId}`;
        visitasEnMemoria[visitaId].tecnico_nombre = visitasEnMemoria[visitaId].tecnico_nombre || `Sin asignar`;

        console.log(`✅ [DEBUG] Visita ${visitaId} marcada como en progreso`);

        res.json({
            success: true,
            visitaId: visitaId,
            estado: visitasEnMemoria[visitaId],
            message: `Visita ${visitaId} marcada como en progreso`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [DEBUG ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint para simular una visita en progreso (solo para pruebas)
app.post('/api/debug/crear-visita-prueba', async (req, res) => {
    try {
        const visitaId = Date.now(); // ID único basado en timestamp

        visitasEnMemoria[visitaId] = {
            estado: 'en_progreso',
            fechaInicio: new Date().toISOString(),
            cliente_nombre: 'Cliente de Prueba',
            cliente_direccion: 'Calle de Prueba #123',
            tecnico_nombre: 'Técnico de Prueba',
            descripcion: 'Visita de prueba creada desde admin'
        };

        console.log(`🧪 [DEBUG] Visita de prueba creada: ${visitaId}`);

        res.json({
            success: true,
            visitaId: visitaId,
            visita: visitasEnMemoria[visitaId],
            message: 'Visita de prueba creada en memoria'
        });
    } catch (error) {
        console.error('❌ [DEBUG ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint simplificado para iniciar visita (para pruebas)
app.get('/api/debug/iniciar-visita/:id', async (req, res) => {
    try {
        const visitaId = req.params.id;

        if (!visitasEnMemoria[visitaId]) {
            visitasEnMemoria[visitaId] = {};
        }

        visitasEnMemoria[visitaId].estado = 'en_progreso';
        visitasEnMemoria[visitaId].fechaInicio = new Date().toISOString();
        visitasEnMemoria[visitaId].cliente_nombre = visitasEnMemoria[visitaId].cliente_nombre || `Cliente #${visitaId}`;
        visitasEnMemoria[visitaId].tecnico_nombre = visitasEnMemoria[visitaId].tecnico_nombre || `Técnico #${visitaId}`;

        console.log(`🧪 [DEBUG] Visita ${visitaId} marcada como en progreso`);

        res.json({
            success: true,
            visitaId: visitaId,
            estado: visitasEnMemoria[visitaId],
            totalEnProgreso: Object.keys(visitasEnMemoria).filter(id => visitasEnMemoria[id].estado === 'en_progreso').length
        });
    } catch (error) {
        console.error('❌ [DEBUG ERROR]', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API para crear nueva visita técnica
app.post('/api/visitas-tecnicas', uploadPdfVisitas.array('archivos_pdf', 5), async (req, res) => {
    try {
        const datosVisita = req.body;
        const usuarioCreador = 1; // Usuario por defecto
        const archivosPdf = req.files || [];

        console.log('📍 [API] Localidad recibida:', datosVisita.localidad);

        // Validar campos requeridos
        if (!datosVisita.cliente_id || !datosVisita.cliente_nombre ||
            !datosVisita.cliente_cedula || !datosVisita.motivo_visita) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos'
            });
        }

        // Agregar información de los archivos PDF al objeto de datos
        datosVisita.archivos_pdf = archivosPdf.map(archivo => ({
            nombre_original: archivo.originalname,
            nombre_archivo: archivo.filename,
            ruta: archivo.path,
            tamaño: archivo.size
        }));

        const result = await crearVisitaTecnica(datosVisita, usuarioCreador);
        res.json(result);
    } catch (error) {
        console.error('Error creando visita técnica:', error.message);
        res.status(500).json({
            success: false,
            message: error.message.includes('Solo se permiten archivos PDF') ?
                    'Solo se permiten archivos PDF' : 'Error interno del servidor'
        });
    }
});

// API para crear cliente nuevo y visita técnica
app.post('/api/crear-cliente-y-visita', uploadPdfVisitas.array('archivos_pdf', 5), async (req, res) => {
    try {
        const datosCompletos = req.body;
        const usuarioCreador = 1; // Usuario por defecto
        const archivosPdf = req.files || [];

        // Validar campos requeridos del cliente
        if (!datosCompletos.cliente_nombre || !datosCompletos.cliente_cedula ||
            !datosCompletos.cliente_telefono || !datosCompletos.cliente_direccion ||
            !datosCompletos.motivo_visita || !datosCompletos.fecha_programada) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos'
            });
        }

        // Separar datos del cliente y la visita
        const datosCliente = {
            nombre: datosCompletos.cliente_nombre,
            cedula: datosCompletos.cliente_cedula,
            telefono: datosCompletos.cliente_telefono,
            movil: datosCompletos.cliente_movil || '',
            direccion: datosCompletos.cliente_direccion,
            email: datosCompletos.cliente_email || '',
            coordenadas: datosCompletos.cliente_coordenadas || '',
            estado: 'Activo'
        };

        const datosVisita = {
            cliente_nombre: datosCompletos.cliente_nombre,
            cliente_cedula: datosCompletos.cliente_cedula,
            cliente_telefono: datosCompletos.cliente_telefono,
            cliente_movil: datosCompletos.cliente_movil || '',
            cliente_direccion: datosCompletos.cliente_direccion,
            cliente_coordenadas: datosCompletos.cliente_coordenadas || '',
            motivo_visita: datosCompletos.motivo_visita,
            fecha_programada: datosCompletos.fecha_programada,
            notas_admin: datosCompletos.notas_admin || '',
            bd_origen: 'nuevos_clientes', // Identificador para clientes nuevos
            localidad: datosCompletos.localidad || ''
        };

        // Agregar información de los archivos PDF
        datosVisita.archivos_pdf = archivosPdf.map(archivo => ({
            nombre_original: archivo.originalname,
            nombre_archivo: archivo.filename,
            ruta: archivo.path,
            tamaño: archivo.size
        }));

        const result = await crearClienteYVisita(datosCliente, datosVisita, usuarioCreador);
        res.json(result);
    } catch (error) {
        console.error('Error creando cliente y visita:', error.message);
        res.status(500).json({
            success: false,
            message: error.message.includes('Solo se permiten archivos PDF') ?
                    'Solo se permiten archivos PDF' : 'Error interno del servidor'
        });
    }
});

// API para obtener visitas pendientes
app.get('/api/visitas-pendientes', async (req, res) => {
    try {
        const result = await obtenerVisitasPendientes();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo visitas pendientes:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener visitas no asignadas (estado 'programada')
app.get('/api/visitas-no-asignadas', async (req, res) => {
    try {
        const result = await obtenerVisitasNoAsignadas();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo visitas no asignadas:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener visitas asignadas (estado 'asignada')
app.get('/api/visitas-asignadas', async (req, res) => {
    try {
        const result = await obtenerVisitasAsignadas();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo visitas asignadas:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener visitas en progreso (estado 'en_progreso')
app.get('/api/visitas-en-progreso', async (req, res) => {
    try {
        const result = await obtenerVisitasEnProgreso();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo visitas en progreso:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener visitas completadas del día actual
app.get('/api/visitas-completadas-hoy', async (req, res) => {
    try {
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        await conexion.query('USE solucnet_auth_system');

        // Obtener visitas completadas del día actual
        const [visitas] = await conexion.execute(`
            SELECT *
            FROM visitas_tecnicas
            WHERE estado = 'completada'
            AND DATE(fecha_completada) = CURDATE()
            ORDER BY fecha_completada DESC
        `);

        await conexion.end();

        console.log(`📊 Visitas completadas hoy encontradas: ${visitas.length}`);

        res.json({
            success: true,
            visitas: visitas
        });

    } catch (error) {
        console.error('Error obteniendo visitas completadas del día:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener estadísticas de visitas
app.get('/api/estadisticas-visitas', async (req, res) => {
    try {
        const result = await obtenerEstadisticasVisitas();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo estadísticas de visitas:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para desasignar técnico de una visita
app.post('/api/desasignar-tecnico', async (req, res) => {
    try {
        const { visita_id } = req.body;

        if (!visita_id) {
            return res.status(400).json({
                success: false,
                message: 'ID de visita es requerido'
            });
        }

        const result = await desasignarTecnicoDeVisita(visita_id);
        res.json(result);
    } catch (error) {
        console.error('Error desasignando técnico:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para desasignar técnicos masivamente
app.post('/api/desasignar-masivo', async (req, res) => {
    try {
        const { visitas_ids } = req.body;

        console.log('🗑️ [DESASIGNAR-MASIVO] Solicitud recibida para desasignar visitas:', visitas_ids);

        if (!visitas_ids || !Array.isArray(visitas_ids) || visitas_ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere un array de IDs de visitas'
            });
        }

        let desasignadas = 0;
        let errores = 0;
        const resultados = [];

        // Desasignar cada visita
        for (const visita_id of visitas_ids) {
            try {
                const result = await desasignarTecnicoDeVisita(visita_id);
                if (result.success) {
                    desasignadas++;
                    console.log(`✅ [DESASIGNAR-MASIVO] Visita ${visita_id} desasignada exitosamente`);
                } else {
                    errores++;
                    console.error(`❌ [DESASIGNAR-MASIVO] Error desasignando visita ${visita_id}:`, result.message);
                }
                resultados.push({
                    visita_id,
                    success: result.success,
                    message: result.message
                });
            } catch (error) {
                errores++;
                console.error(`❌ [DESASIGNAR-MASIVO] Error procesando visita ${visita_id}:`, error.message);
                resultados.push({
                    visita_id,
                    success: false,
                    message: error.message
                });
            }
        }

        console.log(`📊 [DESASIGNAR-MASIVO] Resultado: ${desasignadas} desasignadas, ${errores} errores`);

        res.json({
            success: desasignadas > 0,
            desasignadas,
            errores,
            total: visitas_ids.length,
            message: `${desasignadas} visita(s) desasignada(s) exitosamente${errores > 0 ? `, ${errores} error(es)` : ''}`,
            resultados
        });

    } catch (error) {
        console.error('❌ [DESASIGNAR-MASIVO] Error general:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para editar una visita sin agendar
app.put('/api/editar-visita-sin-agendar', uploadPdfVisitas.array('archivos_pdf', 5), async (req, res) => {
    try {
        const { visitaId, localidad, fechaVisita, motivoVisita, observacion } = req.body;

        if (!visitaId || !localidad || !fechaVisita || !motivoVisita) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos obligatorios: visitaId, localidad, fechaVisita y motivoVisita son requeridos'
            });
        }

        const result = await editarVisitaSinAgendar(visitaId, localidad, fechaVisita, motivoVisita, observacion);

        // Si hay archivos PDF nuevos, guardarlos
        if (req.files && req.files.length > 0 && result.success) {
            const conexion = await mysql.createConnection({
                host: process.env.DB_SYSTEM_HOST,
                user: process.env.DB_SYSTEM_USER,
                password: process.env.DB_SYSTEM_PASSWORD,
                database: process.env.DB_SYSTEM_DATABASE
            });
            await conexion.query('USE solucnet_auth_system');

            for (const archivo of req.files) {
                await conexion.execute(`
                    INSERT INTO archivos_pdf_visitas (visita_id, nombre_original, nombre_archivo, ruta_archivo, tamaño)
                    VALUES (?, ?, ?, ?, ?)
                `, [visitaId, archivo.originalname, archivo.filename, archivo.path, archivo.size]);
            }

            await conexion.end();
        }

        res.json(result);
    } catch (error) {
        console.error('Error editando visita sin agendar:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener archivos PDF de una visita
app.get('/api/visitas-tecnicas/:id/archivos', async (req, res) => {
    try {
        const visitaId = req.params.id;

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        const [archivos] = await conexion.execute(
            'SELECT id, nombre_original, nombre_archivo, tamaño FROM archivos_pdf_visitas WHERE visita_id = ?',
            [visitaId]
        );

        await conexion.end();

        res.json({
            success: true,
            archivos: archivos
        });
    } catch (error) {
        console.error('Error obteniendo archivos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para eliminar un archivo PDF
app.delete('/api/archivos-pdf/:id', async (req, res) => {
    try {
        const archivoId = req.params.id;

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        // Obtener información del archivo antes de eliminarlo
        const [archivos] = await conexion.execute(
            'SELECT ruta_archivo FROM archivos_pdf_visitas WHERE id = ?',
            [archivoId]
        );

        if (archivos.length === 0) {
            await conexion.end();
            return res.status(404).json({
                success: false,
                message: 'Archivo no encontrado'
            });
        }

        // Eliminar archivo físico
        const fs = require('fs');
        const rutaArchivo = archivos[0].ruta_archivo;
        if (fs.existsSync(rutaArchivo)) {
            fs.unlinkSync(rutaArchivo);
        }

        // Eliminar registro de la base de datos
        await conexion.execute('DELETE FROM archivos_pdf_visitas WHERE id = ?', [archivoId]);

        await conexion.end();

        res.json({
            success: true,
            message: 'Archivo eliminado exitosamente'
        });
    } catch (error) {
        console.error('Error eliminando archivo:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener técnicos disponibles
app.get('/api/tecnicos', async (req, res) => {
    try {
        console.log('🔍 [API TECNICOS] Petición recibida');
        const result = await obtenerTecnicos();
        console.log('✅ [API TECNICOS] Resultado obtenido:', result);
        res.json(result);
    } catch (error) {
        console.error('❌ [API TECNICOS] Error obteniendo técnicos:', error.message);
        console.error(error.stack);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para asignar técnico a visita
app.put('/api/visitas-tecnicas/:id/asignar', async (req, res) => {
    try {
        const visitaId = req.params.id;
        const { tecnicoId, enviarNotificacion = true } = req.body; // Por defecto enviar notificación

        if (!tecnicoId) {
            return res.status(400).json({
                success: false,
                message: 'ID del técnico es requerido'
            });
        }

        // Obtener información de la visita
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        const [visita] = await conexion.execute(
            'SELECT * FROM visitas_tecnicas WHERE id = ?',
            [visitaId]
        );

        if (visita.length === 0) {
            await conexion.end();
            return res.status(404).json({
                success: false,
                message: 'Visita no encontrada'
            });
        }

        const visitaData = visita[0];
        let notificacionEnviada = false; // Inicializar siempre como false

        // Si el cliente NO ha sido notificado Y se solicitó enviar notificación, intentar enviar
        if (!visitaData.cliente_notificado && enviarNotificacion) {
            console.log(`📱 [ASIGNACIÓN] Intentando enviar notificación al cliente ${visitaData.cliente_nombre}...`);

            // Verificar que WhatsApp esté listo
            if (whatsappListo && client) {
                try {
                    // Obtener teléfonos priorizando móvil sobre teléfono fijo (misma lógica que enviarNotificacionesWhatsApp)
                    let telefonoCliente = visitaData.cliente_movil || visitaData.cliente_telefono;

                    console.log(`📱 [ASIGNACIÓN] ${visitaData.cliente_nombre} - Teléfono detectado: "${telefonoCliente}"`);

                    // Validar teléfono
                    if (!telefonoCliente || telefonoCliente === 'Sin teléfono' || telefonoCliente === 'N/A') {
                        console.warn(`⚠️ [ASIGNACIÓN] ${visitaData.cliente_nombre} no tiene número de teléfono válido`);
                    } else {
                        // Dividir números múltiples separados por comas
                        const numerosMultiples = telefonoCliente.split(',').map(num => num.trim()).filter(num => num.length > 0);
                        console.log(`📞 [ASIGNACIÓN] ${visitaData.cliente_nombre} - Números detectados: [${numerosMultiples.join(', ')}]`);

                        // Formatear fecha
                        const fechaProgramada = new Date(visitaData.fecha_programada);
                        const fechaFormateada = fechaProgramada.toLocaleDateString('es-ES', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });

                        // Mensaje para el cliente
                        const mensaje = `Hola ${visitaData.cliente_nombre},

Le informamos que el día ${fechaFormateada} será visitado por nuestro equipo técnico de *SOLUCNET SAS*.

🔧 *VISITA TÉCNICA PROGRAMADA*

Agradecemos contar con su disponibilidad para recibir la visita técnica.

⚠️ *IMPORTANTE:* No podemos indicarle una hora precisa ya que el tiempo de los técnicos es muy rotativo por la demora en las visitas anteriores y eventos climáticos.

Nuestro técnico se comunicará con usted cuando esté cerca de su ubicación.

Gracias por su comprensión.
*SOLUCNET SAS*`;

                        // Procesar cada número por separado
                        let envioExitoso = false;
                        for (const numeroOriginal of numerosMultiples) {
                            // Limpiar número de teléfono (quitar espacios, guiones, etc.)
                            let numeroTelefono = numeroOriginal.toString().replace(/\D/g, '');

                            console.log(`📱 [ASIGNACIÓN] Número original: "${numeroOriginal}" -> limpio: "${numeroTelefono}"`);

                            // Si el número no tiene código de país, agregar +57 para Colombia
                            if (!numeroTelefono.startsWith('57') && numeroTelefono.length === 10) {
                                numeroTelefono = '57' + numeroTelefono;
                            }

                            // Validar que el número tenga longitud correcta
                            if (numeroTelefono.length < 10 || numeroTelefono.length > 15) {
                                console.warn(`⚠️ [ASIGNACIÓN] Número inválido: "${numeroTelefono}" (longitud: ${numeroTelefono.length})`);
                                continue;
                            }

                            // Convertir número de teléfono al formato de chatId para WhatsApp
                            const chatId = numeroTelefono + '@c.us';

                            // Enviar mensaje usando la función enviarMensaje
                            console.log(`📤 [ASIGNACIÓN] Enviando a ${visitaData.cliente_nombre} (${numeroTelefono}), chatId: ${chatId}`);

                            const resultado = await enviarMensaje(chatId, mensaje);

                            console.log(`📩 [ASIGNACIÓN] Resultado del envío a ${visitaData.cliente_nombre}: ${resultado ? 'ÉXITO' : 'FALLO'}`);

                            if (resultado) {
                                envioExitoso = true;
                                console.log(`✅ [ASIGNACIÓN] Notificación enviada a ${visitaData.cliente_nombre} (${numeroTelefono})`);
                                break; // Si se envió exitosamente a un número, no intentar con los demás
                            }
                        }

                        // Si al menos un envío fue exitoso, marcar como notificado
                        if (envioExitoso) {
                            await conexion.execute(
                                'UPDATE visitas_tecnicas SET cliente_notificado = TRUE WHERE id = ?',
                                [visitaId]
                            );
                            notificacionEnviada = true;
                            console.log(`✅ [ASIGNACIÓN] Cliente ${visitaData.cliente_nombre} marcado como notificado`);
                        } else {
                            console.warn(`⚠️ [ASIGNACIÓN] No se pudo enviar notificación a ningún número de ${visitaData.cliente_nombre}`);
                        }
                    }

                } catch (errorNotif) {
                    console.error(`❌ [ASIGNACIÓN] Error enviando notificación a ${visitaData.cliente_nombre}:`, errorNotif.message);
                    // Continuar con la asignación aunque falle la notificación
                }
            } else {
                console.log(`⚠️ [ASIGNACIÓN] WhatsApp no está listo para enviar notificación`);
            }
        } else if (visitaData.cliente_notificado) {
            // Cliente ya estaba notificado previamente
            notificacionEnviada = true;
            console.log(`ℹ️ [ASIGNACIÓN] Cliente ${visitaData.cliente_nombre} ya había sido notificado previamente`);
        } else if (!enviarNotificacion) {
            // Se solicitó NO enviar notificación en esta asignación
            notificacionEnviada = false;
            console.log(`📋 [ASIGNACIÓN] Asignación sin notificación para ${visitaData.cliente_nombre} (cliente_notificado: ${visitaData.cliente_notificado})`);
        }

        await conexion.end();

        // Asignar técnico
        const result = await asignarTecnicoAVisita(visitaId, tecnicoId);

        // Agregar información sobre la notificación en la respuesta
        result.notificacionEnviada = notificacionEnviada;
        result.clienteNombre = visitaData.cliente_nombre;
        result.clienteNotificado = visitaData.cliente_notificado; // Incluir estado original

        res.json(result);
    } catch (error) {
        console.error('Error asignando técnico:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para desasignar técnico de una visita
app.put('/api/visitas-tecnicas/:id/desasignar', async (req, res) => {
    try {
        const visitaId = req.params.id;

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        // Desasignar técnico (poner NULL) y resetear cliente_notificado
        await conexion.execute(`
            UPDATE visitas_tecnicas
            SET tecnico_asignado_id = NULL,
                tecnico_asignado_nombre = NULL,
                estado = 'programada',
                cliente_notificado = FALSE
            WHERE id = ?
        `, [visitaId]);

        await conexion.end();

        res.json({
            success: true,
            message: 'Técnico desasignado exitosamente'
        });

    } catch (error) {
        console.error('Error desasignando técnico:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para eliminar visita técnica
app.delete('/api/visitas-tecnicas/:id', async (req, res) => {
    try {
        const visitaId = req.params.id;

        // Eliminar de la base de datos
        const resultado = await eliminarVisitaTecnica(visitaId);

        // Eliminar de memoria si existe
        if (visitasEnMemoria[visitaId]) {
            delete visitasEnMemoria[visitaId];
        }

        res.json({
            success: true,
            message: 'Visita técnica eliminada exitosamente'
        });
    } catch (error) {
        console.error('Error eliminando visita:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para actualizar datos de una visita técnica (fecha, notas, etc.)
app.put('/api/visitas-tecnicas/:id', async (req, res) => {
    try {
        const visitaId = req.params.id;
        const { fecha_programada, notas_admin } = req.body;

        if (!fecha_programada && !notas_admin) {
            return res.status(400).json({
                success: false,
                message: 'Debe proporcionar al menos un campo para actualizar'
            });
        }

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        // Construir consulta de actualización dinámica
        let campos = [];
        let valores = [];

        if (fecha_programada) {
            campos.push('fecha_programada = ?');
            valores.push(fecha_programada);
        }

        if (notas_admin) {
            campos.push('notas_admin = ?');
            valores.push(notas_admin);
        }

        valores.push(visitaId); // Para el WHERE

        const sql = `UPDATE visitas_tecnicas SET ${campos.join(', ')} WHERE id = ?`;

        await conexion.execute(sql, valores);
        await conexion.end();

        console.log(`✅ Visita ${visitaId} actualizada exitosamente`);

        res.json({
            success: true,
            message: 'Visita técnica actualizada exitosamente'
        });

    } catch (error) {
        console.error('Error actualizando visita:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor: ' + error.message
        });
    }
});

// API para obtener visitas de un técnico específico
app.get('/api/tecnicos/:id/visitas', async (req, res) => {
    try {
        const tecnicoId = req.params.id;

        // Obtener visitas del técnico desde la base de datos
        const result = await obtenerVisitasTecnico(tecnicoId);

        if (result.success) {
            // Actualizar estados desde memoria
            const visitasConEstadoActualizado = result.visitas.map(visita => {
                const estadoMemoria = visitasEnMemoria[visita.id];
                if (estadoMemoria && estadoMemoria.estado) {
                    visita.estado = estadoMemoria.estado;
                }
                return visita;
            });

            res.json({
                success: true,
                visitas: visitasConEstadoActualizado
            });
        } else {
            res.json({
                success: true,
                visitas: []
            });
        }
    } catch (error) {
        console.error('Error obteniendo visitas del técnico:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ==================== ENDPOINTS DE UBICACIÓN DE TÉCNICOS ====================

// API para guardar ubicación del técnico (desde app móvil)
app.post('/api/tecnicos/ubicacion', async (req, res) => {
    try {
        console.log('📍 [UBICACIÓN] Petición recibida para guardar ubicación');

        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            console.log('⚠️ [UBICACIÓN] Token no proporcionado');
            return res.status(401).json({
                success: false,
                message: 'Token no proporcionado'
            });
        }

        // Verificar token y obtener información del usuario
        const usuario = await verificarToken(token);

        if (!usuario) {
            console.log('⚠️ [UBICACIÓN] Token inválido o expirado');
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        // Verificar que sea un técnico
        if (usuario.rol !== 'tecnico') {
            console.log('⚠️ [UBICACIÓN] Usuario no es técnico, rol:', usuario.rol);
            return res.status(403).json({
                success: false,
                message: 'Solo técnicos pueden enviar ubicación'
            });
        }

        const { latitud, longitud, precision_gps } = req.body;
        console.log(`📍 [UBICACIÓN] Técnico: ${usuario.nombre} (ID: ${usuario.id})`);
        console.log(`📍 [UBICACIÓN] Coordenadas: Lat ${latitud}, Lng ${longitud}, Precisión: ${precision_gps}m`);

        if (!latitud || !longitud) {
            console.log('⚠️ [UBICACIÓN] Coordenadas incompletas');
            return res.status(400).json({
                success: false,
                message: 'Latitud y longitud son requeridas'
            });
        }

        // Guardar ubicación
        const result = await guardarUbicacionTecnico(
            usuario.id,
            latitud,
            longitud,
            precision_gps
        );

        if (result.success) {
            console.log(`✅ [UBICACIÓN] Ubicación guardada exitosamente para ${usuario.nombre}`);
        } else {
            console.log(`❌ [UBICACIÓN] Error guardando ubicación: ${result.message}`);
        }

        res.json(result);
    } catch (error) {
        console.error('❌ [UBICACIÓN] Error crítico guardando ubicación:', error.message);
        console.error(error.stack);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener últimas ubicaciones de todos los técnicos (para admin)
app.get('/api/tecnicos/ubicaciones', async (req, res) => {
    try {
        const result = await obtenerUltimasUbicacionesTecnicos();
        res.json(result);
    } catch (error) {
        console.error('❌ Error obteniendo ubicaciones de técnicos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener historial de ubicaciones de un técnico específico
app.get('/api/tecnicos/:id/ubicaciones/historial', async (req, res) => {
    try {
        const tecnicoId = req.params.id;
        const limite = req.query.limite || 50;

        const result = await obtenerHistorialUbicacionesTecnico(tecnicoId, limite);
        res.json(result);
    } catch (error) {
        console.error('❌ Error obteniendo historial de ubicaciones:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener ubicaciones de clientes asignados al técnico
app.get('/api/ubicaciones-clientes-asignados', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        console.log('📍 [UBICACIONES-CLIENTES] Token recibido:', token ? 'Sí' : 'No');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token no proporcionado'
            });
        }

        // Verificar el token y obtener información del usuario
        const usuario = await verificarToken(token);

        console.log('📍 [UBICACIONES-CLIENTES] Usuario verificado:', usuario ? usuario.username : 'null');

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        // Verificar que sea un técnico
        if (usuario.rol !== 'tecnico') {
            console.log('📍 [UBICACIONES-CLIENTES] Usuario no es técnico, rol:', usuario.rol);
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo técnicos pueden acceder a esta ruta.'
            });
        }

        // Obtener visitas asignadas al técnico que NO estén completadas o canceladas
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        console.log('📍 [UBICACIONES-CLIENTES] Buscando clientes asignados al usuario ID:', usuario.id);

        // Obtener visitas con coordenadas que estén asignadas, en progreso o programadas
        const [visitas] = await conexion.execute(`
            SELECT
                id,
                cliente_nombre,
                cliente_direccion,
                cliente_coordenadas,
                estado,
                localidad,
                observacion,
                observacion_ultima_hora,
                motivo_visita
            FROM visitas_tecnicas
            WHERE tecnico_asignado_id = ?
            AND estado IN ('asignada', 'en_progreso', 'programada')
            AND cliente_coordenadas IS NOT NULL
            AND cliente_coordenadas != ''
            ORDER BY fecha_programada ASC
        `, [usuario.id]);

        console.log('📍 [UBICACIONES-CLIENTES] Visitas con coordenadas encontradas:', visitas.length);

        // Procesar coordenadas y crear array de ubicaciones
        const ubicaciones = [];

        for (const visita of visitas) {
            try {
                // Parsear coordenadas (formato: "lat, lng" o "lat,lng")
                const coords = visita.cliente_coordenadas.trim().split(',');

                if (coords.length === 2) {
                    const latitud = parseFloat(coords[0].trim());
                    const longitud = parseFloat(coords[1].trim());

                    // Validar que sean números válidos
                    if (!isNaN(latitud) && !isNaN(longitud)) {
                        ubicaciones.push({
                            visita_id: visita.id,
                            nombre_cliente: visita.cliente_nombre,
                            direccion: visita.cliente_direccion,
                            latitud: latitud,
                            longitud: longitud,
                            estado_visita: visita.estado,
                            localidad: visita.localidad,
                            observaciones: visita.observacion_ultima_hora || visita.observacion || visita.motivo_visita
                        });

                        console.log(`✅ [UBICACIONES-CLIENTES] Cliente procesado: ${visita.cliente_nombre} (${latitud}, ${longitud})`);
                    } else {
                        console.warn(`⚠️ [UBICACIONES-CLIENTES] Coordenadas inválidas para visita ${visita.id}: ${visita.cliente_coordenadas}`);
                    }
                } else {
                    console.warn(`⚠️ [UBICACIONES-CLIENTES] Formato de coordenadas inválido para visita ${visita.id}: ${visita.cliente_coordenadas}`);
                }
            } catch (error) {
                console.error(`❌ [UBICACIONES-CLIENTES] Error procesando coordenadas de visita ${visita.id}:`, error.message);
            }
        }

        await conexion.end();

        console.log('📍 [UBICACIONES-CLIENTES] Ubicaciones válidas procesadas:', ubicaciones.length);

        res.json({
            success: true,
            ubicaciones: ubicaciones,
            total: ubicaciones.length
        });

    } catch (error) {
        console.error('❌ [UBICACIONES-CLIENTES] Error obteniendo ubicaciones:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ============================================================================

// Endpoint para que el técnico autenticado obtenga sus propias visitas
app.get('/api/mis-visitas', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        console.log('📍 [MIS-VISITAS] Token recibido:', token ? 'Sí' : 'No');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token no proporcionado'
            });
        }

        // Verificar el token y obtener información del usuario
        const usuario = await verificarToken(token);

        console.log('📍 [MIS-VISITAS] Usuario verificado:', usuario ? usuario.username : 'null');

        if (!usuario) {
            return res.status(401).json({
                success: false,
                message: 'Token inválido o expirado'
            });
        }

        // Verificar que sea un técnico
        if (usuario.rol !== 'tecnico') {
            console.log('📍 [MIS-VISITAS] Usuario no es técnico, rol:', usuario.rol);
            return res.status(403).json({
                success: false,
                message: 'Acceso denegado. Solo técnicos pueden acceder a esta ruta.'
            });
        }

        // Buscar visitas asignadas directamente al usuario del sistema (sin tabla tecnicos intermedia)
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        console.log('📍 [MIS-VISITAS] Buscando visitas asignadas al usuario ID:', usuario.id);

        // Obtener visitas asignadas directamente al usuario_id
        const [visitas] = await conexion.execute(`
            SELECT *
            FROM visitas_tecnicas
            WHERE tecnico_asignado_id = ? AND estado IN ('asignada', 'en_progreso')
            ORDER BY fecha_programada ASC
        `, [usuario.id]);

        console.log('📍 [MIS-VISITAS] Visitas encontradas:', visitas.length);

        await conexion.end();

        // Actualizar estados desde memoria y obtener información de equipos
        const visitasConDatos = [];
        for (const visita of visitas) {
            const estadoMemoria = visitasEnMemoria[visita.id];
            if (estadoMemoria && estadoMemoria.estado) {
                visita.estado = estadoMemoria.estado;
            }

            // Excluir visitas completadas o canceladas
            if (visita.estado === 'completada' || visita.estado === 'cancelada') {
                console.log(`⏭️ [MIS-VISITAS] Excluyendo visita ${visita.id} con estado: ${visita.estado}`);
                continue;
            }

            // Obtener información de equipos si está disponible
            if (visita.cliente_cedula) {
                try {
                    console.log(`🔍 [MIS-VISITAS] Obteniendo equipos para cliente: ${visita.cliente_cedula} (visita ${visita.id})`);
                    const serialInfo = await obtenerSerialEquipoCliente(visita.cliente_cedula);
                    if (serialInfo) {
                        console.log(`✅ [MIS-VISITAS] Equipos obtenidos: ${serialInfo.todos_los_equipos?.length || 0} equipos`);
                        visita.serial_equipo_asignado = serialInfo.serial_equipo_asignado;
                        visita.equipo_tipo = serialInfo.equipo_tipo;
                        visita.equipo_estado = serialInfo.equipo_estado;
                        visita.todos_los_equipos = serialInfo.todos_los_equipos;
                        if (!visita.mikrotik_nombre) visita.mikrotik_nombre = serialInfo.mikrotik_nombre;
                        if (!visita.usuario_ppp) visita.usuario_ppp = serialInfo.usuario_ppp;
                    } else {
                        console.log(`⚠️ [MIS-VISITAS] No se encontró información de equipos para ${visita.cliente_cedula}`);
                    }
                } catch (err) {
                    console.log(`❌ [MIS-VISITAS] Error obteniendo seriales para cliente ${visita.cliente_cedula}: ${err.message}`);
                }
            }

            visitasConDatos.push(visita);
        }

        console.log('📍 [MIS-VISITAS] Visitas procesadas:', visitasConDatos.length);

        res.json({
            success: true,
            visitas: visitasConDatos,
            tecnico: {
                id: usuario.id,
                nombre: usuario.nombre,
                username: usuario.username
            }
        });
    } catch (error) {
        console.error('Error obteniendo visitas del técnico autenticado:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener archivos PDF de una visita técnica
app.get('/api/visitas/:id/archivos-pdf', async (req, res) => {
    try {
        const visitaId = req.params.id;
        const result = await obtenerArchivosPdfVisita(visitaId);
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo archivos PDF de la visita:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ===== ENDPOINTS PARA CLIENTES EXTERNOS (SOLUCNET.COM) =====

// API para obtener configuración de BD externa
app.get('/api/config-bd-externa', requireAuth, async (req, res) => {
    try {
        const result = await obtenerConfigBDExterna();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo configuración BD externa:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para actualizar configuración de BD externa
app.put('/api/config-bd-externa/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const datos = req.body;
        const result = await actualizarConfigBDExterna(id, datos);
        res.json(result);
    } catch (error) {
        console.error('Error actualizando configuración BD externa:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para probar conexión a BD externa
app.post('/api/probar-conexion-bd-externa', requireAuth, async (req, res) => {
    try {
        const datos = req.body;
        const result = await probarConexionBDExterna(datos);
        res.json(result);
    } catch (error) {
        console.error('Error probando conexión BD externa:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para sincronizar clientes desde BD externa
app.post('/api/sincronizar-clientes-externos', requireAuth, async (req, res) => {
    try {
        const result = await sincronizarClientesExternos();
        res.json(result);
    } catch (error) {
        console.error('Error sincronizando clientes externos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener clientes externos
app.get('/api/clientes-externos', requireAuth, async (req, res) => {
    try {
        const filtros = {
            estado: req.query.estado,
            bd_origen: req.query.bd_origen,
            busqueda: req.query.busqueda
        };
        const result = await obtenerClientesExternos(filtros);
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo clientes externos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener estadísticas de clientes externos
app.get('/api/estadisticas-clientes-externos', requireAuth, async (req, res) => {
    try {
        const result = await obtenerEstadisticasClientesExternos();
        res.json(result);
    } catch (error) {
        console.error('Error obteniendo estadísticas de clientes externos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para registrar instalación en base de datos
app.post('/api/registrar-instalacion', requireAuth, async (req, res) => {
    try {
        const { clienteId, baseDatos, notas } = req.body;

        console.log('📥 Datos recibidos en /api/registrar-instalacion:');
        console.log('   - clienteId:', clienteId);
        console.log('   - baseDatos:', baseDatos);
        console.log('   - notas:', notas);

        if (!clienteId || !baseDatos) {
            return res.status(400).json({
                success: false,
                message: 'ID de cliente y base de datos son requeridos'
            });
        }

        const result = await registrarInstalacion(clienteId, baseDatos, notas || '');
        res.json(result);
    } catch (error) {
        console.error('Error registrando instalación:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para agendar instalación (crear visita sin asignar con zona en observaciones)
app.post('/api/agendar-instalacion', requireAuth, uploadPdfVisitas.single('pdf_instalacion'), async (req, res) => {
    try {
        const { clienteId, zona } = req.body;

        if (!clienteId || !zona) {
            return res.status(400).json({
                success: false,
                message: 'ID de cliente y zona son requeridos'
            });
        }

        // Validar que se haya enviado el PDF
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Es obligatorio adjuntar un PDF de instalación'
            });
        }

        // Obtener datos del cliente desde la tabla clientes_externos
        const conexionSistema = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexionSistema.query('USE solucnet_auth_system');

        const [clientes] = await conexionSistema.execute(
            'SELECT * FROM clientes_externos WHERE id = ? AND bd_origen = "solucnet.com"',
            [clienteId]
        );

        if (clientes.length === 0) {
            await conexionSistema.end();
            return res.status(404).json({
                success: false,
                message: 'Cliente no encontrado'
            });
        }

        const cliente = clientes[0];

        // Verificar si ya existe una visita de instalación programada para este cliente
        const [visitasExistentes] = await conexionSistema.execute(`
            SELECT id FROM visitas_tecnicas
            WHERE cliente_id = ?
            AND bd_origen = 'solucnet.com'
            AND motivo_visita = 'Instalación'
            AND estado IN ('programada', 'asignada', 'en_progreso')
            LIMIT 1
        `, [cliente.id]);

        if (visitasExistentes.length > 0) {
            await conexionSistema.end();
            return res.status(400).json({
                success: false,
                message: `❌ La visita de instalación ya fue agendada para ${cliente.nombre || cliente.movil || 'este cliente'}. No se puede agendar nuevamente.`
            });
        }

        // Crear visita técnica sin asignar con la zona en localidad y observaciones
        const observaciones = `Instalación agendada desde solucnet.com`;

        const [resultado] = await conexionSistema.execute(`
            INSERT INTO visitas_tecnicas (
                cliente_id, cliente_nombre, cliente_cedula, cliente_telefono,
                cliente_movil, cliente_direccion, bd_origen, motivo_visita,
                estado, fecha_programada, notas_admin, localidad, creado_por
            ) VALUES (?, ?, ?, ?, ?, ?, 'solucnet.com', 'Instalación', 'programada', CURDATE(), ?, ?, 6)
        `, [
            cliente.id,
            (cliente.nombre || cliente.movil || 'Cliente sin nombre').toUpperCase(),
            cliente.cedula || '',
            cliente.telefono || '',
            cliente.movil || '',
            cliente.direccion || '',
            observaciones,
            zona
        ]);

        const visitaId = resultado.insertId;

        // Guardar el archivo PDF en la base de datos
        await conexionSistema.execute(`
            INSERT INTO archivos_pdf_visitas (visita_id, nombre_original, nombre_archivo, ruta_archivo, tamaño)
            VALUES (?, ?, ?, ?, ?)
        `, [visitaId, req.file.originalname, req.file.filename, req.file.path, req.file.size]);

        await conexionSistema.end();

        res.json({
            success: true,
            message: `Instalación agendada exitosamente en zona ${zona}`,
            visitaId: visitaId
        });

    } catch (error) {
        console.error('Error agendando instalación:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para crear reporte de visita completada
app.post('/api/reportes-visitas', async (req, res) => {
    try {
        const datosReporte = req.body;
        console.log('📝 [REPORTE] Recibiendo petición para guardar reporte de visita', datosReporte.visita_id);

        // Validar campos requeridos
        if (!datosReporte.visita_id || !datosReporte.tecnico_id) {
            console.log('❌ [REPORTE] Faltan campos requeridos');
            return res.status(400).json({
                success: false,
                message: 'ID de visita y técnico son requeridos'
            });
        }

        console.log('📦 [REPORTE] Iniciando respaldo en archivo...');
        // 1. PRIMER BACKUP: Guardar inmediatamente en archivo JSON antes de cualquier operación
        const backupId = await guardarBackupReporte(datosReporte);
        console.log('✅ [REPORTE] Backup completado:', backupId);
        console.log(`🔒 Reporte respaldado inmediatamente: ${backupId}`);

        // 2. OPERACIÓN PRINCIPAL: Crear reporte en base de datos con reintentos
        const result = await ejecutarConReintentos(
            () => crearReporteVisita(datosReporte),
            3,
            `Crear reporte en BD para visita ${datosReporte.visita_id}`
        );

        if (result.success) {
            // 3. ACTUALIZAR ESTADO EN MEMORIA
            if (visitasEnMemoria[datosReporte.visita_id]) {
                visitasEnMemoria[datosReporte.visita_id].estado = 'completada';
                visitasEnMemoria[datosReporte.visita_id].fechaCompletada = new Date();
                visitasEnMemoria[datosReporte.visita_id].reporte = datosReporte;
                visitasEnMemoria[datosReporte.visita_id].backupId = backupId;
            }

            // 4. BACKUP ESTADO DE VISITAS
            await guardarBackupVisitas();

            console.log(`✅ Visita ${datosReporte.visita_id} completada - BD: ✅ Memoria: ✅ Backup: ✅`);

            res.json({
                success: true,
                message: 'Reporte creado exitosamente',
                reporteId: result.reporteId,
                backupId: backupId
            });
        } else {
            // Si falló la BD, al menos tenemos el backup
            console.error(`🚨 FALLO BD para visita ${datosReporte.visita_id} - Backup disponible: ${backupId}`);

            // Marcar en memoria como completada aunque falló la BD
            if (visitasEnMemoria[datosReporte.visita_id]) {
                visitasEnMemoria[datosReporte.visita_id].estado = 'completada';
                visitasEnMemoria[datosReporte.visita_id].fechaCompletada = new Date();
                visitasEnMemoria[datosReporte.visita_id].reporte = datosReporte;
                visitasEnMemoria[datosReporte.visita_id].backupId = backupId;
                visitasEnMemoria[datosReporte.visita_id].bdFailed = true; // Marcar para reintento posterior
            }

            await guardarBackupVisitas();

            // Devolver éxito porque tenemos backup (no perdemos datos)
            res.json({
                success: true,
                message: 'Reporte guardado en backup (reintento de BD pendiente)',
                reporteId: backupId,
                backupId: backupId,
                warning: 'Base de datos temporalmente no disponible, datos respaldados'
            });
        }
    } catch (error) {
        console.error('Error creando reporte:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para agregar cajas NAP
app.post('/api/cajas-nap', requireAuth, async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const usuarioActual = await verificarToken(token);

        // Verificar que sea técnico con permiso
        if (!usuarioActual || usuarioActual.rol !== 'tecnico' || !usuarioActual.puede_agregar_naps) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para agregar cajas NAP'
            });
        }

        const { zona, puertos, ubicacion, detalles, latitud, longitud, precision } = req.body;

        // Validaciones
        if (!zona || !puertos || !latitud || !longitud) {
            return res.status(400).json({
                success: false,
                message: 'Todos los campos obligatorios son requeridos'
            });
        }

        // Validar precisión GPS (se requiere 9m o menos)
        if (precision > 9) {
            return res.status(400).json({
                success: false,
                message: `Precisión GPS insuficiente: ±${precision}m. Se requiere ±9m o mejor.`
            });
        }

        // Log de precisión GPS
        console.log(`✅ [NAP] Precisión GPS aceptable: ±${precision}m`);
        if (precision > 5) {
            console.log(`⚠️ [NAP] Precisión GPS aceptable pero no óptima: ±${precision}m`);
        }

        // Conectar a la base de datos correspondiente
        const conexion = await mysql.createConnection({
            host: zona,
            user: 'root',
            password: 'Y9T1Q6P39YI6TJ2',
            database: 'Mikrowisp6'
        });

        // Generar consecutivo automático
        const [maxId] = await conexion.execute('SELECT MAX(id) as max_id FROM nap');
        const nuevoId = (maxId[0].max_id || 0) + 1;

        // Generar descripción automática basada en la zona y consecutivo
        const zonaNombres = {
            '192.168.99.50': 'Reposo',
            '192.168.99.11': 'Churido',
            '192.168.99.2': 'Rio_Grande'
        };
        const nombreZona = zonaNombres[zona] || 'NAP';
        const consecutivo = String(nuevoId).padStart(3, '0'); // Formatear con 3 dígitos: 001, 002, etc.
        const descripcion = `Caja_${nombreZona}_${consecutivo}`;

        // Formatear coordenadas
        const coordenadas = `${latitud},${longitud}`;

        // Insertar nueva caja NAP
        await conexion.execute(
            `INSERT INTO nap (id, descripcion, puertos, coordenadas, ubicacion, puertoinicio, detalles)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [nuevoId, descripcion, puertos, coordenadas, ubicacion || '', detalles || '']
        );

        await conexion.end();

        console.log(`✅ Caja NAP creada: ID=${nuevoId}, Zona=${zona}, Desc=${descripcion}`);

        res.json({
            success: true,
            message: 'Caja NAP creada exitosamente',
            napId: nuevoId,
            zona: zona
        });

    } catch (error) {
        console.error('❌ Error creando caja NAP:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ==============================================================================
// RUTAS API PARA ASIGNACIÓN DE EQUIPOS DESDE VISITAS
// ==============================================================================

// API para asignar equipo a cliente desde visita técnica
app.post('/api/asignar-equipo', async (req, res) => {
    try {
        const { visitaId, serialEquipo, costoEquipo, tipoEquipo } = req.body;

        console.log(`📦 [API ASIGNAR EQUIPO] Recibida petición:`, { visitaId, serialEquipo, costoEquipo, tipoEquipo });

        if (!visitaId || !serialEquipo) {
            return res.status(400).json({
                success: false,
                message: 'Se requieren visitaId y serialEquipo'
            });
        }

        // Asignar equipo
        const resultado = await asignarEquipoDesdeVisita(
            visitaId,
            serialEquipo,
            costoEquipo || 180000,
            tipoEquipo || 'Onu CData'
        );

        if (resultado.success) {
            console.log(`✅ [API ASIGNAR EQUIPO] Equipo asignado exitosamente`);
            res.json(resultado);
        } else {
            console.error(`❌ [API ASIGNAR EQUIPO] Error:`, resultado.message);
            res.status(400).json(resultado);
        }

    } catch (error) {
        console.error(`❌ [API ASIGNAR EQUIPO] Error interno:`, error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para verificar si un serial de equipo ya existe
app.post('/api/verificar-serial', async (req, res) => {
    try {
        const { serialEquipo, visitaId } = req.body;

        console.log(`🔍 [API VERIFICAR SERIAL] Verificando serial: ${serialEquipo}, visitaId: ${visitaId || 'no proporcionado'}`);

        if (!serialEquipo) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere serialEquipo'
            });
        }

        const resultado = await verificarSerialEquipo(serialEquipo, visitaId);

        console.log(`✅ [API VERIFICAR SERIAL] Resultado:`, resultado);
        res.json(resultado);

    } catch (error) {
        console.error(`❌ [API VERIFICAR SERIAL] Error:`, error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// ==============================================================================

// API para enviar notificaciones masivas de visitas por WhatsApp
app.post('/api/enviar-notificaciones-visitas', async (req, res) => {
    try {
        const { visitas, mensajePersonalizado } = req.body;

        console.log(`📋 [NOTIFICACIONES] Recibidas ${visitas?.length || 0} visitas para notificar`);
        console.log(`📝 [NOTIFICACIONES] Tipo de mensaje: ${mensajePersonalizado ? 'PERSONALIZADO' : 'PREDETERMINADO'}`);
        console.log(`🔍 [NOTIFICACIONES] Datos recibidos:`, JSON.stringify(visitas, null, 2));
        console.log(`📱 [NOTIFICACIONES] Estado WhatsApp - whatsappListo: ${whatsappListo}, client: ${client ? 'disponible' : 'null'}`);

        if (!visitas || !Array.isArray(visitas) || visitas.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Se requiere al menos una visita para enviar notificaciones'
            });
        }

        // Verificar que WhatsApp esté listo
        if (!whatsappListo || !client) {
            console.error(`❌ [NOTIFICACIONES] WhatsApp no está listo - whatsappListo: ${whatsappListo}, client: ${client ? 'disponible' : 'null'}`);
            return res.status(503).json({
                success: false,
                message: 'WhatsApp no está listo. Por favor, intenta de nuevo en unos momentos.',
                enviados: 0,
                errores: visitas.length,
                total: visitas.length
            });
        }

        let enviados = 0;
        let errores = 0;
        const resultados = [];

        // Mensaje predefinido para las visitas técnicas
        const mensajePredeterminado = (nombre, fecha) => `Hola ${nombre},

Le informamos que el día ${fecha} será visitado por nuestro equipo técnico de *SOLUCNET SAS*.

🔧 *VISITA TÉCNICA PROGRAMADA*

Agradecemos contar con su disponibilidad para recibir la visita técnica.

⚠️ *IMPORTANTE:* No podemos indicarle una hora precisa ya que el tiempo de los técnicos es muy rotativo por la demora en las visitas anteriores y eventos climáticos.

Nuestro técnico se comunicará con usted cuando esté cerca de su ubicación.

Gracias por su comprensión.
*SOLUCNET SAS*`;

        // Función para generar el mensaje (personalizado o predeterminado)
        const mensajeTemplate = (nombre, fecha) => {
            if (mensajePersonalizado) {
                // Reemplazar variables {NOMBRE} y {FECHA} en el mensaje personalizado
                return mensajePersonalizado
                    .replace(/{NOMBRE}/gi, nombre)
                    .replace(/{FECHA}/gi, fecha);
            } else {
                return mensajePredeterminado(nombre, fecha);
            }
        };

        // Enviar notificación a cada cliente
        for (const visita of visitas) {
            try {
                console.log(`🔍 [NOTIFICACIÓN] Procesando visita:`, {
                    id: visita.id,
                    cliente_nombre: visita.cliente_nombre,
                    cliente_telefono: visita.cliente_telefono,
                    cliente_cedula: visita.cliente_cedula,
                    fecha_programada: visita.fecha_programada
                });

                // Obtener teléfonos priorizando móvil sobre teléfono fijo
                let telefonoCliente = visita.cliente_movil || visita.cliente_telefono || visita.telefono;

                // Log detallado de qué campo se está usando
                let campoUsado = '';
                if (visita.cliente_movil) {
                    campoUsado = 'cliente_movil';
                } else if (visita.cliente_telefono) {
                    campoUsado = 'cliente_telefono';
                } else if (visita.telefono) {
                    campoUsado = 'telefono';
                }

                console.log(`📱 [NOTIFICACIÓN] ${visita.cliente_nombre} - Campo usado: "${campoUsado}" = "${telefonoCliente}"`);

                if (!telefonoCliente || telefonoCliente === 'Sin teléfono' || telefonoCliente === 'N/A') {
                    console.warn(`⚠️ [NOTIFICACIÓN] ${visita.cliente_nombre} no tiene número de teléfono válido:`, telefonoCliente);
                    resultados.push({
                        cliente: visita.cliente_nombre,
                        estado: 'error',
                        mensaje: 'Sin número de teléfono válido'
                    });
                    errores++;
                    continue;
                }

                // Dividir números múltiples separados por comas
                const numerosMultiples = telefonoCliente.split(',').map(num => num.trim()).filter(num => num.length > 0);
                console.log(`📞 [NOTIFICACIÓN] ${visita.cliente_nombre} - Números detectados: [${numerosMultiples.join(', ')}]`);

                // Formatear fecha
                const fecha = new Date(visita.fecha_programada).toLocaleDateString('es-ES', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });

                const mensaje = mensajeTemplate(visita.cliente_nombre, fecha);

                // Procesar cada número por separado
                for (const numeroOriginal of numerosMultiples) {
                    // Limpiar número de teléfono (quitar espacios, guiones, etc.)
                    let numeroTelefono = numeroOriginal.toString().replace(/\D/g, '');

                    console.log(`📱 [NOTIFICACIÓN] Número original: "${numeroOriginal}" -> limpio: "${numeroTelefono}"`);

                    // Si el número no tiene código de país, agregar +57 para Colombia
                    if (!numeroTelefono.startsWith('57') && numeroTelefono.length === 10) {
                        numeroTelefono = '57' + numeroTelefono;
                    }

                    // Validar que el número tenga longitud correcta
                    if (numeroTelefono.length < 10 || numeroTelefono.length > 15) {
                        console.warn(`⚠️ [NOTIFICACIÓN] Número inválido: "${numeroTelefono}" (longitud: ${numeroTelefono.length})`);
                        errores++;
                        resultados.push({
                            cliente: visita.cliente_nombre,
                            telefono: numeroTelefono,
                            estado: 'error',
                            mensaje: `Número inválido: ${numeroOriginal}`
                        });
                        continue;
                    }

                    // Convertir número de teléfono al formato de chatId para WhatsApp
                    const chatId = numeroTelefono + '@c.us';

                    // Enviar mensaje usando la conexión local de WhatsApp
                    console.log(`📤 [NOTIFICACIÓN] Enviando a ${visita.cliente_nombre} (${numeroTelefono}), chatId: ${chatId}`);

                    const resultado = await enviarMensaje(chatId, mensaje);

                    console.log(`📩 [NOTIFICACIÓN] Resultado del envío a ${visita.cliente_nombre}: ${resultado ? 'ÉXITO' : 'FALLO'}`);

                    if (resultado) {
                        enviados++;
                        resultados.push({
                            cliente: visita.cliente_nombre,
                            telefono: numeroTelefono,
                            estado: 'enviado',
                            mensaje: 'Notificación enviada exitosamente por conexión local'
                        });
                        console.log(`✅ Notificación enviada a ${visita.cliente_nombre} (${numeroTelefono}) por conexión local`);

                        // Marcar cliente como notificado
                        const conexionUpdate = await mysql.createConnection({
                            host: process.env.DB_SYSTEM_HOST,
                            user: process.env.DB_SYSTEM_USER,
                            password: process.env.DB_SYSTEM_PASSWORD,
                            database: process.env.DB_SYSTEM_DATABASE
                        });
                        await conexionUpdate.query('USE solucnet_auth_system');
                        await conexionUpdate.execute(
                            'UPDATE visitas_tecnicas SET cliente_notificado = TRUE WHERE id = ?',
                            [visita.id]
                        );
                        await conexionUpdate.end();
                        console.log(`✅ Cliente ${visita.cliente_nombre} marcado como notificado`);

                        // Pausa ALEATORIA entre mensajes (1-3 segundos) optimizada para respuestas rápidas
                        const delayAleatorio = 1000 + Math.random() * 2000; // 1-3 segundos
                        console.log(`⏱️ [PAUSA ALEATORIA] Esperando ${Math.round(delayAleatorio/1000)} segundos antes del siguiente envío...`);
                        await new Promise(resolve => setTimeout(resolve, delayAleatorio));
                        console.log(`⏱️ [PAUSA] Pausa completada, continuando con el siguiente envío`);
                    } else {
                        errores++;
                        resultados.push({
                            cliente: visita.cliente_nombre,
                            telefono: numeroTelefono,
                            estado: 'error',
                            mensaje: 'Error enviando notificación'
                        });
                        console.error(`❌ Error enviando notificación a ${visita.cliente_nombre} (${numeroTelefono})`);
                    }
                }

            } catch (error) {
                errores++;
                resultados.push({
                    cliente: visita.cliente_nombre,
                    estado: 'error',
                    mensaje: error.message
                });
                console.error(`❌ Error enviando a ${visita.cliente_nombre}:`, error.message);
            }
        }

        console.log(`📊 [NOTIFICACIONES] RESUMEN FINAL - Total: ${visitas.length}, Enviados: ${enviados}, Errores: ${errores}`);
        console.log(`📋 [NOTIFICACIONES] Resultados detallados:`, JSON.stringify(resultados, null, 2));

        res.json({
            success: true,
            enviados,
            errores,
            total: visitas.length,
            resultados,
            message: `Se enviaron ${enviados} notificaciones de ${visitas.length} intentos`
        });

    } catch (error) {
        console.error('Error en envío masivo de notificaciones:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Función para validar que un reporte sea básicamente válido (muy permisiva)
function validarReporte(reporte) {
    if (!reporte) return false;

    // Solo verificar que exista el reporte
    return true; // Muy permisivo, filtrado real en frontend
}

// API para obtener reportes completados
app.get('/api/reportes-completados', async (req, res) => {
    try {
        let reportesFinales = [];

        // Intentar obtener de la base de datos primero
        try {
            const result = await ejecutarConReintentos(
                () => obtenerReportesCompletados(),
                2,
                'Obtener reportes completados de BD'
            );

            if (result.success) {
                reportesFinales = result.reportes || [];
                console.log(`📊 Cargados ${reportesFinales.length} reportes desde BD`);

                // SI TENEMOS REPORTES DE BD, DEVOLVERLOS DIRECTAMENTE SIN MEZCLAR
                if (reportesFinales.length > 0) {
                    console.log(`✅ Devolviendo ${reportesFinales.length} reportes desde BD (sin mezclar con backup)`);
                    return res.json({
                        success: true,
                        reportes: reportesFinales,
                        metadata: {
                            total: reportesFinales.length,
                            desde_bd: reportesFinales.length,
                            desde_backup: 0,
                            desde_memoria: 0
                        }
                    });
                }
            }
        } catch (error) {
            console.warn('⚠️ BD no disponible, usando backup para reportes');
        }

        // Agregar reportes desde backup que no estén en BD
        const reportesBackup = await cargarBackupReportes();
        const reportesMemoria = Object.keys(visitasEnMemoria)
            .filter(visitaId => visitasEnMemoria[visitaId].estado === 'completada')
            .map(visitaId => {
                const visita = visitasEnMemoria[visitaId];
                return {
                    ...visita.reporte,
                    visita_id: visitaId,
                    fecha_reporte: visita.fechaCompletada,
                    backup_id: visita.backupId,
                    es_backup: visita.bdFailed || false
                };
            });

        // Combinar reportes únicos (evitar duplicados)
        const reportesMap = new Map();

        // Agregar reportes de BD (normalizar visita_id a string para comparación)
        reportesFinales.forEach(reporte => {
            const visitaIdKey = String(reporte.visita_id);
            reportesMap.set(visitaIdKey, { ...reporte, fuente: 'bd' });
        });

        // Enriquecer reportes de BD con datos de backup (coordenadas, etc)
        let reportesEnriquecidos = 0;
        reportesBackup.forEach(reporte => {
            const visitaIdKey = String(reporte.visita_id);
            if (reportesMap.has(visitaIdKey)) {
                // Ya existe en BD, enriquecer con datos del backup (especialmente coordenadas)
                const reporteBD = reportesMap.get(visitaIdKey);
                const reporteEnriquecido = {
                    ...reporteBD,
                    // Usar coordenadas del backup si la BD no las tiene
                    latitud: (reporteBD.latitud !== null && reporteBD.latitud !== undefined) ? reporteBD.latitud : reporte.latitud,
                    longitud: (reporteBD.longitud !== null && reporteBD.longitud !== undefined) ? reporteBD.longitud : reporte.longitud,
                    precision_gps: (reporteBD.precision_gps !== null && reporteBD.precision_gps !== undefined) ? reporteBD.precision_gps : reporte.precision_gps
                };

                // Debug: Log cuando se enriquece un reporte
                if (reporte.latitud && !reporteBD.latitud) {
                    console.log(`🔄 Enriqueciendo visita ${reporte.visita_id} con coordenadas del backup: lat=${reporte.latitud}, lon=${reporte.longitud}`);
                    reportesEnriquecidos++;
                }

                reportesMap.set(visitaIdKey, reporteEnriquecido);
            } else {
                // No está en BD, agregar del backup
                const esValido = validarReporte(reporte);
                if (esValido) {
                    reportesMap.set(visitaIdKey, { ...reporte, fuente: 'backup', es_backup: true });
                }
            }
        });

        // Agregar reportes de memoria que no estén en BD ni backup (con filtros)
        reportesMemoria.forEach(reporte => {
            const visitaIdKey = String(reporte.visita_id);
            if (!reportesMap.has(visitaIdKey)) {
                // Aplicar filtros básicos antes de agregar
                const esValido = validarReporte(reporte);
                if (esValido) {
                    reportesMap.set(visitaIdKey, { ...reporte, fuente: 'memoria' });
                }
            }
        });

        // Devolver todos los reportes sin filtros excesivos (filtrado en frontend)
        const reportesCombinados = Array.from(reportesMap.values())
            .sort((a, b) => new Date(b.fecha_reporte || b.backup_timestamp) - new Date(a.fecha_reporte || a.backup_timestamp));

        console.log(`📋 Total reportes devueltos: ${reportesCombinados.length} (BD: ${reportesFinales.length}, Backup: ${reportesBackup.length}, Memoria: ${reportesMemoria.length}, Enriquecidos: ${reportesEnriquecidos})`);

        res.json({
            success: true,
            reportes: reportesCombinados,
            metadata: {
                total: reportesCombinados.length,
                desde_bd: reportesFinales.length,
                desde_backup: reportesBackup.length,
                desde_memoria: reportesMemoria.length
            }
        });
    } catch (error) {
        console.error('Error obteniendo reportes:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Variable en memoria para almacenar el estado de las visitas
let visitasEnMemoria = {};

// Sistema de backup para reportes críticos
const fsPromises = require('fs').promises;

const BACKUP_DIR = path.join(__dirname, 'backups');
const REPORTES_BACKUP_FILE = path.join(BACKUP_DIR, 'reportes_backup.json');
const VISITAS_BACKUP_FILE = path.join(BACKUP_DIR, 'visitas_backup.json');

// Crear directorio de backup si no existe
async function inicializarBackupSystem() {
    try {
        await fsPromises.mkdir(BACKUP_DIR, { recursive: true });
        console.log('📁 Sistema de backup inicializado');

        // Cargar datos de backup al iniciar
        await cargarBackupReportes();
        await cargarBackupVisitas();
    } catch (error) {
        console.error('❌ Error inicializando sistema de backup:', error.message);
    }
}

// Guardar reporte en backup JSON
async function guardarBackupReporte(reporte) {
    try {
        let reportesBackup = [];

        // Leer reportes existentes
        try {
            const data = await fsPromises.readFile(REPORTES_BACKUP_FILE, 'utf8');
            reportesBackup = JSON.parse(data);
        } catch (error) {
            // Archivo no existe, usar array vacío
        }

        // Agregar nuevo reporte con timestamp
        const reporteConBackup = {
            ...reporte,
            backup_timestamp: new Date().toISOString(),
            backup_id: `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        reportesBackup.push(reporteConBackup);

        // Mantener solo los últimos 1000 reportes para evitar archivos muy grandes
        if (reportesBackup.length > 1000) {
            reportesBackup = reportesBackup.slice(-1000);
        }

        // Guardar en archivo
        await fsPromises.writeFile(REPORTES_BACKUP_FILE, JSON.stringify(reportesBackup, null, 2));
        console.log(`💾 Reporte respaldado: ${reporteConBackup.backup_id}`);

        return reporteConBackup.backup_id;
    } catch (error) {
        console.error('❌ Error guardando backup reporte:', error.message);
        return null;
    }
}

// Guardar estado de visitas en backup
async function guardarBackupVisitas() {
    try {
        const visitasBackup = {
            timestamp: new Date().toISOString(),
            visitas: visitasEnMemoria
        };

        await fsPromises.writeFile(VISITAS_BACKUP_FILE, JSON.stringify(visitasBackup, null, 2));
        console.log('💾 Estado de visitas respaldado');
    } catch (error) {
        console.error('❌ Error guardando backup visitas:', error.message);
    }
}

// Cargar reportes desde backup
async function cargarBackupReportes() {
    try {
        const data = await fsPromises.readFile(REPORTES_BACKUP_FILE, 'utf8');
        const reportesBackup = JSON.parse(data);
        console.log(`📥 Cargados ${reportesBackup.length} reportes desde backup`);
        return reportesBackup;
    } catch (error) {
        console.log('📄 No se encontró backup de reportes (inicio limpio)');
        return [];
    }
}

// Cargar estado de visitas desde backup
async function cargarBackupVisitas() {
    try {
        const data = await fsPromises.readFile(VISITAS_BACKUP_FILE, 'utf8');
        const visitasBackup = JSON.parse(data);

        // Restaurar solo visitas del día actual
        const hoy = new Date();
        const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

        Object.keys(visitasBackup.visitas || {}).forEach(visitaId => {
            const visita = visitasBackup.visitas[visitaId];
            if (visita.fechaInicio && new Date(visita.fechaInicio) >= inicioHoy) {
                visitasEnMemoria[visitaId] = visita;
            }
        });

        console.log(`📥 Restauradas ${Object.keys(visitasEnMemoria).length} visitas desde backup`);
    } catch (error) {
        console.log('📄 No se encontró backup de visitas (inicio limpio)');
    }
}

// Función para reintentar operaciones críticas de base de datos
async function ejecutarConReintentos(operacion, maxIntentos = 3, descripcion = 'Operación') {
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            const resultado = await operacion();
            if (intento > 1) {
                console.log(`✅ ${descripcion} exitosa en intento ${intento}`);
            }
            return resultado;
        } catch (error) {
            console.error(`❌ ${descripcion} falló en intento ${intento}:`, error.message);

            if (intento === maxIntentos) {
                console.error(`🚨 ${descripcion} falló después de ${maxIntentos} intentos`);
                throw error;
            }

            // Esperar antes del siguiente intento (backoff exponencial)
            const tiempoEspera = Math.pow(2, intento - 1) * 1000; // 1s, 2s, 4s...
            await new Promise(resolve => setTimeout(resolve, tiempoEspera));
        }
    }
}

// Función para limpiar visitas del día anterior
function limpiarVisitasAnteriores() {
    const ahora = new Date();
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

    Object.keys(visitasEnMemoria).forEach(visitaId => {
        const fechaInicio = visitasEnMemoria[visitaId].fechaInicio;
        if (fechaInicio && fechaInicio < inicioHoy) {
            delete visitasEnMemoria[visitaId];
        }
    });

    console.log('🧹 Visitas del día anterior limpiadas');
}

// Sistema de recuperación automática para reportes que fallaron
async function sistemaRecuperacionReportes() {
    try {
        let recuperados = 0;

        // Buscar visitas completadas que fallaron en BD
        for (const visitaId of Object.keys(visitasEnMemoria)) {
            const visita = visitasEnMemoria[visitaId];

            if (visita.estado === 'completada' && visita.bdFailed && visita.reporte && visita.backupId) {
                console.log(`🔄 Intentando recuperar reporte para visita ${visitaId}...`);

                try {
                    // Reintentar insertar en BD
                    const result = await ejecutarConReintentos(
                        () => crearReporteVisita(visita.reporte),
                        2, // Solo 2 intentos en recuperación
                        `Recuperar reporte para visita ${visitaId}`
                    );

                    if (result.success) {
                        // Marcar como exitosamente recuperado
                        delete visita.bdFailed;
                        visita.bdRecuperado = true;
                        visita.fechaRecuperacion = new Date();

                        await guardarBackupVisitas();
                        recuperados++;

                        console.log(`✅ Reporte recuperado exitosamente: visita ${visitaId}`);
                    }
                } catch (error) {
                    console.log(`⏳ Reporte para visita ${visitaId} aún no se puede recuperar`);
                }
            }
        }

        if (recuperados > 0) {
            console.log(`🎯 Sistema de recuperación: ${recuperados} reportes recuperados`);
        }

    } catch (error) {
        console.error('❌ Error en sistema de recuperación:', error.message);
    }
}

// Ejecutar recuperación cada 5 minutos
setInterval(sistemaRecuperacionReportes, 5 * 60 * 1000);

// Backup automático de visitas cada 10 minutos
setInterval(async () => {
    if (Object.keys(visitasEnMemoria).length > 0) {
        await guardarBackupVisitas();
        console.log('💾 Backup automático de visitas realizado');
    }
}, 10 * 60 * 1000);

// Limpiar visitas cada medianoche
setInterval(() => {
    const ahora = new Date();
    if (ahora.getHours() === 0 && ahora.getMinutes() === 0) {
        limpiarVisitasAnteriores();
    }
}, 60000); // Verificar cada minuto

// API para iniciar visita técnica (cambiar estado a en_progreso)
app.put('/api/visitas-tecnicas/:id/iniciar', async (req, res) => {
    try {
        const visitaId = req.params.id;

        // Marcar visita como iniciada en memoria
        if (!visitasEnMemoria[visitaId]) {
            visitasEnMemoria[visitaId] = {};
        }
        visitasEnMemoria[visitaId].estado = 'en_progreso';
        visitasEnMemoria[visitaId].fechaInicio = new Date();

        console.log(`✅ Visita ${visitaId} iniciada (en memoria)`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error iniciando visita:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para notificar al cliente de la llegada del técnico
app.post('/api/notificar-llegada-cliente', async (req, res) => {
    try {
        const { visitaId, clienteNombre, clienteMovil } = req.body;

        if (!clienteMovil || clienteMovil.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Número móvil no válido'
            });
        }

        // Nota: Removida verificación de whatsappListo para usar mismo método que admin

        console.log(`🔍 [DEBUG] Número original recibido: "${clienteMovil}"`);

        // Dividir números múltiples separados por comas
        const numerosMultiples = clienteMovil.split(',').map(num => num.trim()).filter(num => num.length > 0);
        console.log(`🔍 [DEBUG] Números separados: ${JSON.stringify(numerosMultiples)}`);

        let mensajesEnviados = 0;
        let totalNumeros = numerosMultiples.length;

        const mensaje = `🔧 *SOLUCNET - AVISO TÉCNICO*\n\nEstimado/a ${clienteNombre},\n\nLe informamos que nuestros técnicos se encuentran en su hogar y no se han podido comunicar con usted.\n\nPor favor, esté pendiente al teléfono ya que dentro de 10 minutos, si no logramos establecer contacto, la visita técnica será cancelada.\n\n¡Gracias por su comprensión!`;

        // Procesar cada número por separado
        for (let i = 0; i < numerosMultiples.length; i++) {
            const numeroOriginal = numerosMultiples[i];

            // Formatear número para WhatsApp (agregar código de país si no lo tiene)
            let numeroFormateado = numeroOriginal.toString().trim();

            console.log(`🔍 [DEBUG] Procesando número ${i+1}/${totalNumeros}: "${numeroOriginal}"`);

            // Extraer solo los números del campo (remover prefijos como "Móvil:", "Celular:", etc.)
            const soloNumeros = numeroFormateado.match(/\d+/g);
            if (!soloNumeros || soloNumeros.length === 0) {
                console.log(`⚠️ [WARNING] Número ${i+1} no válido - no contiene dígitos: "${numeroOriginal}"`);
                continue;
            }

            // Tomar el último grupo de números (el más largo, que debería ser el teléfono)
            numeroFormateado = soloNumeros[soloNumeros.length - 1];
            console.log(`🔍 [DEBUG] Número extraído: "${numeroFormateado}"`);

            // Si no empieza con código de país, agregar 57 para Colombia
            if (!numeroFormateado.startsWith('57') && numeroFormateado.length >= 10) {
                numeroFormateado = '57' + numeroFormateado;
            }

            // Agregar formato de WhatsApp
            const chatId = numeroFormateado + '@c.us';
            console.log(`🔍 [DEBUG] ChatId final: "${chatId}"`);

            console.log(`📱 [NOTIFICAR LLEGADA] Enviando a ${clienteNombre} (${i+1}/${totalNumeros}) - Móvil: ${numeroOriginal} -> ${chatId}`);

            // Enviar mensaje por WhatsApp
            const mensajeEnviado = await enviarMensaje(chatId, mensaje, null, true);

            if (mensajeEnviado) {
                console.log(`✅ [NOTIFICAR LLEGADA] Mensaje enviado exitosamente a ${clienteNombre} (${i+1}/${totalNumeros}) - Visita: ${visitaId}`);
                mensajesEnviados++;
            } else {
                console.log(`❌ [NOTIFICAR LLEGADA] Error enviando a ${clienteNombre} (${chatId})`);
            }

            // Pausa ALEATORIA entre mensajes (1-3 segundos) - excepto el último
            if (i < numerosMultiples.length - 1) {
                const delayAleatorio = 1000 + Math.random() * 2000; // 1-3 segundos
                console.log(`⏳ [NOTIFICAR LLEGADA] Esperando ${Math.round(delayAleatorio/1000)} segundos antes del siguiente mensaje...`);
                await new Promise(resolve => setTimeout(resolve, delayAleatorio));
            }
        }

        if (mensajesEnviados > 0) {
            res.json({
                success: true,
                message: `Notificación enviada exitosamente a ${mensajesEnviados} de ${totalNumeros} números`
            });
        } else {
            res.status(503).json({
                success: false,
                message: 'No se pudo enviar la notificación a ningún número válido'
            });
        }

    } catch (error) {
        console.error('Error enviando notificación de llegada:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para cancelar visita por falta de contacto
app.post('/api/cancelar-visita-sin-contacto', async (req, res) => {
    try {
        const { visitaId, clienteNombre, clienteMovil } = req.body;

        if (!clienteMovil || clienteMovil.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Número móvil no válido'
            });
        }

        // Verificar que WhatsApp esté conectado
        if (!whatsappListo) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp no está conectado. La visita se cancelará pero no se puede notificar al cliente.'
            });
        }

        // Cambiar estado de la visita a 'programada' y quitar técnico asignado
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(`
            UPDATE visitas_tecnicas
            SET estado = 'programada',
                tecnico_asignado_id = NULL,
                tecnico_asignado_nombre = NULL
            WHERE id = ?
        `, [visitaId]);

        await conexion.end();

        console.log(`🔍 [DEBUG] Número original recibido para cancelación: "${clienteMovil}"`);

        // Dividir números múltiples separados por comas
        const numerosMultiples = clienteMovil.split(',').map(num => num.trim()).filter(num => num.length > 0);
        console.log(`🔍 [DEBUG] Números separados: ${JSON.stringify(numerosMultiples)}`);

        let mensajesEnviados = 0;
        let totalNumeros = numerosMultiples.length;

        // Enviar mensaje de cancelación al cliente
        const mensaje = `🔧 *SOLUCNET - AVISO DE CANCELACIÓN*\n\nEstimado/a ${clienteNombre},\n\nLamentamos informarle que la visita técnica programada para hoy ha sido cancelada debido a que no fue posible establecer contacto.\n\nLa visita será reprogramada y nos comunicaremos con usted próximamente para coordinar una nueva fecha.\n\n¡Que tenga un feliz día!`;

        // Procesar cada número por separado
        for (let i = 0; i < numerosMultiples.length; i++) {
            const numeroOriginal = numerosMultiples[i];

            // Formatear número para WhatsApp (agregar código de país si no lo tiene)
            let numeroFormateado = numeroOriginal.toString().trim();

            console.log(`🔍 [DEBUG] Procesando número ${i+1}/${totalNumeros}: "${numeroOriginal}"`);

            // Extraer solo los números del campo (puede contener "Móvil: " o "Tel: ")
            const numerosSolo = numeroFormateado.match(/\d+/g);
            if (!numerosSolo || numerosSolo.length === 0) {
                console.log(`⚠️ [WARNING] Número ${i+1} no válido - no contiene dígitos: "${numeroOriginal}"`);
                continue;
            }

            // Tomar el número más largo (generalmente el correcto)
            numeroFormateado = numerosSolo.reduce((a, b) => a.length > b.length ? a : b);
            console.log(`🔍 [DEBUG] Número extraído: "${numeroFormateado}"`);

            // Si no empieza con código de país, agregar +57 para Colombia
            if (!numeroFormateado.startsWith('57') && numeroFormateado.length >= 10) {
                numeroFormateado = '57' + numeroFormateado;
            }

            // Agregar formato de WhatsApp
            const chatId = numeroFormateado + '@c.us';
            console.log(`🔍 [DEBUG] ChatId final: "${chatId}"`);

            console.log(`📱 [CANCELAR VISITA] Enviando cancelación a ${clienteNombre} (${i+1}/${totalNumeros}) - Móvil: ${numeroOriginal} -> ${chatId}`);

            const mensajeEnviado = await enviarMensaje(chatId, mensaje, null, true);

            if (mensajeEnviado) {
                console.log(`✅ [CANCELAR VISITA] Mensaje enviado exitosamente a ${clienteNombre} (${i+1}/${totalNumeros}) - Visita: ${visitaId}`);
                mensajesEnviados++;
            } else {
                console.log(`❌ [CANCELAR VISITA] Error enviando a ${clienteNombre} (${chatId})`);
            }

            // Pausa ALEATORIA entre mensajes (1-3 segundos) - excepto el último
            if (i < numerosMultiples.length - 1) {
                const delayAleatorio = 1000 + Math.random() * 2000; // 1-3 segundos
                console.log(`⏳ [CANCELAR VISITA] Esperando ${Math.round(delayAleatorio/1000)} segundos antes del siguiente mensaje...`);
                await new Promise(resolve => setTimeout(resolve, delayAleatorio));
            }
        }

        if (mensajesEnviados > 0) {
            console.log(`📱 Notificación de cancelación enviada a ${mensajesEnviados} números de ${clienteNombre} - Visita: ${visitaId} devuelta a no asignada`);
            res.json({
                success: true,
                message: `Visita cancelada y cliente notificado en ${mensajesEnviados} de ${totalNumeros} números`
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Visita cancelada pero error enviando mensaje a todos los números del cliente'
            });
        }

    } catch (error) {
        console.error('Error cancelando visita por falta de contacto:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para obtener QR de WhatsApp
app.get('/api/whatsapp/qr', async (req, res) => {
    try {
        if (whatsappListo) {
            return res.json({
                success: true,
                connected: true,
                message: 'WhatsApp ya está conectado'
            });
        }

        let qrString = global.currentQR;

        // Fallback: Si no hay QR global, intentar extraer de logs
        if (!qrString) {
            qrString = getLatestQRFromLogs();
        }

        if (qrString) {
            // Generar imagen QR como data URL
            const qrDataURL = await QRCode.toDataURL(qrString, {
                type: 'image/png',
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                },
                errorCorrectionLevel: 'M'
            });

            return res.json({
                success: true,
                qr: qrDataURL,
                source: global.currentQR ? 'global' : 'logs'
            });
        } else {
            return res.json({
                success: false,
                message: 'QR no disponible en este momento. Espere unos segundos e intente nuevamente.',
                clienteIniciando: clienteIniciando
            });
        }
    } catch (error) {
        console.error('❌ [API/WHATSAPP/QR] Error obteniendo QR:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: error.message
        });
    }
});

// API para verificar estado de WhatsApp
app.get('/api/whatsapp/status', async (req, res) => {
    try {
        let authenticated = false;

        if (client) {
            try {
                // Timeout para evitar que se cuelgue
                const state = await Promise.race([
                    client.getState(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), 5000)
                    )
                ]);
                authenticated = state === 'CONNECTED';
            } catch (error) {
                console.log('Error obteniendo estado del cliente:', error.message);
                authenticated = false;
            }
        }

        res.json({
            success: true,
            ready: whatsappListo,
            authenticated: authenticated,
            client: !!client
        });
    } catch (error) {
        console.error('Error verificando estado WhatsApp:', error);
        res.json({
            success: true,
            ready: false,
            authenticated: false,
            client: false
        });
    }
});

// Ruta para la página de QR
app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

// API para obtener fotos de un reporte
app.get('/api/reportes/:reporteId/fotos', async (req, res) => {
    try {
        const { reporteId } = req.params;

        const resultado = await obtenerFotosReporte(reporteId);

        if (resultado.success) {
            res.json({
                success: true,
                fotos: resultado.fotos
            });
        } else {
            res.status(500).json({
                success: false,
                message: resultado.message
            });
        }
    } catch (error) {
        console.error('Error obteniendo fotos del reporte:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para generar PDF del reporte
app.get('/api/reportes/:reporteId/pdf', async (req, res) => {
    try {
        const { reporteId } = req.params;

        // Obtener datos del reporte
        const reportesResult = await obtenerReportesCompletados();
        if (!reportesResult.success) {
            return res.status(500).json({
                success: false,
                message: 'Error obteniendo datos del reporte'
            });
        }

        const reporte = reportesResult.reportes.find(r => r.id == reporteId);
        if (!reporte) {
            return res.status(404).json({
                success: false,
                message: 'Reporte no encontrado'
            });
        }

        // Obtener fotos del reporte
        const fotosResult = await obtenerFotosReporte(reporteId);
        const fotos = fotosResult.success ? fotosResult.fotos : [];

        // Generar HTML para el PDF
        const htmlContent = await generarHtmlReporte(reporte, fotos);

        // Generar PDF usando puppeteer
        const puppeteer = require('puppeteer');
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '1cm',
                right: '1cm',
                bottom: '1cm',
                left: '1cm'
            }
        });

        await browser.close();

        // Enviar PDF como respuesta
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Reporte_${reporte.cliente_nombre.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generando PDF del reporte:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error generando el PDF'
        });
    }
});

// Función para convertir imagen a base64
function convertirImagenABase64(rutaArchivo) {
    try {
        if (!fs.existsSync(rutaArchivo)) {
            console.log(`⚠️ Imagen no encontrada: ${rutaArchivo}`);
            return null;
        }

        const buffer = fs.readFileSync(rutaArchivo);
        const extension = rutaArchivo.split('.').pop().toLowerCase();
        let mimeType = 'image/jpeg';

        switch (extension) {
            case 'png': mimeType = 'image/png'; break;
            case 'gif': mimeType = 'image/gif'; break;
            case 'webp': mimeType = 'image/webp'; break;
            case 'bmp': mimeType = 'image/bmp'; break;
            default: mimeType = 'image/jpeg'; break;
        }

        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        console.error(`❌ Error convirtiendo imagen a base64: ${error.message}`);
        return null;
    }
}

// Función para generar HTML del reporte para PDF
async function generarHtmlReporte(reporte, fotos) {
    const fechaReporte = new Date(reporte.fecha_reporte).toLocaleString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const fechaProgramada = new Date(reporte.fecha_programada).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Convertir fotos a base64
    const fotosBase64 = [];
    for (const foto of fotos) {
        const rutaCompleta = foto.ruta_archivo.startsWith('./') ? foto.ruta_archivo : `./${foto.ruta_archivo}`;
        const base64 = convertirImagenABase64(rutaCompleta);
        if (base64) {
            fotosBase64.push({
                ...foto,
                base64: base64
            });
        } else {
            console.log(`⚠️ No se pudo convertir la foto: ${foto.ruta_archivo}`);
        }
    }

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reporte de Visita Técnica - ${reporte.cliente_nombre}</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
                color: #333;
                line-height: 1.6;
            }
            .header {
                text-align: center;
                border-bottom: 3px solid #007bff;
                padding-bottom: 20px;
                margin-bottom: 30px;
            }
            .header h1 {
                color: #007bff;
                margin: 0;
                font-size: 24px;
            }
            .header p {
                margin: 5px 0;
                color: #666;
            }
            .section {
                margin-bottom: 25px;
                padding: 15px;
                border: 1px solid #ddd;
                border-radius: 8px;
            }
            .section-title {
                background-color: #f8f9fa;
                color: #495057;
                padding: 10px;
                margin: -15px -15px 15px -15px;
                border-radius: 7px 7px 0 0;
                font-weight: bold;
                font-size: 16px;
            }
            .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-bottom: 15px;
            }
            .info-item {
                padding: 8px;
                background-color: #f8f9fa;
                border-radius: 4px;
            }
            .info-label {
                font-weight: bold;
                color: #495057;
                display: block;
                margin-bottom: 3px;
            }
            .info-value {
                color: #333;
            }
            .status-badge {
                display: inline-block;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: bold;
                color: white;
            }
            .status-satisfecho { background-color: #28a745; }
            .status-no-satisfecho { background-color: #dc3545; }
            .status-na { background-color: #6c757d; }
            .status-seguimiento { background-color: #ffc107; color: #212529; }
            .status-no-seguimiento { background-color: #28a745; }
            .detail-box {
                background-color: #f8f9fa;
                padding: 15px;
                border-radius: 6px;
                margin: 10px 0;
                border-left: 4px solid #007bff;
            }
            .photos-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin-top: 15px;
            }
            .photo-item {
                text-align: center;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 10px;
                background-color: #fff;
            }
            .photo-item img {
                max-width: 100%;
                max-height: 150px;
                border-radius: 4px;
                object-fit: cover;
            }
            .photo-description {
                margin-top: 8px;
                font-size: 12px;
                color: #666;
            }
            .footer {
                margin-top: 40px;
                text-align: center;
                padding-top: 20px;
                border-top: 1px solid #ddd;
                color: #666;
                font-size: 12px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>SolucNet - Reporte de Visita Técnica</h1>
            <p><strong>Reporte ID:</strong> ${reporte.id || 'N/A'}</p>
            <p><strong>Fecha de generación:</strong> ${fechaReporte}</p>
        </div>

        <div class="section">
            <div class="section-title">Información del Cliente</div>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Nombre:</span>
                    <span class="info-value">${reporte.cliente_nombre || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Cédula:</span>
                    <span class="info-value">${reporte.cliente_cedula || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Teléfono:</span>
                    <span class="info-value">${reporte.cliente_telefono || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Móvil:</span>
                    <span class="info-value">${reporte.cliente_movil || 'N/A'}</span>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Información de la Visita</div>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Técnico:</span>
                    <span class="info-value">${reporte.tecnico_nombre || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Fecha programada:</span>
                    <span class="info-value">${fechaProgramada}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Fecha completada:</span>
                    <span class="info-value">${fechaReporte}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Tiempo de trabajo:</span>
                    <span class="info-value">${reporte.tiempo_trabajo || 'N/A'}</span>
                </div>
                ${reporte.serial_equipo_asignado ? `
                <div class="info-item" style="grid-column: span 2; background-color: #e7f3ff; border: 2px solid #007bff;">
                    <span class="info-label">📦 Serial del Equipo Asignado:</span>
                    <span class="info-value" style="font-weight: bold; color: #007bff; font-size: 16px;">${reporte.serial_equipo_asignado}</span>
                </div>
                ` : ''}
            </div>
        </div>

        <div class="section">
            <div class="section-title">Detalles del Trabajo</div>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Motivo original:</span>
                    <span class="info-value">${reporte.motivo_visita || 'N/A'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Cliente satisfecho:</span>
                    <span class="status-badge ${
                        reporte.cliente_satisfecho === 'si' ? 'status-satisfecho' :
                        reporte.cliente_satisfecho === 'no' ? 'status-no-satisfecho' : 'status-na'
                    }">
                        ${reporte.cliente_satisfecho === 'si' ? '✓ Satisfecho' :
                          reporte.cliente_satisfecho === 'no' ? '✗ No satisfecho' : '? No especificado'}
                    </span>
                </div>
                <div class="info-item" style="grid-column: span 2;">
                    <span class="info-label">Requiere seguimiento:</span>
                    <span class="status-badge ${reporte.requiere_seguimiento ? 'status-seguimiento' : 'status-no-seguimiento'}">
                        ${reporte.requiere_seguimiento ? '⚠ Requiere seguimiento' : '✓ No requiere'}
                    </span>
                </div>
            </div>
        </div>

        ${(reporte.problemas_encontrados || reporte.solucion_aplicada || reporte.materiales_utilizados || reporte.notas) ? `
        <div class="section">
            <div class="section-title">Detalles Técnicos</div>
            ${reporte.problemas_encontrados ? `
                <div class="detail-box" style="border-left-color: #dc3545;">
                    <strong style="color: #dc3545;">Problemas encontrados:</strong><br>
                    ${reporte.problemas_encontrados}
                </div>
            ` : ''}
            ${reporte.solucion_aplicada ? `
                <div class="detail-box" style="border-left-color: #28a745;">
                    <strong style="color: #28a745;">Solución aplicada:</strong><br>
                    ${reporte.solucion_aplicada}
                </div>
            ` : ''}
            ${reporte.materiales_utilizados ? `
                <div class="detail-box" style="border-left-color: #17a2b8;">
                    <strong style="color: #17a2b8;">Materiales utilizados:</strong><br>
                    ${reporte.materiales_utilizados}
                </div>
            ` : ''}
            ${reporte.notas ? `
                <div class="detail-box" style="border-left-color: #6c757d;">
                    <strong style="color: #6c757d;">Notas adicionales:</strong><br>
                    ${reporte.notas}
                </div>
            ` : ''}
        </div>
        ` : ''}

        ${fotosBase64.length > 0 ? `
        <div class="section">
            <div class="section-title">Fotos del Técnico (${fotosBase64.length})</div>
            <div class="photos-grid">
                ${fotosBase64.map(foto => `
                    <div class="photo-item">
                        <img src="${foto.base64}" alt="${foto.descripcion || 'Foto del reporte'}" style="border: 1px solid #ddd;">
                        ${foto.descripcion ? `<div class="photo-description">${foto.descripcion}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <div class="footer">
            <p>Reporte generado automáticamente por SolucNet</p>
            <p>Fecha de generación: ${new Date().toLocaleString('es-ES')}</p>
        </div>
    </body>
    </html>
    `;
}

// Configuración de multer para subida de fotos
// const multer = require('multer'); // Ya está declarado arriba
// const path = require('path'); // Ya está declarado arriba

// Crear directorio para fotos de reportes si no existe
const FOTOS_REPORTES_DIR = path.join(__dirname, 'uploads', 'fotos_reportes');
if (!fs.existsSync(FOTOS_REPORTES_DIR)) {
    fs.mkdirSync(FOTOS_REPORTES_DIR, { recursive: true });
}

// Configuración de almacenamiento para fotos de reportes
const storageReportes = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, FOTOS_REPORTES_DIR);
    },
    filename: function (req, file, cb) {
        // Generar nombre único: reporteId_timestamp_random.ext
        const reporteId = req.body.reporteId || 'unknown';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const extension = path.extname(file.originalname);
        const filename = `reporte_${reporteId}_${timestamp}_${random}${extension}`;
        cb(null, filename);
    }
});

// Filtros para validar archivos
const fileFilter = (req, file, cb) => {
    // Solo permitir imágenes
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos de imagen'), false);
    }
};

const uploadReportes = multer({
    storage: storageReportes,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB máximo por archivo
        files: 10 // Máximo 10 archivos por reporte
    }
});

// API para subir fotos de reportes de visitas
app.post('/api/reportes-fotos', uploadReportes.array('fotos', 10), async (req, res) => {
    try {
        const reporteId = req.body.reporteId;
        const files = req.files;

        if (!reporteId) {
            return res.status(400).json({
                success: false,
                message: 'ID de reporte requerido'
            });
        }

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No se enviaron archivos'
            });
        }

        // Guardar información de fotos en la base de datos
        const fotosInfo = files.map(file => ({
            nombre_archivo: file.filename,
            ruta_archivo: `/uploads/fotos_reportes/${file.filename}`,
            descripcion: `Foto del trabajo realizado - ${file.originalname}`,
            tamaño: file.size
        }));

        const resultado = await guardarFotosReporte(reporteId, fotosInfo);

        if (resultado.success) {
            console.log(`📸 ${files.length} fotos guardadas para reporte ${reporteId}`);

            res.json({
                success: true,
                message: `${files.length} fotos subidas exitosamente`,
                fotos: fotosInfo
            });
        } else {
            // Si falla guardar en BD, eliminar archivos subidos
            files.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (err) {
                    console.error('Error eliminando archivo:', err);
                }
            });

            res.status(500).json({
                success: false,
                message: resultado.message || 'Error guardando fotos en base de datos'
            });
        }

    } catch (error) {
        console.error('Error subiendo fotos:', error.message);

        // Limpiar archivos si hay error
        if (req.files) {
            req.files.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                } catch (err) {
                    console.error('Error eliminando archivo tras error:', err);
                }
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'Error interno del servidor'
        });
    }
});

// Ruta para acceder al panel de técnicos
app.get('/tecnicos', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tecnicos_visitas.html'));
});

// Ruta de prueba para debug de conexiones BD
app.get('/api/test-bd', async (req, res) => {
    const mysql = require('mysql2/promise');
    const resultados = [];
    const testBD = [
        { host: '192.168.99.50', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6' },
        { host: '192.168.99.11', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6' },
        { host: '192.168.99.2', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6' }
    ];

    for (let i = 0; i < testBD.length; i++) {
        const bd = testBD[i];
        try {
            console.log(`🔗 [TEST] Conectando a BD: ${bd.host}`);
            const conexion = await mysql.createConnection(bd);

            const [clientes] = await conexion.execute(`
                SELECT COUNT(*) as total FROM usuarios
            `);

            const [busqueda] = await conexion.execute(`
                SELECT nombre, cedula FROM usuarios WHERE nombre LIKE '%JUAN%' LIMIT 3
            `);

            await conexion.end();

            resultados.push({
                bd: bd.host,
                total: clientes[0].total,
                busqueda: busqueda.length,
                ejemplos: busqueda
            });

            console.log(`✅ [TEST] BD ${bd.host}: ${clientes[0].total} usuarios, ${busqueda.length} con JUAN`);

        } catch (error) {
            console.error(`❌ [TEST] Error en BD ${bd.host}:`, error.message);
            resultados.push({
                bd: bd.host,
                error: error.message
            });
        }
    }

    res.json({ success: true, resultados });
});

// API para enviar mensajes de WhatsApp a clientes seleccionados
app.post('/api/enviar-mensajes-visitas', async (req, res) => {
    try {
        const { clientes, fechaVisita } = req.body;

        if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Lista de clientes es requerida'
            });
        }

        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhcGlfc3lzdGVtX3Blcm1hbmVudCIsInVzZXJuYW1lIjoiYXBpIiwibm9tYnJlIjoiVXN1YXJpbyBBUEkgRXRlcm5vIiwicm9sIjoiYXBpIiwiaWF0IjoxNzU2MDA5NjAxLCJwZXJtYW5lbnQiOnRydWUsImRlc2NyaXB0aW9uIjoiVG9rZW4gQVBJIHBlcm1hbmVudGUgcXVlIG51bmNhIGV4cGlyYSJ9.GwPj0htCGiBX62R3GBd_uJNhqwfP3UW4MrOkJAoMcaY';

        const mensaje = `🔧 Estimado cliente de SOLUCNET SAS,

Le informamos que el día ${fechaVisita || 'próximamente'} realizaremos una visita técnica a su domicilio.

⏰ No podemos indicarle una hora exacta ya que el tiempo de los técnicos es muy rotativo debido a:
• Demora en visitas anteriores
• Eventos climáticos
• Variables imprevistas

Por favor, cuente con disponibilidad para recibir la visita técnica.

Agradecemos su comprensión.
SOLUCNET SAS - Equipo Técnico`;

        const resultados = [];

        for (const cliente of clientes) {
            try {
                if (!cliente.telefono) {
                    resultados.push({
                        cliente: cliente.nombre,
                        telefono: 'N/A',
                        estado: 'error',
                        mensaje: 'No tiene número telefónico'
                    });
                    continue;
                }

                const numeroNormalizado = normalizarNumero(cliente.telefono);
                const chatId = numeroNormalizado + '@c.us';

                // Enviar mensaje usando la conexión local de WhatsApp
                console.log(`📤 [MENSAJE VISITA] Enviando a ${cliente.nombre} (${numeroNormalizado})`);

                const resultado = await enviarMensaje(chatId, mensaje);

                if (resultado) {
                    resultados.push({
                        cliente: cliente.nombre,
                        telefono: numeroNormalizado,
                        estado: 'enviado',
                        mensaje: 'Mensaje enviado correctamente por conexión local'
                    });
                    console.log(`✅ Mensaje enviado a ${cliente.nombre} (${numeroNormalizado}) por conexión local`);

                    // Pausa entre mensajes
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    resultados.push({
                        cliente: cliente.nombre,
                        telefono: numeroNormalizado,
                        estado: 'error',
                        mensaje: 'Error al enviar mensaje por conexión local'
                    });
                    console.error(`❌ Error enviando mensaje a ${cliente.nombre}`);
                }
            } catch (error) {
                resultados.push({
                    cliente: cliente.nombre,
                    telefono: cliente.telefono,
                    estado: 'error',
                    mensaje: error.message
                });
            }
        }

        res.json({
            success: true,
            resultados
        });

    } catch (error) {
        console.error('Error enviando mensajes:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// API para agregar observación de última hora a una visita
app.post('/api/agregar-observacion-urgente', async (req, res) => {
    try {
        const { visitaId, observacion } = req.body;

        if (!visitaId || !observacion) {
            return res.status(400).json({
                success: false,
                message: 'ID de visita y observación son requeridos'
            });
        }

        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });
        await conexion.query('USE solucnet_auth_system');

        // Actualizar la visita con la observación de última hora
        await conexion.execute(`
            UPDATE visitas_tecnicas
            SET observacion_ultima_hora = ?
            WHERE id = ?
        `, [observacion.trim(), visitaId]);

        await conexion.end();

        console.log(`📋 Observación urgente agregada a visita ${visitaId}: ${observacion.substring(0, 50)}...`);

        res.json({
            success: true,
            message: 'Observación agregada exitosamente'
        });

    } catch (error) {
        console.error('Error agregando observación urgente:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Endpoint GET con query params (requiere autenticación)
// Función para normalizar números y agregar prefijo 57 si es necesario
function normalizarNumero(numero) {
    if (!numero) return null;

    // Remover espacios y caracteres especiales
    let numeroLimpio = numero.replace(/\s+/g, '').replace(/[^\d]/g, '');

    // Si el número no tiene el prefijo 57, agregarlo
    if (!numeroLimpio.startsWith('57')) {
        numeroLimpio = '57' + numeroLimpio;
    }

    return numeroLimpio;
}

// Endpoint de prueba para verificar API sin WhatsApp
app.get('/api/test', requireAuth, async (req, res) => {
    try {
        const numero = req.query.numero;
        const mensaje = req.query.mensaje || '';

        console.log('🧪 [API TEST] Solicitud recibida:', {
            numero: numero,
            mensaje: mensaje,
            user: req.user?.username || 'unknown'
        });

        return res.json({
            status: 'API funcionando correctamente',
            message: 'Este es un endpoint de prueba sin WhatsApp',
            data: {
                numero: numero,
                mensaje: mensaje,
                user: req.user?.username || 'unknown',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('❌ [API TEST ERROR]:', error.message);
        return res.status(500).json({
            error: 'Error en endpoint de prueba',
            details: error.message
        });
    }
});

app.get('/api/enviar', requireAuth, async (req, res) => {
    try {
        let numero = req.query.numero;
        const mensaje = req.query.mensaje || '';
        const ipOrigen = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';

        if (!numero) {
            // Registrar intento fallido por falta de número
            await registrarLogAPI(ipOrigen, 'N/A', mensaje, 'error_parametros');
            return res.status(400).json({ error: 'Falta el parametro numero' });
        }

        // Normalizar el número agregando prefijo 57 si es necesario
        const numeroOriginal = numero;
        numero = normalizarNumero(numero);

        console.log(`📱 [API ENVIAR] Número original: ${numeroOriginal} → Normalizado: ${numero}`);

        if (!whatsappListo) {
            // Modo de prueba: responder como si el mensaje se enviara
            console.log(`⚠️ [API ENVIAR] WhatsApp no listo - Modo simulación activado`);
            console.log(`📱 Número: ${numeroOriginal} → ${numero}`);
            console.log(`💬 Mensaje: ${mensaje}`);

            // Registrar como si se enviara
            await registrarLogAPI(ipOrigen, numero, mensaje, 'simulado_whatsapp_no_listo');

            return res.json({
                status: 'Mensaje simulado (WhatsApp no conectado)',
                numeroOriginal: numeroOriginal,
                numeroNormalizado: numero,
                mensaje: mensaje,
                nota: 'WhatsApp no está listo. Mensaje simulado para pruebas.',
                timestamp: new Date().toISOString()
            });
        }

        const chatId = `${numero}@c.us`;

        // ===== FAILSAFE: Guardar INMEDIATAMENTE en BD antes de intentar envío =====
        let messageIdBD = null;
        try {
            const [result] = await dbPool.execute(
                `INSERT INTO cola_mensajes_api (chat_id, mensaje, tipo_mensaje, estado, intentos)
                 VALUES (?, ?, 'text', 'procesando', 0)`,
                [chatId, mensaje]
            );
            messageIdBD = result.insertId;
            console.log(`💾 [API FAILSAFE /enviar] Mensaje guardado en BD (id=${messageIdBD}) ANTES de intentar envío`);
        } catch (error) {
            console.error(`❌ [API FAILSAFE /enviar] Error guardando en BD: ${error.message}`);
        }

        const exito = await enviarMensaje(chatId, mensaje, null, true);

        if (exito) {
            // Si se envió exitosamente y está en BD, actualizar estado a 'enviado'
            if (messageIdBD) {
                try {
                    await dbPool.execute(
                        `UPDATE cola_mensajes_api SET estado = 'enviado', fecha_envio = NOW() WHERE id = ?`,
                        [messageIdBD]
                    );
                    console.log(`✅ [API FAILSAFE /enviar] Mensaje BD id=${messageIdBD} marcado como enviado`);
                } catch (error) {
                    console.error(`❌ [API FAILSAFE /enviar] Error actualizando BD: ${error.message}`);
                }
            }
            // Registrar envío exitoso
            await registrarLogAPI(ipOrigen, numero, mensaje, 'enviado');
            return res.json({
                status: 'Mensaje enviado',
                numeroOriginal: numeroOriginal,
                numeroNormalizado: numero,
                mensaje
            });
        } else {
            // Si falló, el mensaje YA está en BD con estado 'procesando'
            // Actualizar a 'pendiente' para que el procesador lo retome
            if (messageIdBD) {
                try {
                    await dbPool.execute(
                        `UPDATE cola_mensajes_api SET estado = 'pendiente' WHERE id = ?`,
                        [messageIdBD]
                    );
                    console.log(`⚠️ [API FAILSAFE /enviar] Mensaje BD id=${messageIdBD} marcado como pendiente para reintento`);
                } catch (error) {
                    console.error(`❌ [API FAILSAFE /enviar] Error actualizando BD: ${error.message}`);
                }
            }
            // Registrar envío fallido
            await registrarLogAPI(ipOrigen, numero, mensaje, 'error_envio');
            return res.status(500).json({ error: 'Error enviando mensaje' });
        }
    } catch (err) {
        const ipOrigen = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
        let numero = req.query.numero || 'N/A';
        const mensaje = req.query.mensaje || '';

        // Normalizar el número para los logs de error también
        const numeroOriginal = numero;
        if (numero !== 'N/A') {
            numero = normalizarNumero(numero);
        }

        // Registrar error de excepción
        await registrarLogAPI(ipOrigen, numero, mensaje, 'error_excepcion');

        console.error(`❌ [API ENVIAR ERROR] Número original: ${numeroOriginal} → Normalizado: ${numero}`, err);
        return res.status(500).json({
            error: 'Error enviando mensaje',
            numeroOriginal: numeroOriginal,
            numeroNormalizado: numero,
            details: err.message
        });
    }
});

// Función para reintentar archivos de audio fallidos
async function retryFailedAudioFile(fileInfo) {
    try {
        if (fileInfo.retryCount >= fileInfo.maxRetries) {
            console.log(`❌ Máximo de reintentos alcanzado para: ${fileInfo.originalName}`);
            return;
        }

        console.log(`🔄 Intentando reenviar archivo de audio: ${fileInfo.originalName} (intento ${fileInfo.retryCount + 1}/${fileInfo.maxRetries})`);

        // Verificar que el archivo aún existe
        if (!fs.existsSync(fileInfo.path)) {
            console.log(`❌ Archivo ya no existe: ${fileInfo.path}`);
            return;
        }

        // Verificar que WhatsApp esté listo
        if (!whatsappListo || !whatsappEstabilizado) {
            console.log(`⏳ WhatsApp no está listo para reintento. Reintentando en 1 minuto...`);
            setTimeout(() => retryFailedAudioFile(fileInfo), 60 * 1000);
            return;
        }

        // Crear media y enviar
        const media = MessageMedia.fromFilePath(fileInfo.path);
        const success = await enviarMensaje(fileInfo.chatId, media, fileInfo.path);

        if (success) {
            console.log(`✅ Archivo reenviado exitosamente: ${fileInfo.originalName}`);

            // Enviar mensaje de confirmación
            const confirmMessage = `✅ Audio reenviado exitosamente: ${fileInfo.originalName}\n\n📅 Reenviado desde cola de archivos fallidos.`;
            await enviarMensaje(fileInfo.chatId, confirmMessage);

            // Limpiar archivo temporal
            try {
                fs.unlinkSync(fileInfo.path);
                console.log(`🗑️ Archivo temporal eliminado: ${fileInfo.path}`);
            } catch (error) {
                console.log(`⚠️ Error eliminando archivo temporal: ${error.message}`);
            }

            // Remover de la cola
            if (global.failedAudioFiles) {
                global.failedAudioFiles = global.failedAudioFiles.filter(f => f.path !== fileInfo.path);
            }

        } else {
            fileInfo.retryCount++;
            console.log(`❌ Reintento fallido ${fileInfo.retryCount}/${fileInfo.maxRetries} para: ${fileInfo.originalName}`);

            if (fileInfo.retryCount < fileInfo.maxRetries) {
                // Programar siguiente reintento con delay progresivo
                const delayMinutes = 2 * (fileInfo.retryCount + 1); // 2, 4, 6 minutos
                setTimeout(() => retryFailedAudioFile(fileInfo), delayMinutes * 60 * 1000);
            } else {
                console.log(`❌ Todos los reintentos fallaron para: ${fileInfo.originalName}`);
                // Enviar mensaje final de error
                const finalErrorMessage = `❌ No se pudo reenviar el audio después de ${fileInfo.maxRetries} intentos: ${fileInfo.originalName}\n\n💡 Recomendaciones:\n• Grabe un audio más corto\n• Espere más tiempo entre grabaciones\n• Verifique su conexión a internet`;
                await enviarMensaje(fileInfo.chatId, finalErrorMessage);
            }
        }

    } catch (error) {
        console.error(`💥 Error en reintento de archivo: ${error.message}`);
        fileInfo.retryCount++;

        if (fileInfo.retryCount < fileInfo.maxRetries) {
            setTimeout(() => retryFailedAudioFile(fileInfo), 2 * 60 * 1000);
        }
    }
}

// Endpoint para obtener estadísticas
// Endpoint de diagnóstico sin autenticación para debugging
app.get('/api/debug-status', (req, res) => {
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        whatsapp: {
            listo: whatsappListo,
            estabilizado: whatsappEstabilizado,
            ultimoReinicio: ultimoReinicio
        },
        sistema: {
            usuariosActivos: estadosUsuario.size,
            clienteIniciando: clienteIniciando,
            qrActual: global.currentQR ? 'PRESENTE' : null,
            failedAudioFiles: global.failedAudioFiles ? global.failedAudioFiles.length : 0
        },
        chats: {
            activos: chatsActivos.size,
            finalizados: chatsFinalizados.size,
            chatsActivosIDs: Array.from(chatsActivos.keys()),
            chatsFinalizadosIDs: Array.from(chatsFinalizados).slice(0, 20),
            chat573135648878: {
                enActivos: chatsActivos.has('573135648878@c.us'),
                enFinalizados: chatsFinalizados.has('573135648878@c.us')
            }
        },
        request: {
            headers: {
                authorization: req.headers.authorization ? 'PRESENTE' : 'FALTANTE',
                'content-type': req.headers['content-type'] || 'No especificado'
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        }
    });
});

// Endpoint para ver archivos de audio fallidos
app.get('/api/failed-audio-files', requireAuth, (req, res) => {
    const failedFiles = global.failedAudioFiles || [];

    res.json({
        success: true,
        failedFilesCount: failedFiles.length,
        failedFiles: failedFiles.map(file => ({
            originalName: file.originalName,
            size: file.size,
            chatId: file.chatId,
            retryCount: file.retryCount,
            maxRetries: file.maxRetries,
            timestamp: file.timestamp,
            nextRetryIn: file.retryCount < file.maxRetries ? `${2 * (file.retryCount + 1)} minutos` : 'Sin reintentos'
        })),
        timestamp: new Date().toISOString()
    });
});

// Endpoint para forzar reintento de archivo fallido
app.post('/api/retry-failed-audio/:filePath', requireAuth, async (req, res) => {
    try {
        const filePath = decodeURIComponent(req.params.filePath);

        if (!global.failedAudioFiles) {
            return res.status(404).json({
                success: false,
                error: 'No hay archivos fallidos en cola'
            });
        }

        const fileInfo = global.failedAudioFiles.find(f => f.path === filePath);

        if (!fileInfo) {
            return res.status(404).json({
                success: false,
                error: 'Archivo no encontrado en cola de fallidos'
            });
        }

        if (fileInfo.retryCount >= fileInfo.maxRetries) {
            return res.status(400).json({
                success: false,
                error: 'Máximo de reintentos alcanzado'
            });
        }

        // Forzar reintento inmediato
        fileInfo.retryCount = 0; // Reset retry count
        await retryFailedAudioFile(fileInfo);

        res.json({
            success: true,
            message: `Reintento forzado para: ${fileInfo.originalName}`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error forzando reintento:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/stats', async (req, res) => {
    // Verificación inteligente del estado de WhatsApp
    // Comprobar múltiples indicadores para determinar si está realmente conectado

    let whatsappRealmenteConectado = whatsappListo;

    // Si whatsappListo es false, verificar otros indicadores
    if (!whatsappListo && client) {
        // PRIMERO: Verificar el estado real del cliente de WhatsApp
        try {
            const clientState = await client.getState();
            const estaConectado = clientState === 'CONNECTED';

            if (estaConectado) {
                // Cliente realmente conectado, actualizar estado
                whatsappRealmenteConectado = true;
                whatsappListo = true;
                console.log('✅ [API/STATS] WhatsApp verificado como CONNECTED mediante client.getState()');
            } else {
                console.log(`⚠️ [API/STATS] Cliente en estado: ${clientState} - NO conectado`);
            }
        } catch (error) {
            // Detectar estado zombie con el error "Cannot read properties of null"
            if (error.message && error.message.includes('Cannot read properties of null')) {
                console.log('🚨 [API/STATS] Estado zombie detectado - navegador crasheado');

                // Incrementar contador de fallas
                browserHealthCheck.consecutiveFailures++;

                // Si alcanzamos el límite, forzar reinicio inmediato
                if (browserHealthCheck.consecutiveFailures >= browserHealthCheck.maxFailures && !browserHealthCheck.zombieStateDetected) {
                    console.log('🚨 [API/STATS] Forzando reinicio por estado zombie');
                    browserHealthCheck.zombieStateDetected = true;
                    // No esperar, ejecutar inmediatamente
                    reiniciarClientePorCrash('api_stats_zombie_detected').catch(err => {
                        console.log(`⚠️ [API/STATS] Error en reinicio: ${err.message}`);
                    });
                }
            }
            // Silenciar errores de sesión cerrada - son normales durante reconexión
            else if (error.message && (error.message.includes('Session closed') || error.message.includes('Protocol error'))) {
                // No hacer nada - es un error esperado durante reconexión
            } else {
                console.log(`⚠️ [API/STATS] Error verificando estado: ${error.message}`);
            }

            // Verificar indicadores secundarios solo si hay mensajes MUY recientes
            const tiempoActual = Date.now();
            const CINCO_MINUTOS = 5 * 60 * 1000;
            const hayMensajesRecientes = botHealthMonitor.mensajesChatbot &&
                botHealthMonitor.mensajesChatbot.length > 0 &&
                botHealthMonitor.mensajesChatbot.some(m => {
                    const tiempoMensaje = new Date(m.timestamp).getTime();
                    return (tiempoActual - tiempoMensaje) < CINCO_MINUTOS;
                });

            // SOLO confiar en mensajes RECIENTES, NO en chats activos antiguos
            if (hayMensajesRecientes) {
                whatsappRealmenteConectado = true;
                whatsappListo = true;
                console.log('✅ [API/STATS] WhatsApp detectado como conectado basado en mensajes recientes');
            }
        }
    }

    const stats = {
        usuariosActivos: estadosUsuario.size,
        whatsappListo: whatsappRealmenteConectado,
        whatsappEstabilizado,
        timestamp: new Date().toISOString()
    };
    res.json(stats);
});

// Endpoint para obtener salud del bot
app.get('/api/bot-health', (req, res) => {
    const totalMensajes = botHealthMonitor.erroresEnvio + botHealthMonitor.mensajesExitosos;
    const tasaError = totalMensajes > 0 ? ((botHealthMonitor.erroresEnvio / totalMensajes) * 100).toFixed(2) : 0;
    const tasaExito = totalMensajes > 0 ? ((botHealthMonitor.mensajesExitosos / totalMensajes) * 100).toFixed(2) : 0;
    const tiempoActivo = Date.now() - botHealthMonitor.inicioSesion;

    res.json({
        estado: botHealthMonitor.estadoWhatsApp,
        whatsappListo: whatsappListo,
        mensajes: {
            exitosos: botHealthMonitor.mensajesExitosos,
            fallidos: botHealthMonitor.erroresEnvio,
            total: totalMensajes,
            tasaExito: parseFloat(tasaExito),
            tasaError: parseFloat(tasaError)
        },
        limites: {
            mensajesHoy: dailyMessageLimit.counter,
            maxDiario: dailyMessageLimit.maxPerDay,
            porcentajeDiario: ((dailyMessageLimit.counter / dailyMessageLimit.maxPerDay) * 100).toFixed(1),
            mensajesHora: dailyMessageLimit.messagesPerHour,
            maxHora: dailyMessageLimit.maxPerHour,
            porcentajeHora: ((dailyMessageLimit.messagesPerHour / dailyMessageLimit.maxPerHour) * 100).toFixed(1)
        },
        alertas: botHealthMonitor.alertasActivas,
        ultimoError: botHealthMonitor.ultimoError,
        ultimoChequeo: new Date(botHealthMonitor.ultimoChequeo).toISOString(),
        tiempoActivo: {
            ms: tiempoActivo,
            horas: (tiempoActivo / 3600000).toFixed(2),
            dias: (tiempoActivo / 86400000).toFixed(2)
        },
        chatsActivos: chatsActivos.size,
        mensajesChatbot: botHealthMonitor.mensajesChatbot, // Últimos 50 mensajes del chatbot
        browserHealth: {
            healthy: browserHealthCheck.consecutiveFailures === 0,
            consecutiveFailures: browserHealthCheck.consecutiveFailures,
            maxFailures: browserHealthCheck.maxFailures,
            zombieStateDetected: browserHealthCheck.zombieStateDetected,
            lastSuccessfulOperation: new Date(browserHealthCheck.lastSuccessfulOperation).toISOString(),
            timeSinceLastSuccess: Date.now() - browserHealthCheck.lastSuccessfulOperation
        },
        timestamp: new Date().toISOString()
    });
});

// Endpoint para obtener QR actual
// Endpoint de estado del servidor
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        whatsapp: whatsappListo,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Función para extraer el último QR de los logs
function getLatestQRFromLogs() {
    try {
        const fs = require('fs');
        const logs = fs.readFileSync('./logs/out.log', 'utf8');
        const qrMatches = logs.match(/🔍 \[QR REAL\] (.+)/g);
        if (qrMatches && qrMatches.length > 0) {
            const lastQR = qrMatches[qrMatches.length - 1];
            return lastQR.replace('🔍 [QR REAL] ', '');
        }
        return null;
    } catch (error) {
        console.log('Error leyendo QR de logs:', error.message);
        return null;
    }
}

app.get('/api/qr', async (req, res) => {
    try {
        let qrData = global.currentQR;

        // Si no hay QR global, intentar extraer de logs
        if (!qrData) {
            qrData = getLatestQRFromLogs();
        }

        // Si no hay QR disponible, devolver estado sin QR
        if (!qrData) {
            return res.json({
                hasQR: false,
                message: 'QR no disponible - WhatsApp no ha generado un código QR válido',
                timestamp: new Date().toISOString(),
                clienteIniciando: clienteIniciando,
                source: 'none',
                whatsappListo: whatsappListo
            });
        }

        res.json({
            qr: qrData,
            hasQR: true,
            timestamp: new Date().toISOString(),
            clienteIniciando: clienteIniciando,
            source: global.currentQR ? 'global' : 'logs',
            whatsappListo: whatsappListo
        });
    } catch (error) {
        console.error('❌ [API/QR] Error obteniendo QR:', error);
        res.status(500).json({
            hasQR: false,
            error: 'Error interno del servidor',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener la imagen del QR
app.get('/api/qr-image', async (req, res) => {
    try {
        // Usar la misma lógica que el endpoint /api/qr
        let qrData = global.currentQR;
        if (!qrData) {
            qrData = getLatestQRFromLogs();
        }
        if (!qrData) {
            return res.status(404).json({
                error: 'No hay QR disponible',
                message: 'WhatsApp no ha generado un código QR válido. Asegúrate de que WhatsApp esté desconectado para generar un nuevo QR.',
                clienteIniciando: clienteIniciando
            });
        }

        // Generar imagen QR como buffer
        const qrBuffer = await QRCode.toBuffer(qrData, {
            type: 'png',
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // Enviar imagen como respuesta con headers agresivos anti-cache
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline; filename="whatsapp-qr.png"');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}-${Math.random().toString(36).substring(7)}"`);
        res.send(qrBuffer);

    } catch (error) {
        console.error('Error generando imagen QR:', error);
        res.status(500).json({
            error: 'Error generando imagen QR',
            details: error.message
        });
    }
});

// Endpoint para forzar actualización de la imagen QR (cache buster agresivo)
app.get('/api/qr-image/force', async (req, res) => {
    try {
        if (!global.currentQR) {
            return res.status(404).json({
                error: 'No hay QR disponible para actualizar',
                message: 'Primero debe generarse un QR desde la consola'
            });
        }

        console.log('🔄 Forzando actualización de imagen QR con cache buster máximo');

        // Generar imagen QR con cache buster extremo
        const qrBuffer = await QRCode.toBuffer(global.currentQR, {
            type: 'png',
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // Headers ultra-agresivos anti-cache
        const now = new Date();
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline; filename="whatsapp-qr.png"');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, proxy-revalidate, s-maxage=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', now.toUTCString());
        res.setHeader('ETag', `"force-${Date.now()}-${Math.random().toString(36).substring(7)}"`);
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-QR-Force-Refresh', 'true');

        console.log('✅ Imagen QR forzada enviada con headers anti-cache extremos');
        res.send(qrBuffer);

    } catch (error) {
        console.error('Error en actualización forzada de QR:', error);
        res.status(500).json({
            error: 'Error actualizando imagen QR',
            details: error.message
        });
    }
});

// Endpoint para forzar regeneración del QR
app.post('/api/qr/refresh', async (req, res) => {
    try {
        if (!clienteIniciando && client) {
            registrarLog('🔄 Forzando regeneración del QR - reiniciando cliente...');
            
            // Limpiar QR actual
            global.currentQR = null;
            whatsappListo = false;
            
            // Reiniciar cliente
            setTimeout(async () => {
                try {
                    await client.destroy();
                } catch (err) {
                    registrarLog(`Error cerrando cliente para regenerar QR: ${err.message}`);
                }
                borrarSesion();
                setTimeout(iniciarCliente, 2000);
            }, 1000);
            
            res.json({
                success: true,
                message: 'Regeneración de QR iniciada',
                timestamp: new Date().toISOString()
            });
        } else {
            res.json({
                success: false,
                message: 'Cliente ya está iniciando o no existe',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        registrarLog(`Error forzando regeneración QR: ${error.message}`);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener lista de chats
app.get('/api/chats', async (req, res) => {
    try {
        console.log(`🔍 [API CHATS] Obteniendo lista de chats con historial de mensajes...`);

        // *** MOSTRAR TODOS LOS CHATS ACTIVOS (NO SOLO CON VISITAS PENDIENTES) ***
        const allChats = Array.from(chatsActivos.values())
            .filter(chat => {
                // Filtrar grupos de WhatsApp
                return !chat.id.includes('@g.us');
            })
            .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

        console.log(`📋 [CHATS] ${allChats.length} chats activos encontrados de ${chatsActivos.size} totales`);
        console.log(`🔍 [DEBUG] IDs en chatsActivos:`, Array.from(chatsActivos.keys()));

        // *** Respetar límite establecido por función de limpieza ***
        const MAX_CHATS_TO_PROCESS = global.MAX_CHATS_ALLOWED || 50;

        // *** AUTO-LIMPIEZA: Si hay demasiados chats, eliminar los menos recientes ***
        if (allChats.length > MAX_CHATS_TO_PROCESS * 2) {
            console.log(`🧹 [AUTO-LIMPIEZA] Eliminando chats antiguos: ${allChats.length} > ${MAX_CHATS_TO_PROCESS * 2}`);
            const chatsParaEliminar = allChats.slice(MAX_CHATS_TO_PROCESS);
            for (const chat of chatsParaEliminar) {
                chatsActivos.delete(chat.id);
                estadosUsuario.delete(chat.id);
                mensajesChat.delete(chat.id);
            }
        }

        const chats = allChats.slice(0, MAX_CHATS_TO_PROCESS);

        if (allChats.length > MAX_CHATS_TO_PROCESS) {
            console.log(`⚡ [OPTIMIZACIÓN] Procesando solo ${MAX_CHATS_TO_PROCESS} chats más recientes de ${allChats.length} totales`);
        }

        // *** OPTIMIZACIÓN: Procesar chats en paralelo con límite de concurrencia ***
        const BATCH_SIZE = 5; // Procesar máximo 5 chats en paralelo
        const chatsWithMessages = [];

        const processChat = async (chat) => {
            let chatData = {
                id: chat.id,
                phone: chat.phone,
                name: chat.name,
                mode: chat.mode,
                lastActivity: chat.lastActivity,
                lastMessage: chat.lastMessage,
                unreadCount: chat.unreadCount || 0,
                messagesCount: 0,
                recentMessages: []
            };

            // Intentar obtener mensajes de WhatsApp si está disponible
            if (whatsappListo && client) {
                try {
                    console.log(`📚 [CHAT FETCH] Obteniendo mensajes para ${chat.name} (${chat.id})...`);

                    const whatsappChat = await client.getChatById(chat.id);
                    if (whatsappChat) {
                        // *** Reducir límite aún más para lista de chats ***
                        const messages = await whatsappChat.fetchMessages({ limit: 10 }); // solo últimos 10 mensajes para lista
                        
                        console.log(`📋 [MESSAGES] ${messages.length} mensajes obtenidos para ${chat.name}`);
                        
                        // *** OPTIMIZACIÓN: Convertir mensajes con procesamiento simplificado de media ***
                        const convertedMessages = messages.map((msg, index) => {
                            let messageBody = msg.body || '';

                            // *** Procesamiento simplificado de media para lista de chats ***
                            if (msg.hasMedia) {
                                switch (msg.type) {
                                    case 'image':
                                        messageBody = '🖼️ Imagen';
                                        break;
                                    case 'audio':
                                    case 'ptt':
                                        messageBody = '🎵 Audio';
                                        break;
                                    case 'video':
                                        messageBody = '🎬 Video';
                                        break;
                                    case 'document':
                                        messageBody = messageBody ? `📄 ${messageBody}` : '📄 Documento';
                                        break;
                                    default:
                                        messageBody = messageBody ? `📎 ${messageBody}` : `📎 ${msg.type}`;
                                }
                            }
                            
                            return {
                                id: msg.id._serialized || `whatsapp_${msg.timestamp}_${index}`,
                                body: messageBody,
                                fromMe: msg.fromMe,
                                timestamp: msg.timestamp * 1000, // Convertir a milisegundos
                                status: msg.fromMe ? (msg.ack === 3 ? 'read' : msg.ack === 2 ? 'delivered' : 'sent') : 'received',
                                type: msg.type || 'text'
                            };
                        });
                        
                        // Ordenar cronológicamente (más recientes primero para la lista)
                        convertedMessages.sort((a, b) => b.timestamp - a.timestamp);
                        
                        // Actualizar información del chat
                        chatData.messagesCount = convertedMessages.length;
                        chatData.recentMessages = convertedMessages.slice(0, 5); // Solo los 5 más recientes para la API
                        
                        // Actualizar lastMessage con el mensaje más reciente
                        if (convertedMessages.length > 0) {
                            // Check if message contains an image and replace with 'imagen'
                            if (convertedMessages[0].body && convertedMessages[0].body.includes('<img')) {
                                chatData.lastMessage = 'imagen';
                            } else {
                                chatData.lastMessage = convertedMessages[0].body.substring(0, 100);
                            }
                            chatData.lastActivity = convertedMessages[0].timestamp;
                        }
                        
                        // Guardar todos los mensajes en el cache para uso posterior
                        if (!mensajesChat.has(chat.id)) {
                            mensajesChat.set(chat.id, []);
                        }
                        
                        // Actualizar cache con mensajes históricos (evitar duplicados)
                        const cacheMessages = mensajesChat.get(chat.id);
                        convertedMessages.forEach(histMsg => {
                            const exists = cacheMessages.find(cacheMsg => 
                                cacheMsg.id === histMsg.id || 
                                (Math.abs(cacheMsg.timestamp - histMsg.timestamp) < 1000 && 
                                 cacheMsg.body === histMsg.body && 
                                 cacheMsg.fromMe === histMsg.fromMe)
                            );
                            
                            if (!exists) {
                                cacheMessages.push(histMsg);
                            }
                        });
                        
                        // Ordenar cache cronológicamente (más antiguos primero)
                        cacheMessages.sort((a, b) => a.timestamp - b.timestamp);
                        
                        console.log(`💾 [CACHE] Chat ${chat.name}: ${cacheMessages.length} mensajes totales en cache`);
                        
                    } else {
                        console.log(`⚠️ [WHATSAPP] Chat ${chat.id} no encontrado en WhatsApp`);
                    }
                    
                } catch (chatError) {
                    console.error(`❌ [CHAT ERROR] Error obteniendo mensajes para ${chat.name}:`, chatError.message);
                    // Continuar con el siguiente chat si hay error
                }
            } else {
                // Si WhatsApp no está listo, usar mensajes del cache
                const cachedMessages = mensajesChat.get(chat.id) || [];
                chatData.messagesCount = cachedMessages.length;
                chatData.recentMessages = cachedMessages.slice(-5).reverse(); // Últimos 5, más recientes primero
                console.log(`📋 [CACHE] Usando cache para ${chat.name}: ${cachedMessages.length} mensajes`);
            }

            return chatData;
        };

        // *** PROCESAR EN LOTES PARALELOS ***
        for (let i = 0; i < chats.length; i += BATCH_SIZE) {
            const batch = chats.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(processChat);
            const batchResults = await Promise.all(batchPromises);
            chatsWithMessages.push(...batchResults);

            console.log(`📊 [BATCH] Procesado lote ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(chats.length/BATCH_SIZE)}`);
        }

        // Ordenar por actividad más reciente
        chatsWithMessages.sort((a, b) => b.lastActivity - a.lastActivity);

        console.log(`✅ [API CHATS] ${chatsWithMessages.length} chats procesados con mensajes`);

        res.json({
            success: true,
            chats: chatsWithMessages,
            totalChats: chatsWithMessages.length,
            totalMessages: chatsWithMessages.reduce((total, chat) => total + chat.messagesCount, 0),
            timestamp: new Date().toISOString(),
            source: whatsappListo ? 'whatsapp+cache' : 'cache'
        });
    } catch (error) {
        console.error('❌ [API CHATS ERROR]', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo chats con mensajes',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener TODOS los chats disponibles (sin filtro de visitas pendientes)
app.get('/api/all-chats', async (req, res) => {
    try {
        console.log(`🔍 [API ALL-CHATS] Obteniendo TODOS los chats activos...`);

        // Obtener todos los chats activos (no solo pendientes)
        const allChats = Array.from(chatsActivos.values())
            .filter(chat => {
                // Filtrar grupos de WhatsApp
                if (chat.id.includes('@g.us')) return false;
                // NO filtrar por chatsFinalizados - si está en chatsActivos, está activo
                return true;
            })
            .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
            .slice(0, 50); // Limitar a 50 chats más recientes

        console.log(`🎯 [TODOS LOS CHATS] ${allChats.length} chats activos encontrados`);

        const chatsWithMessages = [];
        const BATCH_SIZE = 10;

        // Función para procesar cada chat (versión simplificada)
        const processChat = async (chat) => {
            // Calcular modo correctamente usando obtenerModoChat
            const modoActual = obtenerModoChat(chat.id);

            const chatData = {
                id: chat.id,
                name: chat.name || 'Sin nombre',
                lastActivity: chat.lastActivity,
                lastMessage: chat.lastMessage || '',
                messagesCount: 0,
                unreadCount: chat.unreadCount || 0,
                mode: modoActual, // Usar el modo calculado correctamente
                pendiente: chat.pendiente || false
            };

            // Usar mensajes del cache
            const cachedMessages = mensajesChat.get(chat.id) || [];
            chatData.messagesCount = cachedMessages.length;
            chatData.recentMessages = cachedMessages.slice(-5).reverse();

            return chatData;
        };

        // Procesar en lotes paralelos
        for (let i = 0; i < allChats.length; i += BATCH_SIZE) {
            const batch = allChats.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(processChat);
            const batchResults = await Promise.all(batchPromises);
            chatsWithMessages.push(...batchResults);
        }

        // Ordenar por actividad más reciente
        chatsWithMessages.sort((a, b) => b.lastActivity - a.lastActivity);

        console.log(`✅ [API ALL-CHATS] ${chatsWithMessages.length} chats procesados`);

        res.json({
            success: true,
            chats: chatsWithMessages,
            totalChats: chatsWithMessages.length,
            totalMessages: chatsWithMessages.reduce((total, chat) => total + chat.messagesCount, 0),
            timestamp: new Date().toISOString(),
            source: 'all-chats'
        });
    } catch (error) {
        console.error('❌ [API ALL-CHATS ERROR]', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo todos los chats',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para marcar/desmarcar un chat como pendiente
app.post('/api/chats/:chatId/toggle-pendiente', async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const { pendiente } = req.body;

        // Ignorar operaciones en grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.status(400).json({
                success: false,
                message: 'Operación no permitida en grupos de WhatsApp',
                timestamp: new Date().toISOString()
            });
        }

        const chatInfo = chatsActivos.get(chatId);

        if (chatInfo) {
            chatInfo.pendiente = pendiente === true;
            chatsActivos.set(chatId, chatInfo);

            // Si se marca como pendiente, asegurar que no esté en chatsFinalizados
            if (chatInfo.pendiente === true) {
                const wasFinalized = chatsFinalizados.has(chatId);
                if (wasFinalized) {
                    chatsFinalizados.delete(chatId);
                    console.log(`🔄 [TOGGLE-PENDIENTE] Chat ${chatId} eliminado de chatsFinalizados para permitir recuperación`);
                }
            }

            console.log(`📝 [TOGGLE-PENDIENTE] Chat ${chatId} marcado como pendiente: ${chatInfo.pendiente}`);

            res.json({
                success: true,
                message: `Chat ${chatInfo.pendiente ? 'marcado como pendiente' : 'desmarcado como pendiente'}`,
                pendiente: chatInfo.pendiente,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Chat no encontrado',
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error cambiando estado pendiente',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener mensajes de un chat específico
// Funciones para procesar archivos multimedia del historial
async function processHistoryImage(msg) {
    try {
        // Generar nombre basado en ID del mensaje para evitar duplicados
        const messageId = msg.id._serialized || msg.id;
        const filename = `history_image_${messageId.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`;
        const filePath = `./images/users/${filename}`;
        const webPath = `/images/users/${filename}`;
        
        // Verificar si ya existe el archivo
        if (fs.existsSync(filePath)) {
            let html = `<img src="${webPath}" alt="Imagen del historial" style="max-width: 200px; border-radius: 8px;">`;
            if (msg.body && msg.body.trim()) {
                html += `<br><span>${msg.body}</span>`;
            }
            return html;
        }
        
        // Intentar descargar la imagen
        const media = await msg.downloadMedia();
        
        // Verificar si el media se descargó correctamente
        if (!media || !media.data) {
            registrarLog(`Imagen del historial no disponible para descarga: ${messageId}`);
            let html = `<div class="image-unavailable" style="padding: 12px; background: #f8f9fa; border: 1px dashed #dee2e6; border-radius: 8px; text-align: center; color: #6c757d; margin: 8px 0; max-width: 200px;"><i class="fas fa-image" style="font-size: 24px; margin-bottom: 8px; display: block;"></i><strong>📷 Imagen del historial</strong><br><small>Esta imagen ya no está disponible para descarga</small></div>`;
            if (msg.body && msg.body.trim()) {
                html += `<br><span>${msg.body}</span>`;
            }
            return html;
        }
        
        // Crear directorio si no existe
        const userImagesDir = './images/users';
        if (!fs.existsSync(userImagesDir)) {
            fs.mkdirSync(userImagesDir, { recursive: true });
        }
        
        // Guardar imagen
        await new Promise((resolve, reject) => {
            const buffer = Buffer.from(media.data, 'base64');
            fs.writeFile(filePath, buffer, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        registrarLog(`Imagen del historial guardada: ${filePath}`);
        
        // Crear HTML
        let html = `<img src="${webPath}" alt="Imagen del historial" style="max-width: 200px; border-radius: 8px;">`;
        if (msg.body && msg.body.trim()) {
            html += `<br><span>${msg.body}</span>`;
        }
        return html;
        
    } catch (error) {
        registrarLog(`Error procesando imagen del historial: ${error.message}`);
        return msg.body ? `📷 ${msg.body}` : '📷 Imagen';
    }
}

async function processHistoryAudio(msg) {
    try {
        const messageId = msg.id._serialized || msg.id;
        const filename = `history_audio_${messageId.replace(/[^a-zA-Z0-9]/g, '_')}.ogg`;
        const filePath = `./uploads/audios/${filename}`;
        const webPath = `/uploads/audios/${filename}`;
        
        // Verificar si ya existe el archivo
        if (fs.existsSync(filePath)) {
            let html = `<div class="audio-player">
                <audio controls preload="metadata" style="width: 100%; max-width: 300px;">
                    <source src="${webPath}" type="audio/ogg">
                    Tu navegador no soporta el elemento de audio.
                </audio>
                <div class="audio-info">
                    <small>🎵 Audio del historial</small>
                </div>
            </div>`;
            if (msg.body && msg.body.trim()) {
                html += `<br><span>${msg.body}</span>`;
            }
            return html;
        }
        
        // Intentar descargar el audio
        const media = await msg.downloadMedia();
        
        // Verificar si el media se descargó correctamente
        if (!media || !media.data) {
            registrarLog(`Audio del historial no disponible para descarga: ${messageId}`);
            let html = `<div class="audio-unavailable" style="padding: 12px; background: #f8f9fa; border: 1px dashed #dee2e6; border-radius: 8px; text-align: center; color: #6c757d; margin: 8px 0; max-width: 300px;"><i class="fas fa-microphone" style="font-size: 24px; margin-bottom: 8px; display: block;"></i><strong>🎵 Audio del historial</strong><br><small>Este audio ya no está disponible para descarga</small></div>`;
            if (msg.body && msg.body.trim()) {
                html += `<br><span>${msg.body}</span>`;
            }
            return html;
        }
        
        // Crear directorio si no existe
        const userAudiosDir = './uploads/audios';
        if (!fs.existsSync(userAudiosDir)) {
            fs.mkdirSync(userAudiosDir, { recursive: true });
        }
        
        // Guardar audio
        await new Promise((resolve, reject) => {
            const buffer = Buffer.from(media.data, 'base64');
            fs.writeFile(filePath, buffer, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        registrarLog(`Audio del historial guardado: ${filePath}`);
        
        // Crear HTML
        let html = `<div class="audio-player">
            <audio controls preload="metadata" style="width: 100%; max-width: 300px;">
                <source src="${webPath}" type="audio/ogg">
                Tu navegador no soporta el elemento de audio.
            </audio>
            <div class="audio-info">
                <small>🎵 Audio del historial</small>
            </div>
        </div>`;
        if (msg.body && msg.body.trim()) {
            html += `<br><span>${msg.body}</span>`;
        }
        return html;
        
    } catch (error) {
        registrarLog(`Error procesando audio del historial: ${error.message}`);
        return msg.body ? `🎵 ${msg.body}` : '🎵 Audio';
    }
}

async function processHistoryVideo(msg) {
    try {
        const messageId = msg.id._serialized || msg.id;
        
        // Verificar si es un mensaje reciente (menos de 24 horas)
        const messageTime = msg.timestamp * 1000; // WhatsApp usa segundos
        const now = Date.now();
        const hoursDiff = (now - messageTime) / (1000 * 60 * 60);
        const isRecent = hoursDiff < 24;
        
        registrarLog(`🎬 [HISTORY VIDEO] Procesando video ${messageId}, edad: ${hoursDiff.toFixed(1)} horas, es reciente: ${isRecent}`);
        
        // Usar extensión dinámica basada en el mensaje
        let extension = 'mp4'; // default
        if (msg.mimetype) {
            extension = msg.mimetype.split('/')[1] || 'mp4';
        }
        
        const filename = `history_video_${messageId.replace(/[^a-zA-Z0-9]/g, '_')}.${extension}`;
        const filePath = `./uploads/videos/${filename}`;
        const webPath = `/uploads/videos/${filename}`;
        
        // Verificar si ya existe el archivo
        if (fs.existsSync(filePath)) {
            let html = `<div class="video-player">
                <video controls style="width: 100%; max-width: 300px; border-radius: 8px;">
                    <source src="${webPath}" type="video/${extension}">
                    Tu navegador no soporta el elemento de video.
                </video>
                <div class="video-info">
                    <small>🎥 Video ${isRecent ? 'reciente' : 'del historial'}</small>
                </div>
            </div>`;
            if (msg.body && msg.body.trim()) {
                html += `<br><span>${msg.body}</span>`;
            }
            return html;
        }
        
        // Intentar descargar el video
        registrarLog(`🎬 [HISTORY VIDEO] Intentando descargar video ${messageId}...`);
        const media = await msg.downloadMedia();
        
        // Verificar si el media se descargó correctamente
        if (!media || !media.data) {
            registrarLog(`Video del historial no disponible para descarga: ${messageId}`);
            let html = `<div class="video-unavailable" style="padding: 12px; background: #f8f9fa; border: 1px dashed #dee2e6; border-radius: 8px; text-align: center; color: #6c757d; margin: 8px 0;"><i class="fas fa-video" style="font-size: 24px; margin-bottom: 8px; display: block;"></i><strong>🎥 Video del historial</strong><br><small>Este video ya no está disponible para descarga desde WhatsApp</small></div>`;
            if (msg.body && msg.body.trim()) {
                html += `<br><span>${msg.body}</span>`;
            }
            return html;
        }
        
        // Crear directorio si no existe
        const userVideosDir = './uploads/videos';
        if (!fs.existsSync(userVideosDir)) {
            fs.mkdirSync(userVideosDir, { recursive: true });
        }
        
        // Guardar video
        await new Promise((resolve, reject) => {
            const buffer = Buffer.from(media.data, 'base64');
            fs.writeFile(filePath, buffer, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        registrarLog(`✅ [HISTORY VIDEO] Video guardado exitosamente: ${filePath} (${fs.statSync(filePath).size} bytes)`);
        
        // Crear HTML
        let html = `<div class="video-player">
            <video controls style="width: 100%; max-width: 300px; border-radius: 8px;">
                <source src="${webPath}" type="video/${extension}">
                <source src="${webPath}" type="video/mp4">
                Tu navegador no soporta el elemento de video.
            </video>
            <div class="video-info">
                <small>🎥 Video ${isRecent ? 'reciente' : 'del historial'} • ${media.mimetype || 'video/mp4'}</small>
            </div>
        </div>`;
        if (msg.body && msg.body.trim()) {
            html += `<br><span>${msg.body}</span>`;
        }
        return html;
        
    } catch (error) {
        registrarLog(`Error procesando video del historial: ${error.message}`);
        return msg.body ? `🎥 ${msg.body}` : '🎥 Video';
    }
}

// Endpoint para recuperación tras reconexión - solo interacciones bot-humano del día
app.get('/api/recovery/messages', async (req, res) => {
    try {
        console.log('🔄 [RECOVERY] Iniciando recuperación de mensajes tras reconexión...');
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime();
        
        const recoveredMessages = [];
        
        // Iterar por todos los chats con interacciones bot-humano
        for (const [chatId, mensajes] of mensajesChat.entries()) {
            // Solo procesar chats individuales (no grupos)
            if (chatId.includes('@g.us')) continue;
            
            // Verificar si el chat tiene interacción bot-humano
            const estado = estadosUsuario.get(chatId);
            const tieneInteraccionBotHumano = estado && (
                estado.enEsperaHumano ||
                estado.clienteEncontrado ||
                estado.seguimiento ||
                estado.primeraInteraccion === false // Ha tenido al menos una interacción
            );
            
            if (!tieneInteraccionBotHumano) continue;
            
            // Filtrar mensajes del día de hoy, excluyendo API
            const mensajesHoy = mensajes.filter(msg => {
                const msgDate = new Date(msg.timestamp);
                const esDelDiaActual = msgDate.getTime() >= todayTimestamp;
                const noEsAPI = !msg.isFromAPI;
                return esDelDiaActual && noEsAPI;
            });
            
            if (mensajesHoy.length > 0) {
                recoveredMessages.push({
                    chatId,
                    messages: mensajesHoy,
                    totalRecovered: mensajesHoy.length
                });
                console.log(`🔄 [RECOVERY] Chat ${chatId}: ${mensajesHoy.length} mensajes recuperados`);
            }
        }
        
        console.log(`🔄 [RECOVERY] Completada: ${recoveredMessages.length} chats con mensajes recuperados`);
        
        res.json({
            success: true,
            recoveredChats: recoveredMessages,
            totalChats: recoveredMessages.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [RECOVERY ERROR]', error);
        res.status(500).json({
            success: false,
            message: 'Error en recuperación de mensajes',
            error: error.message
        });
    }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
    try {
        const chatId = req.params.chatId;

        // Parámetros de paginación desde query string
        const offset = parseInt(req.query.offset) || 0;
        const requestedLimit = parseInt(req.query.limit) || 0;

        // Manejo especial para grupos de WhatsApp
        let isGroup = chatId.includes('@g.us');
        let groupLimit = 50; // Límite de mensajes para grupos (evitar sobrecarga)

        if (isGroup) {
            console.log(`🔍 [API MESSAGES] Procesando grupo: ${chatId} (límite: ${groupLimit} mensajes)`);
        }

        // *** NUEVA SOLUCION: Cargar mensajes desde Base de Datos ***
        let allMessages = [];
        let totalMessagesInDB = 0; // Para info de paginación
        let hasMore = false; // Indica si hay más mensajes disponibles

        // 1. PRIMERO: Intentar cargar desde la base de datos
        let conexion = null;
        try {
            const numero_telefono = chatId.replace('@c.us', '').replace('@g.us', '');
            console.log(`💾 [BD] Consultando mensajes para ${numero_telefono} desde base de datos (offset: ${offset})...`);

            // Si se especifica un limit en la petición, usarlo; sino usar el predeterminado
            const limit = requestedLimit > 0 ? requestedLimit : (isGroup ? groupLimit : 100);

            conexion = await mysql.createConnection({
                host: 'localhost',
                user: 'debian-sys-maint',
                password: 'IOHcXunF7795fMRI',
                database: 'solucnet_auth_system'
            });

            // Obtener mensajes con paginación (optimizado sin COUNT separado)
            const [rows] = await conexion.query(
                `SELECT
                    mensaje_id as id,
                    contenido_texto as body,
                    from_me as fromMe,
                    timestamp,
                    tipo_mensaje as type,
                    media_url,
                    media_filename,
                    CASE
                        WHEN from_me = 1 AND leido = 1 THEN 'read'
                        WHEN from_me = 1 AND leido = 0 THEN 'sent'
                        ELSE 'received'
                    END as status
                FROM chat_messages
                WHERE numero_telefono = ?
                ORDER BY timestamp DESC
                LIMIT ? OFFSET ?`,
                [numero_telefono, limit, offset]
            );

            // Solo hacer COUNT si es la primera página (offset 0) para saber el total
            if (offset === 0) {
                const [countResult] = await conexion.query(
                    `SELECT COUNT(*) as total FROM chat_messages WHERE numero_telefono = ?`,
                    [numero_telefono]
                );
                totalMessagesInDB = countResult[0]?.total || 0;
            } else {
                // Para páginas siguientes, estimar basado en que hay más
                totalMessagesInDB = offset + limit + 50; // Estimación conservadora
            }

            // Calcular si hay más mensajes disponibles (si recibimos el límite completo, probablemente hay más)
            hasMore = rows.length === limit;

            console.log(`📊 [BD] Total mensajes: ${totalMessagesInDB}, Cargando: ${rows.length}, Offset: ${offset}, Hay más: ${hasMore}`);

            if (rows && rows.length > 0) {
                // Convertir formato de BD al formato esperado por el frontend
                allMessages = rows.map(row => {
                    let body = row.body || '';
                    let mediaUrl = null;

                    // Si hay media, guardar la URL y mantener body solo con el texto
                    if (row.media_url) {
                        mediaUrl = row.media_url;

                        // Para video y documento, usar un emoji descriptivo
                        if (row.type === 'video') {
                            mediaUrl = null; // No procesamos video por ahora
                            body = `🎥 ${row.media_filename || 'Video'}`;
                        } else if (row.type === 'document') {
                            mediaUrl = null; // No procesamos documentos por ahora
                            body = `📄 ${row.media_filename || 'Documento'}`;
                        }
                        // Para imagen y audio, mantener el texto original en body
                    }

                    return {
                        id: row.id,
                        body: body,
                        fromMe: row.fromMe === 1,
                        timestamp: row.timestamp,
                        status: row.status,
                        type: row.type || 'text',
                        hasMedia: row.media_url ? true : false,
                        mediaUrl: mediaUrl,
                        filename: row.media_filename,
                        isFromAPI: false // Los de la BD no son de API
                    };
                }).reverse(); // Invertir para orden cronológico (más antiguos primero)

                console.log(`✅ [BD] ${allMessages.length} mensajes cargados desde base de datos`);
                console.log(`   📅 Rango: ${new Date(allMessages[0].timestamp).toLocaleString()} - ${new Date(allMessages[allMessages.length - 1].timestamp).toLocaleString()}`);
            } else {
                console.log(`⚠️ [BD] No se encontraron mensajes en BD para ${numero_telefono}`);
            }
        } catch (dbError) {
            console.error(`❌ [BD ERROR] Error consultando base de datos:`, dbError.message);
            console.error(dbError.stack);
            // Si falla la BD, continuar con WhatsApp como fallback
        } finally {
            // Asegurar que se cierre la conexión
            if (conexion) {
                try {
                    await conexion.end();
                } catch (closeError) {
                    console.error('Error cerrando conexión BD:', closeError.message);
                }
            }
        }

        // 2. FALLBACK: Si no hay mensajes en BD, cargar desde WhatsApp
        if (allMessages.length === 0) {
            console.log(`🔄 [FALLBACK] Cargando desde WhatsApp ya que BD no tiene mensajes...`);
        
        // 1. Primero intentar obtener mensajes desde WhatsApp (historial completo)
        if (whatsappListo && client) {
            try {
                console.log(`🔍 [API MESSAGES] Obteniendo historial completo de WhatsApp para ${chatId}...`);
                
                // Obtener el chat desde WhatsApp
                const chat = await client.getChatById(chatId);
                
                if (chat) {
                    // Obtener mensajes con límite dinámico (50 para grupos, 100 para chats individuales)
                    const limit = isGroup ? groupLimit : 100;
                    const whatsappMessages = await chat.fetchMessages({ limit: limit });
                    
                    console.log(`📚 [WHATSAPP HISTORY] ${whatsappMessages.length} mensajes obtenidos desde WhatsApp`);
                    
                    // Convertir mensajes de WhatsApp al formato de la aplicación
                    const convertedMessages = await Promise.all(whatsappMessages.map(async (msg, index) => {
                        let messageBody = msg.body || '';
                        
                        // Procesar mensajes de media - mantener solo el caption si existe
                        if (msg.hasMedia) {
                            if (msg.type === 'image') {
                                // Para imágenes del historial, intentar descargar si no existe ya
                                messageBody = await processHistoryImage(msg);
                            } else if (msg.type === 'audio' || msg.type === 'ptt') {
                                messageBody = await processHistoryAudio(msg);
                            } else if (msg.type === 'video') {
                                messageBody = await processHistoryVideo(msg);
                            } else if (msg.type === 'document') {
                                messageBody = messageBody ? `📄 ${messageBody}` : '📄 Documento';
                            } else {
                                messageBody = `📎 ${msg.type}`;
                            }
                            
                            // Si hay caption, agregarlo
                            if (msg.body && msg.body.trim()) {
                                messageBody += `: ${msg.body}`;
                            }
                        }
                        
                        const isFromAPI = msg.fromMe && esMensajeDeAPI(chatId, messageBody);
                        if (msg.fromMe) {
                            console.log(`🔍 [MSG BUILD] Mensaje propio: "${messageBody.substring(0, 30)}" - isFromAPI: ${isFromAPI}`);
                        }
                        return {
                            id: msg.id._serialized || `whatsapp_${msg.timestamp}_${index}`,
                            body: messageBody,
                            fromMe: msg.fromMe,
                            timestamp: msg.timestamp * 1000, // WhatsApp usa segundos, convertir a milisegundos
                            status: msg.fromMe ? (msg.ack === 3 ? 'read' : msg.ack === 2 ? 'delivered' : 'sent') : 'received',
                            type: msg.type || 'text',
                            hasMedia: msg.hasMedia || false,
                            isFromAPI: isFromAPI
                        };
                    }));
                    
                    // Ordenar por timestamp (más antiguos primero)
                    allMessages = convertedMessages.sort((a, b) => a.timestamp - b.timestamp);
                    
                    console.log(`✅ [WHATSAPP HISTORY] ${allMessages.length} mensajes convertidos y ordenados`);
                    
                    // Guardar en cache para futuras consultas rápidas
                    if (!mensajesChat.has(chatId)) {
                        mensajesChat.set(chatId, []);
                    }
                    
                    // PRESERVAR mensajes del cache local (incluye mensajes manuales)
                    const cacheMessages = mensajesChat.get(chatId);

                    // SOLUCIÓN CONSERVADORA: Preservar TODOS los mensajes del cache + WhatsApp sin duplicar

                    // 1. Separar mensajes enviados recientes del cache (últimas 1 hora) - más conservador
                    const tiempoLimite = Date.now() - (1 * 60 * 60 * 1000); // 1 hora atrás
                    const mensajesEnviadosRecientes = cacheMessages.filter(msg =>
                        msg.fromMe && msg.timestamp > tiempoLimite
                    );

                    // 2. Combinar TODOS los mensajes de WhatsApp con los enviados recientes
                    const todosLosMensajes = [...allMessages];

                    // 3. Agregar mensajes enviados del cache que no estén en WhatsApp
                    mensajesEnviadosRecientes.forEach(cacheMsg => {
                        const yaExisteEnWhatsApp = allMessages.find(whatsMsg =>
                            // Comparación más flexible para mensajes enviados
                            whatsMsg.fromMe === true &&
                            (whatsMsg.body === cacheMsg.body ||
                             Math.abs(whatsMsg.timestamp - cacheMsg.timestamp) < 10000) // 10 segundos de tolerancia
                        );

                        if (!yaExisteEnWhatsApp) {
                            console.log(`📤 [PRESERVE] Preservando mensaje enviado: "${cacheMsg.body.substring(0, 30)}"`);
                            todosLosMensajes.push(cacheMsg);
                        }
                    });

                    // 4. Agregar otros mensajes del cache que no sean enviados (por si acaso)
                    const otrosMensajesCache = cacheMessages.filter(msg => !msg.fromMe);
                    otrosMensajesCache.forEach(cacheMsg => {
                        const yaExisteEnWhatsApp = allMessages.find(whatsMsg =>
                            whatsMsg.id === cacheMsg.id ||
                            (Math.abs(whatsMsg.timestamp - cacheMsg.timestamp) < 2000 &&
                             whatsMsg.body === cacheMsg.body)
                        );

                        if (!yaExisteEnWhatsApp) {
                            todosLosMensajes.push(cacheMsg);
                        }
                    });

                    // 5. Ordenar por timestamp y usar como resultado
                    todosLosMensajes.sort((a, b) => a.timestamp - b.timestamp);
                    allMessages = todosLosMensajes;
                    
                    console.log(`💾 [CACHE] Cache actualizado preservando mensajes manuales: ${allMessages.length} mensajes totales`);
                } else {
                    console.log(`⚠️ [WHATSAPP] Chat ${chatId} no encontrado en WhatsApp`);
                }
                
            } catch (whatsappError) {
                console.error(`❌ [WHATSAPP ERROR] Error obteniendo historial desde WhatsApp:`, whatsappError.message);
                // Continuar con mensajes en cache si WhatsApp falla
            }
        } else {
            console.log(`⚠️ [WHATSAPP] Cliente no listo para obtener historial. whatsappListo: ${whatsappListo}, client: ${!!client}`);
        }

            // 3. Si aún no hay mensajes desde WhatsApp, usar los mensajes en cache
            if (allMessages.length === 0) {
                allMessages = mensajesChat.get(chatId) || [];
                console.log(`📋 [CACHE FALLBACK] Usando mensajes en cache: ${allMessages.length} mensajes`);
            }
        } // Cierre del if (allMessages.length === 0) del fallback a WhatsApp

        // Filtrar mensajes de API antes de enviar al chat web
        const filteredMessages = allMessages.filter(msg => !msg.isFromAPI);
        const apiMessagesCount = allMessages.length - filteredMessages.length;

        console.log(`📋 [API MESSAGES FINAL] Enviando ${filteredMessages.length} mensajes para ${chatId} (${apiMessagesCount} mensajes de API filtrados)`);

        // Log de los mensajes para debugging (mostrar primeros y últimos)
        if (filteredMessages.length > 0) {
            const firstMsg = filteredMessages[0];
            const lastMsg = filteredMessages[filteredMessages.length - 1];
            console.log(`   📅 Primer mensaje: ${new Date(firstMsg.timestamp).toLocaleString()} - ${firstMsg.fromMe ? 'OUT' : 'IN'}: "${firstMsg.body.substring(0, 30)}"`);
            console.log(`   📅 Último mensaje: ${new Date(lastMsg.timestamp).toLocaleString()} - ${lastMsg.fromMe ? 'OUT' : 'IN'}: "${lastMsg.body.substring(0, 30)}"`);
            console.log(`   📊 Total: ${filteredMessages.filter(m => m.fromMe).length} enviados, ${filteredMessages.filter(m => !m.fromMe).length} recibidos`);
        }

        res.json({
            success: true,
            messages: filteredMessages,
            total: filteredMessages.length,
            totalInDB: totalMessagesInDB,
            hasMore: hasMore,
            offset: offset,
            source: totalMessagesInDB > 0 ? 'database' : (allMessages.length > (mensajesChat.get(chatId) || []).length ? 'whatsapp' : 'cache'),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [API MESSAGES ERROR]', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo mensajes',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para buscar mensajes en toda la base de datos
app.get('/api/chats/:chatId/search', async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const searchTerm = req.query.q || '';
        const limit = parseInt(req.query.limit) || 50;

        if (!searchTerm || searchTerm.trim().length < 2) {
            return res.json({
                success: true,
                messages: [],
                total: 0,
                searchTerm: searchTerm
            });
        }

        const numero_telefono = chatId.replace('@c.us', '').replace('@g.us', '');
        console.log(`🔍 [SEARCH] Buscando "${searchTerm}" en mensajes de ${numero_telefono}...`);

        let conexion = null;
        let results = [];

        try {
            conexion = await mysql.createConnection({
                host: 'localhost',
                user: 'debian-sys-maint',
                password: 'IOHcXunF7795fMRI',
                database: 'solucnet_auth_system'
            });

            // Buscar en el contenido de los mensajes
            const [rows] = await conexion.query(
                `SELECT
                    mensaje_id as id,
                    contenido_texto as body,
                    from_me as fromMe,
                    timestamp,
                    tipo_mensaje as type,
                    media_url,
                    media_filename,
                    CASE
                        WHEN from_me = 1 AND leido = 1 THEN 'read'
                        WHEN from_me = 1 AND leido = 0 THEN 'sent'
                        ELSE 'received'
                    END as status
                FROM chat_messages
                WHERE numero_telefono = ?
                AND contenido_texto LIKE ?
                ORDER BY timestamp DESC
                LIMIT ?`,
                [numero_telefono, `%${searchTerm}%`, limit]
            );

            if (rows && rows.length > 0) {
                results = rows.map(row => {
                    let body = row.body || '';
                    let mediaUrl = null;

                    if (row.media_url) {
                        mediaUrl = row.media_url;

                        if (row.type === 'video') {
                            mediaUrl = null;
                            body = `🎥 ${row.media_filename || 'Video'}`;
                        } else if (row.type === 'document') {
                            mediaUrl = null;
                            body = `📄 ${row.media_filename || 'Documento'}`;
                        }
                    }

                    return {
                        id: row.id,
                        body: body,
                        fromMe: row.fromMe === 1,
                        timestamp: row.timestamp,
                        status: row.status,
                        type: row.type || 'text',
                        hasMedia: row.media_url ? true : false,
                        mediaUrl: mediaUrl,
                        filename: row.media_filename,
                        isFromAPI: false
                    };
                });
            }

            console.log(`✅ [SEARCH] ${results.length} resultados encontrados`);
        } catch (dbError) {
            console.error(`❌ [SEARCH ERROR]`, dbError.message);
        } finally {
            if (conexion) {
                try {
                    await conexion.end();
                } catch (closeError) {
                    console.error('Error cerrando conexión BD:', closeError.message);
                }
            }
        }

        res.json({
            success: true,
            messages: results,
            total: results.length,
            searchTerm: searchTerm,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ [API SEARCH ERROR]', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint específico para cargar más mensajes históricos
app.get('/api/chats/:chatId/history', async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const limit = parseInt(req.query.limit) || 50;
        const includeAll = req.query.includeAll === 'true';
        
        // Ignorar solicitudes para grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.json({
                success: true,
                messages: [],
                total: 0,
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`🔍 [HISTORY] Obteniendo historial extendido para ${chatId}, limit: ${includeAll ? 'ALL' : limit}`);
        
        let allMessages = [];
        
        if (whatsappListo && client) {
            try {
                const chat = await client.getChatById(chatId);
                
                if (chat) {
                    // Limitar a 50 mensajes máximo por chat (includeAll ahora también respeta este límite)
                    const fetchLimit = Math.min(includeAll ? 50 : limit, 50);
                    const whatsappMessages = await chat.fetchMessages({ limit: fetchLimit });
                    
                    console.log(`📚 [EXTENDED HISTORY] ${whatsappMessages.length} mensajes obtenidos desde WhatsApp (límite: ${fetchLimit})`);
                    
                    // Convertir mensajes con más detalle
                    allMessages = await Promise.all(whatsappMessages.map(async (msg, index) => {
                        let messageBody = msg.body || '';
                        let messageType = 'text';
                        
                        // Procesar diferentes tipos de mensajes
                        if (msg.hasMedia) {
                            messageType = msg.type;
                            switch (msg.type) {
                                case 'image':
                                    messageBody = await processHistoryImage(msg);
                                    break;
                                case 'audio':
                                case 'ptt':
                                    messageBody = await processHistoryAudio(msg);
                                    break;
                                case 'video':
                                    messageBody = await processHistoryVideo(msg);
                                    break;
                                case 'document':
                                    messageBody = messageBody ? `📄 Documento: ${messageBody}` : '📄 Documento';
                                    break;
                                case 'sticker':
                                    messageBody = '😀 Sticker';
                                    break;
                                default:
                                    messageBody = messageBody ? `📎 ${msg.type}: ${messageBody}` : `📎 ${msg.type}`;
                            }
                        }
                        
                        // Manejar mensajes del sistema
                        if (msg.type === 'system') {
                            messageBody = `🔔 ${messageBody}`;
                            messageType = 'system';
                        }
                        
                        return {
                            id: msg.id._serialized || `whatsapp_${msg.timestamp}_${index}`,
                            body: messageBody,
                            fromMe: msg.fromMe,
                            timestamp: msg.timestamp * 1000,
                            status: msg.fromMe ? (msg.ack === 3 ? 'read' : msg.ack === 2 ? 'delivered' : 'sent') : 'received',
                            type: messageType,
                            hasMedia: msg.hasMedia || false,
                            isForwarded: msg.isForwarded || false,
                            author: msg.author || null
                        };
                    }));
                    
                    // Ordenar cronológicamente (más antiguos primero)
                    allMessages.sort((a, b) => a.timestamp - b.timestamp);
                    
                    console.log(`✅ [EXTENDED HISTORY] ${allMessages.length} mensajes históricos procesados`);
                    
                    // Actualizar cache principal
                    if (!mensajesChat.has(chatId)) {
                        mensajesChat.set(chatId, []);
                    }
                    
                    const cacheMessages = mensajesChat.get(chatId);
                    let newMessagesAdded = 0;
                    
                    allMessages.forEach(histMsg => {
                        const exists = cacheMessages.find(cacheMsg => 
                            cacheMsg.id === histMsg.id ||
                            (Math.abs(cacheMsg.timestamp - histMsg.timestamp) < 2000 && 
                             cacheMsg.body === histMsg.body && 
                             cacheMsg.fromMe === histMsg.fromMe)
                        );
                        
                        if (!exists) {
                            cacheMessages.push(histMsg);
                            newMessagesAdded++;
                        }
                    });
                    
                    // Re-ordenar cache
                    cacheMessages.sort((a, b) => a.timestamp - b.timestamp);
                    
                    console.log(`💾 [CACHE UPDATE] ${newMessagesAdded} nuevos mensajes agregados al cache (total: ${cacheMessages.length})`);
                    
                } else {
                    console.log(`⚠️ [HISTORY] Chat ${chatId} no encontrado en WhatsApp`);
                }
                
            } catch (error) {
                console.error(`❌ [HISTORY ERROR] Error obteniendo historial extendido:`, error.message);
                throw error;
            }
        } else {
            // Fallback al cache
            allMessages = mensajesChat.get(chatId) || [];
            console.log(`📋 [HISTORY CACHE] Usando cache local: ${allMessages.length} mensajes`);
        }
        
        // Filtrar mensajes de API antes de enviar al chat web
        const filteredMessages = allMessages.filter(msg => !msg.isFromAPI);
        const apiMessagesCount = allMessages.length - filteredMessages.length;

        console.log(`📋 [HISTORY FINAL] Enviando ${filteredMessages.length} mensajes históricos para ${chatId} (${apiMessagesCount} mensajes de API filtrados)`);

        res.json({
            success: true,
            messages: filteredMessages,
            total: filteredMessages.length,
            limit: includeAll ? 'unlimited' : limit,
            source: whatsappListo ? 'whatsapp' : 'cache',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [HISTORY ENDPOINT ERROR]', error);
        res.status(500).json({
            success: false,
            message: 'Error obteniendo historial extendido',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para enviar mensaje a un chat (requiere autenticación)
// ===== ENDPOINT DE RENDIMIENTO =====
app.get('/api/performance', requireAuth, (req, res) => {
    try {
        const stats = performanceMonitor.getStatsForAPI();
        res.json({
            success: true,
            performance: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estadísticas de rendimiento'
        });
    }
});

app.post('/api/send-message', requireAuth, async (req, res) => {
    try {
        const { chatId, message, delay, skipDelay, skipRateLimit, priority } = req.body;

        console.log(`🌐 [HTTP] POST /api/send-message recibido - Chat: ${chatId}, Mensaje: "${message}"`);
        console.log(`🔍 [DEBUG PARAMS] skipDelay=${skipDelay}, delay=${delay}, priority=${priority}`);

        if (!chatId || !message) {
            return res.status(400).json({
                success: false,
                message: 'chatId y message son requeridos'
            });
        }

        if (!whatsappListo) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp no está conectado'
            });
        }

        // ===== FILTRO ANTI-DUPLICADOS: Evitar enviar mensajes repetidos el mismo día =====
        // Solo verificar para mensajes de API externa (delay presente o skipDelay=false)
        const esAPIExternaCheck = !skipDelay;
        if (esAPIExternaCheck) {
            try {
                const [mensajesHoy] = await dbPool.execute(
                    `SELECT id, estado, fecha_envio FROM cola_mensajes_api
                     WHERE chat_id = ? AND DATE(fecha_creacion) = CURDATE()
                     AND estado = 'enviado'
                     LIMIT 1`,
                    [chatId]
                );

                if (mensajesHoy.length > 0) {
                    const msgExistente = mensajesHoy[0];
                    console.log(`🚫 [ANTI-DUPLICADO] Mensaje rechazado para ${chatId} - Ya recibió mensaje hoy (ID: ${msgExistente.id} a las ${msgExistente.fecha_envio})`);
                    return res.status(409).json({
                        success: false,
                        message: 'Este número ya recibió un mensaje hoy',
                        error: 'DUPLICATE_MESSAGE',
                        existingMessageId: msgExistente.id,
                        sentAt: msgExistente.fecha_envio,
                        timestamp: new Date().toISOString()
                    });
                }

                console.log(`✅ [ANTI-DUPLICADO] ${chatId} no ha recibido mensaje hoy - Permitiendo envío`);
            } catch (error) {
                console.error(`❌ [ANTI-DUPLICADO] Error verificando duplicados: ${error.message}`);
                // Si falla la verificación, permitir el envío (fail-safe)
            }
        }

        // ===== VERIFICAR FRECUENCIA DE MENSAJES API =====
        // skipRateLimit permite omitir la verificación para mensajes urgentes
        const frecuenciaCheck = verificarFrecuenciaAPI(chatId, skipRateLimit || priority === 'high');
        if (!frecuenciaCheck.allowed) {
            return res.status(429).json({
                success: false,
                message: frecuenciaCheck.reason,
                error: 'RATE_LIMIT_EXCEEDED',
                retryAfter: frecuenciaCheck.retryAfter,
                currentCount: frecuenciaCheck.count,
                limit: frecuenciaCheck.limit
            });
        }

        // ===== VERIFICAR SI PODEMOS ENVIAR DIRECTAMENTE O ENCOLAR =====
        const puedeEnviar = verificarLimiteDiario();

        if (!puedeEnviar && priority !== 'high') {
            // Si no podemos enviar directamente, agregar a cola
            const messageId = agregarMensajeACola('text', {
                chatId: chatId,
                message: message
            }, priority || 'normal');

            if (messageId) {
                res.json({
                    success: true,
                    message: 'Mensaje agregado a cola de envío',
                    queued: true,
                    messageId: messageId,
                    queuePosition: messageQueue.queue.length,
                    estimatedTime: messageQueue.queue.length * 2, // segundos estimados
                    timestamp: new Date().toISOString()
                });
            } else {
                res.status(503).json({
                    success: false,
                    message: 'Cola llena. Intenta más tarde.',
                    error: 'QUEUE_FULL'
                });
            }
            return;
        }

        // ===== DELAY ALEATORIO SOLO PARA MENSAJES DE API EXTERNA =====
        // Mensajes del panel web manual NO tienen delay (para respuesta rápida)
        // Solo aplicar delay si viene con parámetro delay explícito (API externa)
        if (!skipDelay && priority !== 'high' && delay) {
            const delayMinimo = delay || 1000; // Mínimo 1 segundo para API externa
            const delayAleatorio = delayMinimo + Math.random() * 2000; // 1-3 segundos
            console.log(`⏱️ [API DELAY] Aplicando delay humano de ${Math.round(delayAleatorio)}ms antes de enviar mensaje API externa`);
            await new Promise(resolve => setTimeout(resolve, delayAleatorio));
        } else if (!delay) {
            // Mensaje del panel web: delay mínimo solo para simular typing (muy rápido)
            const delayRapido = 100 + Math.random() * 200; // 0.1-0.3 segundos
            console.log(`⚡ [PANEL WEB] Delay mínimo de ${Math.round(delayRapido)}ms para mensaje manual`);
            await new Promise(resolve => setTimeout(resolve, delayRapido));
        } else {
            console.log(`⚡ [API FAST] Mensaje de alta prioridad, omitiendo delay`);
        }

        // Usar simulación rápida si viene skipDelay (mensajes del panel web)
        const esAPIExterna = !skipDelay; // Si skipDelay=true, NO es API externa (es panel web)
        console.log(`🔍 [DEBUG FAILSAFE] esAPIExterna=${esAPIExterna}, skipDelay=${skipDelay}`);

        // ===== FAILSAFE: Si es API externa, guardar INMEDIATAMENTE en BD antes de intentar envío =====
        let messageIdBD = null;
        if (esAPIExterna) {
            try {
                const [result] = await dbPool.execute(
                    `INSERT INTO cola_mensajes_api (chat_id, mensaje, tipo_mensaje, estado, intentos)
                     VALUES (?, ?, 'text', 'procesando', 0)`,
                    [chatId, message]
                );
                messageIdBD = result.insertId;
                console.log(`💾 [API FAILSAFE] Mensaje guardado en BD (id=${messageIdBD}) ANTES de intentar envío`);
            } catch (error) {
                console.error(`❌ [API FAILSAFE] Error guardando en BD: ${error.message}`);
            }
        }

        const exito = await enviarMensaje(chatId, message, null, esAPIExterna);

        if (exito) {
            // Si se envió exitosamente y está en BD, actualizar estado a 'enviado'
            if (messageIdBD) {
                try {
                    await dbPool.execute(
                        `UPDATE cola_mensajes_api SET estado = 'enviado', fecha_envio = NOW() WHERE id = ?`,
                        [messageIdBD]
                    );
                    console.log(`✅ [API FAILSAFE] Mensaje BD id=${messageIdBD} marcado como enviado`);
                } catch (error) {
                    console.error(`❌ [API FAILSAFE] Error actualizando BD: ${error.message}`);
                }
            }

            res.json({
                success: true,
                message: 'Mensaje enviado correctamente',
                queued: false,
                messageIdBD: messageIdBD,
                timestamp: new Date().toISOString(),
                rateLimit: {
                    messagesInHour: frecuenciaCheck.count || 'N/A',
                    limit: frecuenciaCheck.limit || apiMessageControl.maxPerChat,
                    remaining: frecuenciaCheck.count ? (frecuenciaCheck.limit - frecuenciaCheck.count) : 'N/A'
                }
            });
        } else {
            // Si falló, el mensaje YA está en BD (guardado arriba) con estado 'procesando'
            // O fue encolado por enviarMensaje() si no es API externa
            // El procesador automático lo reintentará cada 30 segundos
            if (messageIdBD) {
                // Actualizar estado a 'pendiente' para que el procesador lo retome
                try {
                    await dbPool.execute(
                        `UPDATE cola_mensajes_api SET estado = 'pendiente' WHERE id = ?`,
                        [messageIdBD]
                    );
                    console.log(`⚠️ [API FAILSAFE] Mensaje BD id=${messageIdBD} marcado como pendiente para reintento`);
                } catch (error) {
                    console.error(`❌ [API FAILSAFE] Error actualizando BD: ${error.message}`);
                }
            }

            res.json({
                success: true,
                message: 'Mensaje encolado para envío posterior',
                queued: true,
                messageIdBD: messageIdBD,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error procesando solicitud',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para consultar estado de la cola
app.get('/api/queue-status', requireAuth, (req, res) => {
    try {
        res.json({
            success: true,
            queue: {
                length: messageQueue.queue.length,
                processing: messageQueue.processing,
                maxSize: messageQueue.maxQueueSize,
                remaining: messageQueue.maxQueueSize - messageQueue.queue.length,
                processInterval: messageQueue.processInterval,
                estimatedProcessTime: messageQueue.queue.length * (messageQueue.processInterval / 1000) // en segundos
            },
            pendingQueue: {
                length: colaMensajesPendientes.cola.length,
                processing: colaMensajesPendientes.procesando,
                maxSize: colaMensajesPendientes.maxCola,
                remaining: colaMensajesPendientes.maxCola - colaMensajesPendientes.cola.length,
                stats: colaMensajesPendientes.stats
            },
            limits: {
                hourly: {
                    current: dailyMessageLimit.messagesPerHour,
                    max: dailyMessageLimit.maxPerHour,
                    remaining: dailyMessageLimit.maxPerHour - dailyMessageLimit.messagesPerHour
                },
                daily: {
                    current: dailyMessageLimit.counter,
                    max: dailyMessageLimit.maxPerDay,
                    remaining: dailyMessageLimit.maxPerDay - dailyMessageLimit.counter
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error obteniendo estado de cola',
            error: error.message
        });
    }
});

// Endpoint para enviar audio (requiere autenticación)
app.post('/api/send-audio', requireAuth, multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo para audio
    fileFilter: (req, file, cb) => {
        // Aceptar archivos de audio y WebM
        if (file.mimetype.startsWith('audio/') || file.mimetype.includes('webm')) {
            console.log('✅ Archivo aceptado:', file.mimetype);
            cb(null, true);
        } else {
            console.error('❌ Archivo rechazado:', file.mimetype);
            cb(new Error(`Solo se permiten archivos de audio. Recibido: ${file.mimetype}`));
        }
    }
}).single('audio'), (req, res, next) => {
    // Handler de errores de multer
    if (req.multerError) {
        console.error('❌ Error de multer:', req.multerError);
        return res.status(400).json({
            success: false,
            message: `Error de multer: ${req.multerError.message}`
        });
    }
    next();
}, async (req, res) => {
    try {
        console.log('📥 Solicitud POST /api/send-audio recibida');
        console.log('📊 Headers:', {
            'content-type': req.headers['content-type']?.substring(0, 50),
            'content-length': req.headers['content-length'],
            'user-agent': req.headers['user-agent']?.substring(0, 50),
            'authorization': req.headers['authorization'] ? 'PRESENTE' : 'AUSENTE'
        });
        
        console.log('🔍 Multer file processing result:', {
            fileReceived: !!req.file,
            bodyData: Object.keys(req.body)
        });

        const { chatId } = req.body;
        const audioFile = req.file;

        console.log('📋 Datos recibidos:', {
            chatId: chatId,
            audioFile: audioFile ? {
                filename: audioFile.filename,
                originalname: audioFile.originalname,
                mimetype: audioFile.mimetype,
                size: audioFile.size,
                path: audioFile.path
            } : 'null'
        });

        // Validaciones
        if (!chatId || !audioFile) {
            return res.status(400).json({
                success: false,
                message: 'chatId y archivo de audio son requeridos'
            });
        }

        if (!whatsappListo) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp no está conectado'
            });
        }

        // Crear MessageMedia desde el archivo de audio
        const { MessageMedia } = require('whatsapp-web.js');
        const fs = require('fs');

        // Convertir WebM a OGG para mejor compatibilidad con WhatsApp
        let finalAudioPath = audioFile.path;
        
        if (audioFile.mimetype.includes('webm')) {
            const path = require('path');
            const { execSync } = require('child_process');
            
            const oggPath = audioFile.path.replace(path.extname(audioFile.path), '.ogg');
            
            try {
                console.log('🔄 Convirtiendo WebM a OGG para compatibilidad WhatsApp...');
                
                // Usar FFmpeg para convertir WebM a OGG
                execSync(`ffmpeg -i "${audioFile.path}" -c:a libopus -b:a 64k "${oggPath}"`, {
                    timeout: 30000 // 30 segundos timeout
                });
                
                finalAudioPath = oggPath;
                console.log('✅ Audio convertido a OGG:', oggPath);
                
            } catch (conversionError) {
                console.warn('⚠️ Error convirtiendo audio, usando original:', conversionError.message);
                // Si falla la conversión, usar el archivo original
            }
        }
        
        console.log('🎵 Preparando archivo de audio:', {
            originalPath: audioFile.path,
            finalPath: finalAudioPath,
            mimetype: audioFile.mimetype
        });

        // Crear MessageMedia
        const media = MessageMedia.fromFilePath(finalAudioPath);

        // ===== DELAY ALEATORIO PARA AUDIO API (5-12 SEGUNDOS) =====
        const { skipDelay, priority } = req.body;
        if (!skipDelay && priority !== 'high') {
            const delayAudio = 5000 + Math.random() * 7000; // 5-12 segundos
            console.log(`⏱️ [API AUDIO DELAY] Aplicando delay humano de ${Math.round(delayAudio)}ms antes de enviar audio`);
            await new Promise(resolve => setTimeout(resolve, delayAudio));
        } else {
            console.log(`⚡ [API AUDIO FAST] Audio de alta prioridad, omitiendo delay`);
        }

        // Enviar el audio
        console.log('📤 Enviando audio a:', chatId);
        const exito = await enviarMensaje(chatId, media, finalAudioPath, true);

        if (exito) {
            console.log('✅ Audio enviado exitosamente a:', chatId);
            
            // Conservar archivos de audio permanentemente
            console.log('💾 Archivos de audio conservados permanentemente:', {
                original: audioFile.path,
                final: finalAudioPath
            });

            res.json({
                success: true,
                message: 'Audio enviado correctamente',
                chatId: chatId,
                filename: audioFile.originalname,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Error enviando audio'
            });
        }

    } catch (error) {
        console.error('❌ Error en /api/send-audio:', error);
        
        // Conservar archivos incluso en caso de error (para debugging)
        if (req.file && req.file.path) {
            console.log('💾 Archivo conservado incluso con error:', req.file.path);
        }

        res.status(500).json({
            success: false,
            message: 'Error procesando audio',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para enviar archivos (requiere autenticación)
app.post('/api/send-files', requireAuth, multer({storage: storage, limits: {fileSize: 50 * 1024 * 1024, files: 10}}).array('files', 10), async (req, res) => {
    try {
        console.log('📥 Solicitud POST /api/send-files recibida');
        console.log('📊 Headers:', {
            authorization: req.headers.authorization ? 'Bearer token presente' : 'Sin token',
            'content-type': req.headers['content-type']
        });
        const { chatId, caption } = req.body;
        const files = req.files;
        
        if (!chatId) {
            return res.status(400).json({
                success: false,
                error: 'Chat ID es requerido'
            });
        }
        
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No se recibieron archivos'
            });
        }
        
        if (!whatsappListo) {
            console.log('⚠️ Solicitud rechazada: WhatsApp no está listo');
            console.log('📊 Estado actual:', { whatsappListo, whatsappEstabilizado });
            return res.status(503).json({
                success: false,
                error: 'WhatsApp no está conectado. Estado: whatsappListo=false',
                status: { whatsappListo, whatsappEstabilizado }
            });
        }

        if (!whatsappEstabilizado) {
            console.log('⚠️ Solicitud rechazada: WhatsApp se está estabilizando');
            console.log('📊 Estado actual:', { whatsappListo, whatsappEstabilizado });
            return res.status(503).json({
                success: false,
                error: 'WhatsApp se está estabilizando. Espere unos momentos e intente nuevamente.',
                isWhatsAppError: true,
                status: { whatsappListo, whatsappEstabilizado }
            });
        }
        
        registrarLog(`Enviando ${files.length} archivo(s) a ${chatId}`);
        
        let successCount = 0;
        let errors = [];
        
        // Enviar cada archivo
        for (const file of files) {
            try {
                const media = MessageMedia.fromFilePath(file.path);

                // Configurar nombre del archivo si es necesario
                if (file.originalname) {
                    media.filename = file.originalname;
                }

                // Log específico para archivos de audio
                if (file.originalname && (file.originalname.includes('.m4a') || file.originalname.includes('.wav') || file.originalname.includes('.ogg') || file.originalname.includes('grabado'))) {
                    console.log(`🎵 Procesando archivo de audio: ${file.originalname}`);
                    console.log(`🎵 Tamaño del archivo: ${file.size} bytes`);
                    console.log(`🎵 Tipo MIME: ${file.mimetype}`);
                    console.log(`🎵 Ruta del archivo: ${file.path}`);
                }

                // Log antes de enviar
                if (file.originalname && (file.originalname.includes('.m4a') || file.originalname.includes('.wav') || file.originalname.includes('.ogg') || file.originalname.includes('grabado'))) {
                    console.log(`🎵 Intentando enviar audio a ${chatId}...`);
                }

                // ===== DELAY ALEATORIO PARA ARCHIVOS API (5-12 SEGUNDOS) =====
                const { skipDelay: skipFileDelay, priority: filePriority } = req.body;
                if (!skipFileDelay && filePriority !== 'high') {
                    const delayArchivo = 5000 + Math.random() * 7000; // 5-12 segundos
                    console.log(`⏱️ [API FILE DELAY] Aplicando delay humano de ${Math.round(delayArchivo)}ms antes de enviar archivo`);
                    await new Promise(resolve => setTimeout(resolve, delayArchivo));
                } else {
                    console.log(`⚡ [API FILE FAST] Archivo de alta prioridad, omitiendo delay`);
                }

                const success = await enviarMensaje(chatId, media, file.path, true);

                // Log después de enviar
                if (file.originalname && (file.originalname.includes('.m4a') || file.originalname.includes('.wav') || file.originalname.includes('.ogg') || file.originalname.includes('grabado'))) {
                    console.log(`🎵 Resultado del envío: ${success ? '✅ Éxito' : '❌ Falló'}`);
                }
                
                if (success) {
                    successCount++;
                    registrarLog(`Archivo enviado: ${file.originalname}`);
                } else {
                    errors.push(`Error enviando ${file.originalname}`);
                }
                
                // Pequeña pausa entre archivos para evitar spam
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                let errorMessage = `Error enviando ${file.originalname}: ${error.message}`;
                registrarLog(errorMessage);

                // Manejo específico para archivos de audio
                const isAudioFile = file.originalname && (file.originalname.includes('.m4a') || file.originalname.includes('.wav') || file.originalname.includes('.ogg') || file.originalname.includes('.webm'));

                if (isAudioFile) {
                    console.log(`🎵 Error específico con archivo de audio: ${file.originalname}`);
                    console.log(`🎵 Detalles del error: ${error.message}`);
                    console.log(`🎵 Stack trace: ${error.stack}`);

                    // Almacenar archivo para reintento posterior
                    const fileInfo = {
                        originalName: file.originalname,
                        path: file.path,
                        size: file.size,
                        mimetype: file.mimetype,
                        chatId: chatId,
                        timestamp: new Date().toISOString(),
                        retryCount: 0,
                        maxRetries: 3
                    };

                    // Guardar en cola de archivos fallidos para reintento
                    if (!global.failedAudioFiles) {
                        global.failedAudioFiles = [];
                    }
                    global.failedAudioFiles.push(fileInfo);

                    console.log(`📝 Archivo de audio guardado para reintento posterior: ${file.originalname}`);

                    // Programar reintento automático después de 2 minutos
                    setTimeout(async () => {
                        await retryFailedAudioFile(fileInfo);
                    }, 2 * 60 * 1000); // 2 minutos

                    // Intentar enviar mensaje alternativo sobre el audio fallido
                    try {
                        const mensajeAlternativo = `🎵 No se pudo enviar el audio grabado (${file.originalname}).\n\n⚠️ WhatsApp Web está bloqueando temporalmente archivos de audio.\n\n💡 Opciones:\n• El sistema intentará reenviar automáticamente en 2 minutos\n• Grabe un audio más corto (15-30 segundos)\n• Espere 5-10 minutos y reintente manualmente\n• Use "debugFileUpload()" en la consola para más opciones\n\n📝 El archivo se guardó para reintento automático.`;

                        const successAlt = await enviarMensaje(chatId, mensajeAlternativo);
                        if (successAlt) {
                            console.log(`✅ Mensaje alternativo enviado para audio fallido: ${file.originalname}`);
                            registrarLog(`Mensaje alternativo enviado para audio fallido: ${file.originalname}`);
                        }
                    } catch (altError) {
                        console.log(`❌ Error enviando mensaje alternativo: ${altError.message}`);
                    }
                }

                // Mensajes de error más específicos para el usuario
                if (error.message.includes('Evaluation failed')) {
                    if (isAudioFile) {
                        errorMessage = `Error de WhatsApp Web con archivo de audio ${file.originalname}. Se envió un mensaje alternativo con sugerencias.`;
                    } else {
                        errorMessage = `Error de WhatsApp Web al enviar ${file.originalname}. La sesión se reiniciará automáticamente.`;
                    }
                } else if (error.message.includes('Protocol error')) {
                    errorMessage = `Problema de conexión con WhatsApp al enviar ${file.originalname}. Inténtelo nuevamente en unos momentos.`;
                } else if (error.message.includes('Session closed')) {
                    errorMessage = `Sesión de WhatsApp cerrada al enviar ${file.originalname}. Espere a que se reconecte.`;
                } else if (error.message.includes('Token') || error.message.includes('jwt') || error.message.includes('malformed')) {
                    errorMessage = `Error de autenticación al enviar ${file.originalname}. Por favor, vuelve a iniciar sesión.`;
                } else {
                    errorMessage = `Error interno del servidor al enviar ${file.originalname}: ${error.message}`;
                }

                errors.push(errorMessage);
            }
        }
        
        // Enviar caption como mensaje separado si existe
        if (caption && caption.trim()) {
            try {
                await enviarMensaje(chatId, caption.trim(), null, true);
                registrarLog(`Caption enviado: ${caption.trim()}`);
            } catch (error) {
                registrarLog(`Error enviando caption: ${error.message}`);
                errors.push(`Error enviando caption: ${error.message}`);
            }
        }
        
        // Limpiar archivos temporales después de un tiempo (excepto audios)
        setTimeout(() => {
            files.forEach(file => {
                try {
                    if (fs.existsSync(file.path)) {
                        // Preservar archivos de audio permanentemente
                        const isAudioFile = file.mimetype && (
                            file.mimetype.startsWith('audio/') || 
                            file.mimetype.includes('webm') ||
                            file.path.includes('.ogg') ||
                            file.path.includes('.webm') ||
                            file.path.includes('.m4a') ||
                            file.path.includes('.wav')
                        );
                        
                        if (isAudioFile) {
                            registrarLog(`📁 Archivo de audio preservado: ${file.path}`);
                        } else {
                            fs.unlinkSync(file.path);
                            registrarLog(`Archivo temporal eliminado: ${file.path}`);
                        }
                    }
                } catch (error) {
                    registrarLog(`Error eliminando archivo temporal ${file.path}: ${error.message}`);
                }
            });
        }, 60000); // Eliminar después de 1 minuto
        
        if (successCount === files.length && errors.length === 0) {
            res.json({
                success: true,
                message: `${successCount} archivo(s) enviado(s) correctamente`,
                filesProcessed: successCount,
                timestamp: new Date().toISOString()
            });
        } else if (successCount > 0) {
            res.json({
                success: true,
                message: `${successCount} de ${files.length} archivo(s) enviado(s)`,
                filesProcessed: successCount,
                errors: errors,
                timestamp: new Date().toISOString()
            });
        } else {
            // Detectar si el error es específico de WhatsApp Web
            let isWhatsAppError = false;
            let errorMessage = 'No se pudo enviar ningún archivo';
            let detailedMessage = '';

            // Verificar si hay un error de WhatsApp Web registrado globalmente (de archivos de audio)
            if (global.lastAudioError && global.lastAudioError.isWhatsAppError) {
                isWhatsAppError = true;
                errorMessage = 'WhatsApp Web tiene restricciones temporales para archivos de audio';
                detailedMessage = 'Los archivos de audio grabados desde el navegador pueden ser bloqueados temporalmente por WhatsApp Web. Esto es un comportamiento normal y temporal.';

                // Limpiar el flag después de usarlo
                delete global.lastAudioError;
            } else if (errors.some(e => e.includes('Evaluation failed') || e.includes('Protocol error') || e.includes('Session closed'))) {
                isWhatsAppError = true;

                // Verificar si es específicamente un archivo de audio
                const hasAudioFiles = files.some(file =>
                    file.originalname &&
                    (file.originalname.includes('.m4a') ||
                     file.originalname.includes('.wav') ||
                     file.originalname.includes('.ogg') ||
                     file.originalname.includes('.webm') ||
                     file.originalname.includes('grabado'))
                );

                if (hasAudioFiles) {
                    errorMessage = 'WhatsApp Web tiene restricciones temporales para archivos de audio';
                    detailedMessage = 'Los archivos de audio grabados desde el navegador pueden ser bloqueados temporalmente por WhatsApp Web. Esto es un comportamiento normal y temporal.';
                } else {
                    errorMessage = 'WhatsApp Web está experimentando problemas técnicos';
                    detailedMessage = 'Se ha detectado un problema con WhatsApp Web. La sesión se reiniciará automáticamente.';
                }
            }

            res.status(500).json({
                success: false,
                error: errorMessage,
                detailedMessage: detailedMessage,
                errors: errors,
                isWhatsAppError: isWhatsAppError,
                suggestions: [
                    'Espere 2-3 minutos y reintente',
                    'Grabe un audio más corto (15-30 segundos)',
                    'Envíe un mensaje de texto en lugar de audio',
                    'Verifique su conexión a internet'
                ],
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('💥 Error crítico en /api/send-files:', error);
        console.error('📊 Stack trace completo:', error.stack);
        console.error('📊 Request body:', {
            chatId: req.body?.chatId,
            filesCount: req.files?.length,
            user: req.user?.usuario_id
        });

        registrarLog(`Error crítico en /api/send-files: ${error.message}`);

        res.status(500).json({
            success: false,
            error: `Error interno del servidor: ${error.message}`,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para cambiar modo de chat (bot/human) (requiere autenticación)
app.post('/api/chats/:chatId/toggle-mode', requireAuth, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        
        // Ignorar operaciones en grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.status(400).json({
                success: false,
                message: 'Operación no permitida en grupos de WhatsApp',
                timestamp: new Date().toISOString()
            });
        }
        
        const estado = obtenerEstadoUsuario(chatId);
        
        if (estado.enEsperaHumano) {
            // Cambiar a modo bot
            actualizarEstadoUsuario(chatId, { enEsperaHumano: null });
            guardarEstados(); // Guardar inmediatamente al cambiar a modo bot
            await enviarMensaje(chatId, '🤖 Has sido transferido al modo automático. Puedes usar el menú principal.');
            await mostrarMenuPrincipal(chatId);
        } else {
            // Cambiar a modo humano
            await activarModoHumano(chatId);
            await enviarMensaje(chatId, '📩 Tu consulta ha sido enviada al área correspondiente. Nos pondremos en contacto contigo muy pronto. ✨');
        }
        
        // Actualizar información del chat
        actualizarChatActivo(chatId);
        const chatInfo = chatsActivos.get(chatId);
        
        res.json({
            success: true,
            mode: chatInfo ? chatInfo.mode : 'bot',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error cambiando modo',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para finalizar un chat (requiere autenticación)
app.post('/api/chats/:chatId/end', requireAuth, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        
        // Ignorar operaciones en grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.status(400).json({
                success: false,
                message: 'Operación no permitida en grupos de WhatsApp',
                timestamp: new Date().toISOString()
            });
        }
        
        // Quitar la marca de pendiente antes de finalizar
        const chatInfo = chatsActivos.get(chatId);
        if (chatInfo) {
            chatInfo.pendiente = false;
            chatsActivos.set(chatId, chatInfo);
            console.log(`✅ [FINALIZAR] Marca 'pendiente' removida para chat ${chatId}`);
        }

        await enviarMensaje(chatId, '😊 Chat finalizado. Gracias por comunicarte con *SOLUCNET.SAS*');
        limpiarChatCompleto(chatId);
        
        res.json({
            success: true,
            message: 'Chat finalizado correctamente',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error finalizando chat',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para desmarcar un chat como finalizado (permitir su recuperación)
app.post('/api/chats/:chatId/unmark-finished', requireAuth, async (req, res) => {
    try {
        const chatId = req.params.chatId;

        // Ignorar operaciones en grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.status(400).json({
                success: false,
                message: 'Operación no permitida en grupos de WhatsApp',
                timestamp: new Date().toISOString()
            });
        }

        // Remover de chats finalizados para que pueda ser recuperado
        const wasFinished = chatsFinalizados.has(chatId);
        chatsFinalizados.delete(chatId);

        // Guardar estados actualizados
        guardarEstados();

        res.json({
            success: true,
            message: wasFinished ? 'Chat desmarcado como finalizado. Ahora puede ser recuperado.' : 'El chat no estaba marcado como finalizado.',
            wasFinished: wasFinished,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error desmarcando chat',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener lista de chats finalizados
app.get('/api/chats/finished', requireAuth, (req, res) => {
    try {
        const chatsFinalizadosArray = Array.from(chatsFinalizados);

        res.json({
            success: true,
            finishedChats: chatsFinalizadosArray,
            count: chatsFinalizadosArray.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error obteniendo chats finalizados',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para marcar manualmente un chat como finalizado (sin enviar mensaje)
app.post('/api/chats/:chatId/mark-finished', requireAuth, async (req, res) => {
    try {
        const chatId = req.params.chatId;

        // Ignorar operaciones en grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.status(400).json({
                success: false,
                message: 'Operación no permitida en grupos de WhatsApp',
                timestamp: new Date().toISOString()
            });
        }

        // Limpiar chat completo (esto lo marca como finalizado automáticamente)
        limpiarChatCompleto(chatId);

        res.json({
            success: true,
            message: 'Chat marcado como finalizado correctamente',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error marcando chat como finalizado',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para marcar chat como leído
app.post('/api/chats/:chatId/mark-read', (req, res) => {
    try {
        const chatId = req.params.chatId;
        
        // Ignorar operaciones en grupos de WhatsApp
        if (chatId.includes('@g.us')) {
            return res.json({
                success: true,
                message: 'Operación ignorada para grupos de WhatsApp',
                timestamp: new Date().toISOString()
            });
        }
        
        const chatInfo = chatsActivos.get(chatId);
        
        if (chatInfo) {
            chatInfo.unreadCount = 0;
            chatsActivos.set(chatId, chatInfo);
        }
        
        res.json({
            success: true,
            message: 'Chat marcado como leído',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error marcando como leído',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para limpiar mensajes duplicados (requiere autenticación de admin)
app.post('/api/clean-duplicates', requireAdmin, (req, res) => {
    try {
        console.log('🧹 Solicitud de limpieza de mensajes duplicados recibida');

        const duplicadosEliminados = limpiarMensajesDuplicados();

        res.json({
            success: true,
            message: `Limpieza completada: ${duplicadosEliminados} mensajes duplicados eliminados`,
            duplicatesRemoved: duplicadosEliminados,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error en limpieza manual:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error limpiando mensajes duplicados',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para probar base de datos
app.get('/api/test-db', async (req, res) => {
    try {
        const resultado = await consultarCliente('1067950020'); // Cliente de prueba
        res.json({
            success: true,
            message: 'Conexión exitosa a la base de datos',
            totalClientes: resultado ? 1 : 0,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error conectando a la base de datos',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Servir archivos estáticos con configuración mejorada
const staticOptions = {
    setHeaders: (res, path) => {
        // Configurar CORS para archivos multimedia
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        
        // Configurar tipos MIME correctos
        if (path.endsWith('.ogg')) {
            res.setHeader('Content-Type', 'audio/ogg');
        } else if (path.endsWith('.webm')) {
            res.setHeader('Content-Type', 'audio/webm');
        } else if (path.endsWith('.mp3')) {
            res.setHeader('Content-Type', 'audio/mpeg');
        } else if (path.endsWith('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
        } else if (path.endsWith('.wav')) {
            res.setHeader('Content-Type', 'audio/wav');
        } else if (path.endsWith('.jpeg') || path.endsWith('.jpg')) {
            res.setHeader('Content-Type', 'image/jpeg');
        } else if (path.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
        } else if (path.endsWith('.webp')) {
            res.setHeader('Content-Type', 'image/webp');
        }
        
        // Configurar cache para archivos multimedia
        if (path.match(/\.(ogg|webm|mp3|mp4|wav|jpg|jpeg|png|webp)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 año
        }
    }
};

app.use(express.static('public', staticOptions));
app.use('/images', express.static('images', staticOptions));
app.use('/imagenes', express.static('imagenes', staticOptions));
app.use('/images/users', express.static('images/users', staticOptions));
app.use('/uploads', express.static('uploads', staticOptions));
app.use('/uploads/audios', express.static('uploads/audios', staticOptions));
app.use('/uploads/videos', express.static('uploads/videos', staticOptions));
app.use('/uploads/fotos_reportes', express.static('uploads/fotos_reportes', staticOptions));
app.use('/uploads/files', express.static('uploads/files', staticOptions));
app.use('/uploads/pdfs_visitas', express.static('public/uploads/pdfs_visitas', staticOptions));

// Endpoint simple de prueba
app.get('/api/test', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Servidor funcionando',
        timestamp: new Date().toISOString()
    });
});

// Endpoint de prueba para BD de visitas técnicos
app.get('/api/test-bd-tecnicos', async (req, res) => {
    try {
        console.log('🧪 [TEST] Probando conexión a BD de técnicos...');
        const resultado = await obtenerOrdenesParaAdmin();

        res.json({
            success: true,
            resultado: resultado,
            timestamp: new Date().toISOString(),
            message: 'Prueba de BD completada'
        });
    } catch (error) {
        console.error('❌ [TEST] Error en prueba BD:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para ver todas las visitas con números de teléfono
app.get('/api/debug/visitas-con-telefono', async (req, res) => {
    try {
        const mysql = require('mysql2/promise');
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        const [visitas] = await conexion.execute(`
            SELECT
                id,
                cliente_nombre,
                cliente_cedula,
                cliente_telefono,
                estado,
                fecha_programada,
                DATE(fecha_programada) as solo_fecha,
                DATE(NOW()) as hoy
            FROM visitas_tecnicas
            WHERE estado IN ('programada', 'asignada')
            ORDER BY fecha_programada DESC
            LIMIT 10
        `);

        await conexion.end();

        console.log('🔍 [DEBUG] Visitas encontradas:', visitas.length);
        visitas.forEach(v => {
            console.log(`📋 ID:${v.id}, Cliente:${v.cliente_nombre}, Tel:${v.cliente_telefono}, Cedula:${v.cliente_cedula}, Estado:${v.estado}`);
        });

        res.json({
            success: true,
            visitas: visitas,
            count: visitas.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error consultando visitas:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para consultar estructura y datos de visitas técnicas
app.get('/api/debug-bd-visitas', async (req, res) => {
    try {
        console.log('🔍 [DEBUG] Consultando estructura de BD visitas...');

        const mysql = require('mysql2/promise');
        const conexion = await mysql.createConnection({
            host: process.env.DB_SYSTEM_HOST,
            user: process.env.DB_SYSTEM_USER,
            password: process.env.DB_SYSTEM_PASSWORD,
            database: process.env.DB_SYSTEM_DATABASE
        });

        // Verificar qué tablas existen
        const [tablas] = await conexion.execute("SHOW TABLES LIKE '%visita%'");
        console.log('📋 [DEBUG] Tablas encontradas:', tablas);

        // Verificar estructura de visitas_tecnicas
        let estructura = [];
        try {
            const [cols] = await conexion.execute("DESCRIBE visitas_tecnicas");
            estructura = cols;
        } catch (e) {
            console.log('⚠️ Tabla visitas_tecnicas no existe');
        }

        // Contar registros totales
        let totalRegistros = 0;
        let registrosRecientes = [];
        try {
            const [count] = await conexion.execute("SELECT COUNT(*) as total FROM visitas_tecnicas");
            totalRegistros = count[0].total;

            // Obtener los últimos 5 registros
            const [recent] = await conexion.execute(`
                SELECT id, cliente_nombre, tecnico_asignado_nombre, tecnico_asignado_id, estado, fecha_creacion
                FROM visitas_tecnicas
                ORDER BY fecha_creacion DESC
                LIMIT 5
            `);
            registrosRecientes = recent;
        } catch (e) {
            console.log('⚠️ Error consultando registros:', e.message);
        }

        // Obtener técnicos únicos
        let tecnicos = [];
        try {
            const [tecnicosQuery] = await conexion.execute(`
                SELECT DISTINCT tecnico_asignado_id, tecnico_asignado_nombre
                FROM visitas_tecnicas
                WHERE tecnico_asignado_id IS NOT NULL
                ORDER BY tecnico_asignado_id
            `);
            tecnicos = tecnicosQuery;
        } catch (e) {
            console.log('⚠️ Error consultando técnicos:', e.message);
        }

        await conexion.end();

        res.json({
            success: true,
            debug: {
                tablas: tablas,
                estructura: estructura,
                totalRegistros: totalRegistros,
                registrosRecientes: registrosRecientes,
                tecnicos: tecnicos
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [DEBUG] Error consultando BD:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Ruta del panel de administración (COMENTADA - duplicada y archivo no existe)
// app.get('/admin', (req, res) => {
//     res.sendFile(__dirname + '/public/admin.html');
// });

// Ruta del panel de administración del chatbot
app.get('/indesx', (req, res) => {
    res.sendFile(__dirname + '/public/indesx.html');
});

// ===========================================
// RUTAS API PARA PANEL DE ADMINISTRACIÓN
// ===========================================

// API para obtener funciones del chatbot (simuladas) - TEMPORALMENTE SIN AUTH PARA DEBUG
app.get('/api/admin/functions', (req, res) => {
    try {
        const functions = [
            {
                name: 'handleWelcome',
                description: 'Maneja mensajes de bienvenida',
                active: true,
                code: 'function handleWelcome(message, client) {\n    const welcomeMessages = ["¡Hola! Bienvenido a SOLUCNET", "¡Hola de nuevo!"];\n    return welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];\n}'
            },
            {
                name: 'processMenu',
                description: 'Procesa opciones del menú principal',
                active: true,
                code: 'function processMenu(option, client) {\n    switch(option) {\n        case "1": return "Conectando con soporte...";\n        case "2": return "Aquí tienes nuestros servicios...";\n        default: return "Opción no válida";\n    }\n}'
            },
            {
                name: 'handleSupport',
                description: 'Gestiona solicitudes de soporte técnico',
                active: true,
                code: 'function handleSupport(message, client) {\n    return "Un agente se pondrá en contacto contigo pronto. Describe tu problema:";\n}'
            },
            {
                name: 'validateClient',
                description: 'Valida información del cliente',
                active: true,
                code: 'function validateClient(phoneNumber, client) {\n    // Validar cliente en base de datos\n    return true;\n}'
            },
            {
                name: 'generateTicket',
                description: 'Genera tickets de soporte',
                active: false,
                code: 'function generateTicket(clientData, issue) {\n    const ticketId = Date.now();\n    return `Ticket #${ticketId} creado para: ${issue}`;\n}'
            }
        ];
        
        res.json({
            success: true,
            functions: functions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para agregar nueva función - TEMPORALMENTE SIN AUTH PARA DEBUG
app.post('/api/admin/functions', (req, res) => {
    try {
        const { name, description, code } = req.body;
        
        if (!name || !description || !code) {
            return res.status(400).json({
                success: false,
                message: 'Nombre, descripción y código son requeridos'
            });
        }
        
        // Validar que el código sea JavaScript válido
        try {
            new Function(code);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: 'Código JavaScript inválido: ' + err.message
            });
        }
        
        // Aquí podrías guardar la función en un archivo o base de datos
        registrarLogAPI(`Nueva función agregada: ${name}`);
        
        res.json({
            success: true,
            message: `Función "${name}" agregada correctamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para actualizar función
app.put('/api/admin/functions/:name', requireAuth, (req, res) => {
    try {
        const { name } = req.params;
        const { description, code, active } = req.body;
        
        // Aquí actualizarías la función
        registrarLogAPI(`Función actualizada: ${name}`);
        
        res.json({
            success: true,
            message: `Función "${name}" actualizada correctamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para eliminar función - TEMPORALMENTE SIN AUTH PARA DEBUG
app.delete('/api/admin/functions/:name', (req, res) => {
    try {
        const { name } = req.params;
        
        // Aquí eliminarías la función
        registrarLogAPI(`Función eliminada: ${name}`);
        
        res.json({
            success: true,
            message: `Función "${name}" eliminada correctamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para toggle función (activar/desactivar) - TEMPORALMENTE SIN AUTH PARA DEBUG
app.post('/api/admin/functions/:name/toggle', (req, res) => {
    try {
        const { name } = req.params;
        const { active } = req.body;
        
        // Aquí cambiarías el estado de la función
        registrarLogAPI(`Función ${active ? 'activada' : 'desactivada'}: ${name}`);
        
        res.json({
            success: true,
            message: `Función "${name}" ${active ? 'activada' : 'desactivada'} correctamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para obtener estadísticas del admin - TEMPORALMENTE SIN AUTH PARA DEBUG
app.get('/api/admin/stats', (req, res) => {
    try {
        const stats = {
            botStatus: whatsappListo ? 'online' : 'offline',
            whatsappListo: whatsappListo,
            whatsappEstabilizado: whatsappEstabilizado,
            activeUsers: estadosUsuario.size,
            totalFunctions: 5, // Simulado
            activeFunctions: 4, // Simulado
            messagesToday: Math.floor(Math.random() * 100) + 50, // Simulado
            timestamp: new Date().toISOString()
        };
        
        res.json({
            success: true,
            stats: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para gestión de mensajes
app.get('/api/admin/messages/:type', requireAuth, (req, res) => {
    try {
        const { type } = req.params;
        
        let message = '';
        switch (type) {
            case 'welcome':
                message = mensajesBienvenida[0] || 'Mensaje de bienvenida no encontrado';
                break;
            case 'menu':
                message = 'Menú Principal 📋\n\n1️⃣ Soporte Técnico\n2️⃣ Consultar Servicios\n3️⃣ Hablar con un Agente\n4️⃣ Información';
                break;
            case 'error':
                message = '❌ Ha ocurrido un error\n\nPor favor, intenta nuevamente o contacta con soporte.';
                break;
            case 'support':
                message = '🛠️ Soporte Técnico\n\nNuestro equipo te ayudará. Describe tu problema con detalle.';
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Tipo de mensaje no válido'
                });
        }
        
        res.json({
            success: true,
            message: message
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para guardar mensajes
app.post('/api/admin/messages', requireAuth, (req, res) => {
    try {
        const { type, content } = req.body;
        
        if (!type || !content) {
            return res.status(400).json({
                success: false,
                message: 'Tipo y contenido son requeridos'
            });
        }
        
        // Aquí guardarías el mensaje
        registrarLogAPI(`Mensaje actualizado: ${type}`);
        
        res.json({
            success: true,
            message: `Mensaje de tipo "${type}" guardado correctamente`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para probar mensajes
app.post('/api/admin/test-message', requireAuth, (req, res) => {
    try {
        const { content, testNumber } = req.body;
        
        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'Contenido del mensaje es requerido'
            });
        }
        
        // Simular envío de mensaje de prueba
        registrarLogAPI(`Mensaje de prueba enviado: ${content.substring(0, 50)}...`);
        
        res.json({
            success: true,
            message: 'Mensaje de prueba enviado correctamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para obtener logs del sistema - TEMPORALMENTE SIN AUTH PARA DEBUG
app.get('/api/admin/logs', (req, res) => {
    try {
        const logs = [
            `[${new Date().toLocaleString()}] INFO: Sistema iniciado correctamente`,
            `[${new Date().toLocaleString()}] INFO: WhatsApp ${whatsappListo ? 'conectado' : 'desconectado'}`,
            `[${new Date().toLocaleString()}] INFO: ${estadosUsuario.size} usuarios activos`,
            `[${new Date().toLocaleString()}] INFO: Panel de administración accedido`,
            `[${new Date().toLocaleString()}] INFO: Funciones del chatbot cargadas`
        ];
        
        res.json({
            success: true,
            logs: logs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para configuración del sistema
app.get('/api/admin/settings', requireAuth, (req, res) => {
    try {
        const settings = {
            responseDelay: 1000,
            maxRetries: 3,
            autoResponse: true,
            debugMode: false,
            httpsEnabled: !!sslOptions
        };
        
        res.json({
            success: true,
            settings: settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API para guardar configuración
app.post('/api/admin/settings', requireAuth, (req, res) => {
    try {
        const settings = req.body;
        
        // Aquí guardarías la configuración
        registrarLogAPI('Configuración del sistema actualizada');
        
        res.json({
            success: true,
            message: 'Configuración guardada correctamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===== Inicialización del servidor =====
// Nota: El servidor se inicia después de la inicialización del sistema de autenticación

// Limpiar procesos previos de Puppeteer
try {
    require('child_process').execSync('pkill -f "puppeteer" || true');
    registrarLog('Procesos previos de Puppeteer eliminados');
} catch (e) {
    registrarLog("No se encontraron procesos previos de puppeteer");
}

// Manejo de señales del sistema para limpieza
process.on('SIGINT', () => {
    registrarLog('Recibida señal SIGINT, cerrando aplicación...');
    if (client) {
        client.destroy();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    registrarLog('Recibida señal SIGTERM, cerrando aplicación...');
    if (client) {
        client.destroy();
    }
    process.exit(0);
});

// Función principal de inicialización
// ===== FUNCIONES DE LIMPIEZA TOTAL =====

// Función para limpiar todos los listeners de mensajes
function cleanAllMessageListeners() {
    try {
        if (client) {
            // Remover todos los listeners de message
            client.removeAllListeners('message');
            console.log('🧹 Todos los listeners de message removidos');
        }
    } catch (error) {
        console.error('❌ Error removiendo listeners:', error.message);
    }
}

// Función para limpiar estado de formularios
function cleanFormularioState() {
    try {
        // Limpiar estado de todos los usuarios
        for (const [chatId, estado] of estadosUsuario.entries()) {
            if (estado.formularioListener) {
                try {
                    if (client) {
                        client.removeListener('message', estado.formularioListener);
                    }
                } catch (error) {
                    console.error(`Error removiendo listener de formulario para ${chatId}:`, error.message);
                }
            }

            // Resetear estado de formulario
            actualizarEstadoUsuario(chatId, {
                formularioListener: null,
                formularioListenerId: null
            });
        }
        console.log('🧹 Estado de formularios limpiado');
    } catch (error) {
        console.error('❌ Error limpiando estado de formularios:', error.message);
    }
}

// Variable para evitar múltiples inicializaciones simultáneas del cliente
let clienteLimpioIniciando = false;

// Función para iniciar cliente completamente limpio
async function startCleanClient() {
    if (clienteLimpioIniciando) {
        console.log('🔄 Cliente limpio ya está iniciando, evitando duplicación');
        return;
    }
    clienteLimpioIniciando = true;
    console.log('🔄 Iniciando cliente completamente limpio...');

    try {
        // 1. Limpiar todos los listeners existentes
        cleanAllMessageListeners();

        // 2. Limpiar estado de formularios
        cleanFormularioState();

        // 3. Destruir cliente anterior si existe
        if (client) {
            console.log('💥 Destruyendo cliente anterior...');
            try {
                await client.destroy();
                console.log('✅ Cliente anterior destruido');
            } catch (destroyError) {
                console.error('⚠️ Error destruyendo cliente anterior:', destroyError.message);
            }
        }

        // 4. Resetear variables globales
        whatsappListo = false;
        clienteIniciando = false;

        // 5. Pequeña pausa para asegurar limpieza completa
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 6. Iniciar cliente limpio
        console.log('🚀 Iniciando cliente limpio...');
        await iniciarCliente();

    } catch (error) {
        console.error('❌ Error en startCleanClient:', error.message);
        // Intentar iniciar cliente de todas formas
        try {
            await iniciarCliente();
        } catch (fallbackError) {
            console.error('❌ Error en fallback de iniciarCliente:', fallbackError.message);
        }
    } finally {
        // Resetear flag para permitir futuros intentos
        clienteLimpioIniciando = false;
    }
}

// ================================
// ENDPOINTS PARA PRUEBAS DE CARGA
// ================================

// Endpoint para monitorear estado de memoria y chats (sin autenticación para pruebas)
app.get('/api/memory-status', (req, res) => {
    const memoryUsage = process.memoryUsage();
    
    res.json({
        success: true,
        timestamp: new Date().toISOString(),
        memory: {
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
            external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
        },
        chats: {
            usuariosActivos: estadosUsuario.size,
            chatsActivos: chatsActivos.size,
            mensajesCacheados: mensajesChat.size,
            limiteMaximo: MAX_ESTADOS
        },
        whatsapp: {
            listo: whatsappListo,
            estabilizado: whatsappEstabilizado
        }
    });
});

// Endpoint para limpiar forzosamente todos los chats (sin autenticación para pruebas)
app.post('/api/clear-all-chats', (req, res) => {
    const totalChats = estadosUsuario.size;
    const totalChatsActivos = chatsActivos.size;
    const totalMensajes = mensajesChat.size;

    // Obtener todos los chats activos antes de limpiar
    const chatsParaLimpiar = Array.from(new Set([
        ...estadosUsuario.keys(),
        ...chatsActivos.keys(),
        ...mensajesChat.keys()
    ]));

    console.log(`🧹 [LIMPIEZA] Marcando ${chatsParaLimpiar.length} chats como finalizados para evitar recuperación`);

    // Limpiar todos los chats usando la función completa (esto los marca como finalizados)
    for (const chatId of chatsParaLimpiar) {
        limpiarChatCompleto(chatId); // Esta función automáticamente los agrega a chatsFinalizados
    }

    // Limpiar cualquier residuo manual de forma más agresiva
    estadosUsuario.clear();
    chatsActivos.clear();
    mensajesChat.clear();

    // IMPORTANTE: NO limpiar modosChat para que persistan los modos bot/human
    console.log(`🎭 [PERSISTENCIA] ${modosChat.size} modos de chat (bot/human) preservados después de limpieza`);

    // Asegurar que TODOS los chats sean marcados como finalizados (por si acaso)
    let chatsFinalizadosCount = 0;
    for (const chatId of chatsParaLimpiar) {
        if (!chatsFinalizados.has(chatId)) {
            chatsFinalizados.add(chatId);
            chatsFinalizadosCount++;
        }
    }

    // Guardar estados para persistir los chats finalizados Y los modos
    try {
        guardarEstados();
        console.log(`💾 [PERSISTENCIA] ${chatsFinalizados.size} chats marcados como finalizados y ${modosChat.size} modos guardados`);
    } catch (error) {
        console.error('❌ [PERSISTENCIA] Error guardando estados:', error.message);
    }

    // *** NUEVA OPTIMIZACIÓN: Limpiar también caches adicionales ***
    if (typeof cacheUsuarios !== 'undefined' && cacheUsuarios) {
        cacheUsuarios.clear();
    }
    if (typeof mensajesEnviados !== 'undefined' && mensajesEnviados) {
        mensajesEnviados.clear();
    }

    // *** Establecer límite máximo de chats después de limpiar ***
    global.MAX_CHATS_ALLOWED = 50; // Aumentar límite para evitar eliminación de chats activos

    // Forzar garbage collection si está disponible
    if (global.gc) {
        global.gc();
    }

    console.log(`🧹 [LIMPIEZA MEJORADA] ${totalChats} estados, ${totalChatsActivos} chats activos, ${totalMensajes} mensajes eliminados`);
    console.log(`🚫 [FINALIZACIÓN] ${chatsFinalizados.size} chats marcados como finalizados (no serán recuperados)`);
    console.log(`⚡ [LÍMITE] Máximo de chats permitidos establecido en ${global.MAX_CHATS_ALLOWED}`);

    res.json({
        success: true,
        message: 'Todos los chats han sido limpiados, marcados como finalizados y optimizados',
        cleared: {
            estados: totalChats,
            chatsActivos: totalChatsActivos,
            mensajes: totalMensajes,
            chatsFinalizados: chatsFinalizados.size
        },
        optimizations: {
            maxChatsLimit: global.MAX_CHATS_ALLOWED,
            aggressiveCleanup: true,
            chatsPermanentlyMarked: true
        },
        timestamp: new Date().toISOString()
    });
});

// Endpoint para desmarcar todos los chats como pendientes Y finalizarlos (nueva funcionalidad para botón Limpiar)
app.post('/api/unmark-all-pending', (req, res) => {
    try {
        console.log('🔄 [LIMPIAR CHATS] Iniciando limpieza de chats activos...');

        let totalChatsProcessed = 0;
        let chatsCleared = 0;

        // Crear array de chat IDs para iterar (evitar modificar Map durante iteración)
        const chatIds = Array.from(chatsActivos.keys());

        // Iterar sobre todos los chats activos y eliminarlos
        for (const chatId of chatIds) {
            totalChatsProcessed++;

            // Eliminar completamente de chatsActivos
            chatsActivos.delete(chatId);

            // Limpiar mensajes en caché
            mensajesChat.delete(chatId);

            // Limpiar estado del usuario
            estadosUsuario.delete(chatId);

            // Agregar a chats finalizados para evitar recuperación automática
            chatsFinalizados.add(chatId);
            chatsCleared++;

            console.log(`🧹 [LIMPIAR] Chat ${chatId} eliminado de activos y agregado a finalizados`);
        }

        // Guardar cambios en el archivo de estados
        guardarEstados();

        console.log(`✅ [LIMPIAR CHATS] Procesados ${totalChatsProcessed} chats, ${chatsCleared} eliminados completamente`);
        console.log(`📊 [LIMPIAR CHATS] Estado final - Activos: ${chatsActivos.size}, Finalizados: ${chatsFinalizados.size}`);

        res.json({
            success: true,
            message: `${chatsCleared} chats limpiados exitosamente`,
            details: {
                totalProcessed: totalChatsProcessed,
                unmarked: chatsCleared, // Compatibilidad con frontend
                cleared: chatsCleared,
                remaining: 0
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [UNMARK-PENDING] Error limpiando chats:', error);
        res.status(500).json({
            success: false,
            message: 'Error limpiando chats',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint temporal para debug - verificar chats finalizados
app.get('/api/debug/finalized-chats', (req, res) => {
    const finalizedArray = Array.from(chatsFinalizados);
    const totalFinalized = finalizedArray.length;
    const target = "573135648878@c.us";
    const isTargetFinalized = chatsFinalizados.has(target);

    res.json({
        success: true,
        totalFinalized,
        targetChat: {
            id: target,
            isFinalized: isTargetFinalized
        },
        allFinalized: finalizedArray.slice(0, 10), // Primeros 10 para evitar respuesta muy grande
        timestamp: new Date().toISOString()
    });
});

// Endpoint para remover un chat específico de la lista de finalizados
app.post('/api/debug/unfinalize-chat', (req, res) => {
    const { chatId } = req.body;
    const targetId = chatId || "573135648878@c.us";

    const wasFinalized = chatsFinalizados.has(targetId);

    if (wasFinalized) {
        chatsFinalizados.delete(targetId);
        console.log(`🔄 [UNFINALIZE] Chat ${targetId} removido de lista de finalizados`);
    }

    res.json({
        success: true,
        chatId: targetId,
        wasFinalized,
        isStillFinalized: chatsFinalizados.has(targetId),
        message: wasFinalized ? 'Chat removido de lista de finalizados' : 'Chat no estaba en lista de finalizados',
        timestamp: new Date().toISOString()
    });
});

// Endpoint para simular mensajes entrantes (para testing)
app.post('/api/simulate-incoming-message', async (req, res) => {
    try {
        const { from, body, pushname, timestamp, fromMe = false, type = 'chat' } = req.body;
        
        if (!from || !body) {
            return res.status(400).json({
                success: false,
                message: 'from y body son requeridos'
            });
        }
        
        console.log(`🎭 [SIMULACIÓN] Mensaje entrante simulado de ${pushname || from}: "${body}"`);
        
        // Crear mensaje simulado con estructura similar a WhatsApp
        const simulatedMessage = {
            id: {
                _serialized: `simulated_${from}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                fromMe: fromMe,
                remote: from,
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            },
            body: body,
            type: type,
            timestamp: timestamp || Math.floor(Date.now() / 1000),
            from: from,
            to: '573135648878@c.us', // Número del bot (ajustar según necesidad)
            author: from,
            pushname: pushname || 'Cliente Simulado',
            isForwarded: false,
            hasMedia: false,
            fromMe: fromMe,
            hasQuotedMsg: false,
            deviceType: 'android',
            isStatus: false,
            isStarred: false,
            broadcast: false,
            mentionedIds: [],
            groupMentions: [],
            isGif: false,
            links: []
        };
        
        // Procesar el mensaje simulado a través del manejador principal
        await manejarMensaje(simulatedMessage);
        
        // Log para seguimiento
        const logEntry = `${new Date().toLocaleString('es-ES')}: 🎭 [SIMULADO] ${pushname || from} (${from}): "${body}"`;
        fs.appendFileSync('./mensajes.log', logEntry + '\n');
        
        res.json({
            success: true,
            message: 'Mensaje simulado procesado exitosamente',
            data: {
                from: from,
                body: body,
                pushname: pushname,
                timestamp: simulatedMessage.timestamp,
                messageId: simulatedMessage.id._serialized
            }
        });
        
    } catch (error) {
        console.error('💥 Error procesando mensaje simulado:', error);
        res.status(500).json({
            success: false,
            message: 'Error procesando mensaje simulado',
            error: error.message
        });
    }
});

// Endpoint para simular finalización masiva de chats
app.post('/api/test-mass-finalize', async (req, res) => {
    const chatIds = Array.from(estadosUsuario.keys());
    let finalizados = 0;
    
    for (const chatId of chatIds) {
        try {
            limpiarChatCompleto(chatId);
            finalizados++;
        } catch (error) {
            console.error(`Error finalizando ${chatId}:`, error.message);
        }
    }
    
    res.json({
        success: true,
        message: `${finalizados} chats finalizados masivamente`,
        finalizados: finalizados,
        timestamp: new Date().toISOString()
    });
});

// ===== QR ENDPOINTS =====
// Función para obtener el string del QR desde los logs
function obtenerStringQRDesdeLogs() {
    return new Promise((resolve) => {
        // Primero intentar desde el archivo de logs directo
        try {
            const logs = fs.readFileSync('/root/whatsapp-chatbot/logs/out.log', 'utf8');
            const qrMatches = logs.match(/🔍 \[QR REAL\] (.+)/g);
            if (qrMatches && qrMatches.length > 0) {
                const lastQR = qrMatches[qrMatches.length - 1];
                const qrString = lastQR.replace('🔍 [QR REAL] ', '');
                resolve(qrString);
                return;
            }
        } catch (error) {
            console.log('No se pudo leer desde archivo de logs:', error.message);
        }

        // Si no funciona el archivo directo, usar PM2 logs
        exec('pm2 logs solucnet-bot --lines 500 --nostream', (error, stdout, stderr) => {
            if (error) {
                console.log('Error obteniendo logs PM2:', error.message);
                resolve(null);
                return;
            }

            // Buscar el patrón QR REAL en los logs
            const qrMatches = stdout.match(/🔍 \[QR REAL\] (.+)/g);
            if (qrMatches && qrMatches.length > 0) {
                const lastQR = qrMatches[qrMatches.length - 1];
                const qrString = lastQR.replace('🔍 [QR REAL] ', '');
                resolve(qrString.trim());
            } else {
                resolve(null);
            }
        });
    });
}

// Endpoint duplicado eliminado - solo se usa el de la línea 9104

app.get('/qr', (req, res) => {
    res.sendFile(__dirname + '/public/qr.html');
});

async function inicializarSistemaCompleto() {
    try {
        console.log('🔐 Inicializando sistema de autenticación...');
        await inicializarSistema();
        console.log('✅ Sistema de autenticación inicializado correctamente');

        console.log('🔧 Inicializando sistema de visitas técnicas...');
        await inicializarSistemaVisitas();
        console.log('✅ Sistema de visitas técnicas inicializado correctamente');

        console.log('💾 Inicializando sistema de backup...');
        await inicializarBackupSystem();
        console.log('✅ Sistema de backup inicializado correctamente');

        console.log('📬 Inicializando cola de mensajes API...');
        await inicializarColaMensajesAPI();
        console.log('✅ Cola de mensajes API inicializada correctamente');

        // Iniciar monitor de rendimiento
        performanceMonitor.start();
        console.log('✅ Monitor de rendimiento activado');

        // Ahora que el sistema está inicializado, iniciar el servidor y cliente
        console.log('🚀 Iniciando servidor y cliente de WhatsApp...');

        // Iniciar el servidor PRIMERO e independientemente
        const PORT = process.env.PORT || 3000;
        let server;

        if (useHTTPS && sslOptions) {
            server = https.createServer(sslOptions, app);

            // Configurar timeouts para prevenir conexiones colgadas
            server.timeout = 120000; // 120 segundos
            server.keepAliveTimeout = 65000; // 65 segundos
            server.headersTimeout = 66000; // 66 segundos

            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`⚠️ Puerto ${PORT} ya está en uso - otra instancia está corriendo`);
                    console.log('✅ Continuando con el cliente de WhatsApp...');
                    // NO hacer process.exit, permitir que continúe
                } else {
                    console.error('❌ Error en el servidor:', err);
                }
            });

            server.listen(PORT, () => {
                registrarLog(`API escuchando en https://localhost:${PORT}`);
                registrarLog(`Panel web disponible en https://localhost:${PORT}`);
                console.log('🔒 Servidor HTTPS iniciado correctamente');
                console.log(`⏱️  Timeouts configurados - Request: 120s, KeepAlive: 65s`);
            });
        } else {
            server = http.createServer(app);

            // Configurar timeouts para prevenir conexiones colgadas
            server.timeout = 120000; // 120 segundos
            server.keepAliveTimeout = 65000; // 65 segundos
            server.headersTimeout = 66000; // 66 segundos

            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`⚠️ Puerto ${PORT} ya está en uso - otra instancia está corriendo`);
                    console.log('✅ Continuando con el cliente de WhatsApp...');
                    // NO hacer process.exit, permitir que continúe
                } else {
                    console.error('❌ Error en el servidor:', err);
                }
            });

            server.listen(PORT, () => {
                registrarLog(`API escuchando en http://localhost:${PORT}`);
                registrarLog(`Panel web disponible en http://localhost:${PORT}`);
                console.log('🌐 Servidor HTTP iniciado correctamente');
                console.log(`⏱️  Timeouts configurados - Request: 120s, KeepAlive: 65s`);
            });
        }

        // Inicializar Socket.io con el servidor
        io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            pingTimeout: 60000,
            pingInterval: 25000
        });

        // Configurar eventos de Socket.io
        io.on('connection', (socket) => {
            console.log('🔌 [SOCKET.IO] Cliente conectado:', socket.id);

            // Enviar datos iniciales al conectar
            socket.emit('connection-status', { connected: whatsappListo });

            // Enviar chats iniciales
            emitirActualizacionChats();

            // Manejar solicitud manual de actualización
            socket.on('request-chats-update', () => {
                console.log('🔄 [SOCKET.IO] Cliente solicitó actualización de chats');
                emitirActualizacionChats();
            });

            // Manejar desconexión
            socket.on('disconnect', () => {
                console.log('🔌 [SOCKET.IO] Cliente desconectado:', socket.id);
            });
        });

        console.log('✅ [SOCKET.IO] Sistema de WebSockets inicializado');

        // Cargar estados persistidos antes de iniciar
        console.log('🔄 Cargando estados de chats persistidos...');
        cargarEstados();


        // Iniciar cliente de WhatsApp EN PARALELO (no bloqueante)
        console.log('🚀 Iniciando cliente de WhatsApp...');
        startCleanClient().catch(error => {
            console.error('❌ Error iniciando cliente de WhatsApp:', error);
        });
        
        // Limpiar mensajes duplicados existentes
        setTimeout(() => {
            const duplicadosEliminados = limpiarMensajesDuplicados();
            console.log(`🎯 Servidor iniciado con ${duplicadosEliminados} mensajes duplicados eliminados`);
        }, 3000);

    } catch (error) {
        console.error('❌ Error inicializando sistema de autenticación:', error.message);
        console.log('⚠️  Iniciando servidor y cliente de WhatsApp sin sistema de autenticación...');
        
        // Cargar estados persistidos antes de iniciar
        console.log('🔄 Cargando estados de chats persistidos...');
        cargarEstados();

        // Iniciar servidor y cliente aunque falle la inicialización del sistema
        const PORT = process.env.PORT || 3000;
        let server;

        if (useHTTPS && sslOptions) {
            server = https.createServer(sslOptions, app);
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`⚠️ Puerto ${PORT} ya está en uso - otra instancia está corriendo`);
                    console.log('✅ Continuando con el cliente de WhatsApp...');
                    // NO hacer process.exit, permitir que continúe
                } else {
                    console.error('❌ Error en el servidor:', err);
                }
            });
            server.listen(PORT, () => {
                registrarLog(`API escuchando en https://localhost:${PORT}`);
                registrarLog(`Panel web disponible en https://localhost:${PORT}`);
                console.log('🔒 Servidor HTTPS iniciado correctamente (sin auth)');
            });
        } else {
            server = http.createServer(app);
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`⚠️ Puerto ${PORT} ya está en uso - otra instancia está corriendo`);
                    console.log('✅ Continuando con el cliente de WhatsApp...');
                    // NO hacer process.exit, permitir que continúe
                } else {
                    console.error('❌ Error en el servidor:', err);
                }
            });
            server.listen(PORT, () => {
                registrarLog(`API escuchando en http://localhost:${PORT}`);
                registrarLog(`Panel web disponible en http://localhost:${PORT}`);
                console.log('🌐 Servidor HTTP iniciado correctamente (sin auth)');
            });
        }

        // Inicializar Socket.io con el servidor (fallback)
        io = new Server(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            pingTimeout: 60000,
            pingInterval: 25000
        });

        io.on('connection', (socket) => {
            console.log('🔌 [SOCKET.IO] Cliente conectado:', socket.id);
            socket.emit('connection-status', { connected: whatsappListo });
            emitirActualizacionChats();
            socket.on('request-chats-update', () => {
                console.log('🔄 [SOCKET.IO] Cliente solicitó actualización de chats');
                emitirActualizacionChats();
            });
            socket.on('disconnect', () => {
                console.log('🔌 [SOCKET.IO] Cliente desconectado:', socket.id);
            });
        });

        console.log('✅ [SOCKET.IO] Sistema de WebSockets inicializado (fallback)');

        // Iniciar cliente limpio EN PARALELO (no bloqueante)
        startCleanClient().catch(error => {
            console.error('❌ Error iniciando cliente de WhatsApp (sin auth):', error);
        });

        // Limpiar mensajes duplicados existentes
        setTimeout(() => {
            const duplicadosEliminados = limpiarMensajesDuplicados();
            console.log(`🎯 Servidor iniciado con ${duplicadosEliminados} mensajes duplicados eliminados`);
        }, 3000);

        // Iniciar monitoreo de desconexión para emails
        startDisconnectionMonitor();
    }
}

// Variable para evitar múltiples monitores de desconexión
let monitorDesconexionIniciado = false;

// Función para monitorear desconexión y enviar emails
function startDisconnectionMonitor() {
    if (monitorDesconexionIniciado) {
        console.log('🔄 Monitor de desconexión ya está activo, evitando duplicación');
        return;
    }
    monitorDesconexionIniciado = true;
    console.log('📧 Monitor de desconexión de email iniciado - revisando cada minuto');

    setInterval(async () => {
        const now = Date.now();
        
        // Agregar logs detallados para debug
        console.log(`🔍 [EMAIL-MONITOR] WhatsApp listo: ${whatsappListo}, Desconectado desde: ${whatsappDisconnectedSince > 0 ? new Date(whatsappDisconnectedSince).toLocaleTimeString() : 'No'}`);
        
        // Si WhatsApp está desconectado o no está listo
        if (!whatsappListo) {
            // Si no tenemos marcado el momento de desconexión, marcarlo ahora
            if (whatsappDisconnectedSince === 0) {
                whatsappDisconnectedSince = Date.now();
                console.log('🚨 [EMAIL-MONITOR] WhatsApp no está listo - marcando como desconectado');
            }
            
            const timeSinceLastEmail = now - lastEmailSent;
            const timeSinceDisconnection = now - whatsappDisconnectedSince;
            
            console.log(`📧 [EMAIL-MONITOR] Tiempo desde último email: ${Math.floor(timeSinceLastEmail/1000/60)} min`);
            console.log(`⏰ [EMAIL-MONITOR] Tiempo desconectado: ${Math.floor(timeSinceDisconnection/1000/60)} min`);
            
            // Enviar email si han pasado 5 minutos desde el último email (o es el primero)
            if (timeSinceLastEmail >= EMAIL_INTERVAL || lastEmailSent === 0) {
                // Solo enviar si lleva al menos 1 minuto desconectado (evitar falsos positivos)
                if (timeSinceDisconnection >= 60000) {
                    console.log('📧 [EMAIL-MONITOR] Enviando email de desconexión...');
                    await sendDisconnectionEmail();
                } else {
                    console.log('⏳ [EMAIL-MONITOR] Esperando 1 minuto mínimo antes de enviar email');
                }
            } else {
                console.log('⏳ [EMAIL-MONITOR] Esperando intervalo de 5 minutos para próximo email');
            }
        } else {
            console.log('✅ [EMAIL-MONITOR] WhatsApp conectado - no se enviarán emails');
        }
    }, 60000); // Revisar cada minuto
    
    console.log('📧 Monitor de desconexión de email iniciado - revisando cada minuto');
}

// Iniciar todo el sistema
inicializarSistemaCompleto();

// Comentado para evitar duplicación del monitor de desconexión
// setTimeout(() => {
//     console.log('🔄 Iniciando monitor de desconexión como fallback...');
//     startDisconnectionMonitor();
// }, 10000); // Esperar 10 segundos después del inicio