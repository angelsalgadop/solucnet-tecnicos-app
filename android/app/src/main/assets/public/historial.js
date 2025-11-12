// ============================================
// HISTORIAL DE CHATS - FRONTEND JAVASCRIPT
// ============================================

let contactos = [];
let contactoActual = null;
let mensajesActuales = [];
let sincronizandoGlobal = false;

// Variables de paginación
let mensajesTotales = 0;
let mensajesCargados = 0;
let cargandoMensajes = false;
const MENSAJES_POR_PAGINA = 300; // Cargar 300 mensajes iniciales

// ============================================
// INICIALIZACIÓN
// ============================================
// Función auxiliar para obtener token de cualquier ubicación
function obtenerToken() {
    return localStorage.getItem('token') ||
           sessionStorage.getItem('token') ||
           localStorage.getItem('chatbot_token') ||
           sessionStorage.getItem('chatbot_token');
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📱 Iniciando módulo de historial de chats...');

    // DEBUG: Ver todos los tokens disponibles
    console.log('🔍 DEBUG - Tokens en localStorage:');
    console.log('  - token:', localStorage.getItem('token') ? 'SÍ' : 'NO');
    console.log('  - chatbot_token:', localStorage.getItem('chatbot_token') ? 'SÍ' : 'NO');
    console.log('🔍 DEBUG - Tokens en sessionStorage:');
    console.log('  - token:', sessionStorage.getItem('token') ? 'SÍ' : 'NO');
    console.log('  - chatbot_token:', sessionStorage.getItem('chatbot_token') ? 'SÍ' : 'NO');

    // Verificar autenticación
    const token = obtenerToken();

    // Mostrar estado del token visualmente
    const tokenDebug = {
        localStorage_token: localStorage.getItem('token') ? '✅' : '❌',
        localStorage_chatbot: localStorage.getItem('chatbot_token') ? '✅' : '❌',
        sessionStorage_token: sessionStorage.getItem('token') ? '✅' : '❌',
        sessionStorage_chatbot: sessionStorage.getItem('chatbot_token') ? '✅' : '❌'
    };

    if (!token) {
        console.log('❌ No hay token, redirigiendo a login...');
        const mensaje = `❌ NO HAY SESIÓN ACTIVA

Debug de tokens:
• localStorage.token: ${tokenDebug.localStorage_token}
• localStorage.chatbot_token: ${tokenDebug.localStorage_chatbot}
• sessionStorage.token: ${tokenDebug.sessionStorage_token}
• sessionStorage.chatbot_token: ${tokenDebug.sessionStorage_chatbot}

Por favor:
1. Ve a la página principal: /
2. Inicia sesión
3. Regresa al historial`;

        alert(mensaje);
        window.location.href = '/';
        return;
    }
    console.log('✅ Token encontrado:', token.substring(0, 20) + '...');

    // Cargar contactos
    await cargarContactos();

    // Cargar estado de sincronización
    await cargarEstadoSync();

    // Configurar event listeners
    configurarEventListeners();

    console.log('✅ Módulo de historial inicializado');
});

// ============================================
// CONFIGURAR EVENT LISTENERS
// ============================================
function configurarEventListeners() {
    // Botón de sincronización
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', iniciarSincronizacion);
    }

    // Botón para ver chats disponibles
    const viewChatsBtn = document.getElementById('viewChatsBtn');
    if (viewChatsBtn) {
        viewChatsBtn.addEventListener('click', verChatsDisponibles);
    }

    // Búsqueda de contactos
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', filtrarContactos);
    }
}

// ============================================
// CARGAR LISTA DE CONTACTOS
// ============================================
async function cargarContactos() {
    try {
        const token = obtenerToken();

        const response = await fetch('/api/chat/contactos', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        // Verificar si la respuesta es JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('❌ La respuesta no es JSON:', await response.text());
            throw new Error('Error de servidor: respuesta inválida');
        }

        const data = await response.json();

        if (data.success) {
            contactos = data.contactos;
            renderizarContactos(contactos);
            console.log(`✅ ${contactos.length} contactos cargados`);
        } else {
            throw new Error(data.error || 'Error cargando contactos');
        }
    } catch (error) {
        console.error('❌ Error cargando contactos:', error);
        mostrarError('Error al cargar contactos. Por favor, recarga la página.');
    }
}

// ============================================
// RENDERIZAR LISTA DE CONTACTOS
// ============================================
function renderizarContactos(contactosFiltrados) {
    const contactsList = document.getElementById('contactsList');

    if (!contactosFiltrados || contactosFiltrados.length === 0) {
        contactsList.innerHTML = `
            <div style="padding: 40px; text-align: center; color: #667781;">
                <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
                <p>No hay chats disponibles</p>
                <p style="font-size: 12px;">Sincroniza tus chats desde WhatsApp</p>
            </div>
        `;
        return;
    }

    contactsList.innerHTML = contactosFiltrados.map(contacto => `
        <div class="contact-item ${contacto.modoChat === 'humano' ? 'modo-humano' : ''}" onclick="seleccionarContacto('${contacto.numero}')">
            <div class="contact-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="contact-info">
                <div class="contact-header">
                    <span class="contact-name">
                        ${contacto.modoChat === 'humano' ? '👤 ' : '🤖 '}${escapeHtml(contacto.nombre)}
                    </span>
                    <span class="contact-time">${formatearFechaRelativa(contacto.ultimaFecha)}</span>
                </div>
                <div class="contact-preview">
                    ${contacto.modoChat === 'humano' ? '<span style="color: #00a884; font-weight: bold;">🟢 MODO HUMANO</span> - ' : ''}${escapeHtml(contacto.ultimoMensaje).substring(0, 50)}${contacto.ultimoMensaje.length > 50 ? '...' : ''}
                </div>
            </div>
            <button class="btn-toggle-modo" onclick="cambiarModoChat(event, '${contacto.numero}', '${contacto.modoChat}')" title="Cambiar a modo ${contacto.modoChat === 'humano' ? 'bot' : 'humano'}">
                <i class="fas ${contacto.modoChat === 'humano' ? 'fa-robot' : 'fa-user'}"></i>
            </button>
        </div>
    `).join('');
}

// ============================================
// SELECCIONAR CONTACTO Y CARGAR MENSAJES
// ============================================
async function seleccionarContacto(numero) {
    contactoActual = contactos.find(c => c.numero === numero);

    if (!contactoActual) {
        console.error('Contacto no encontrado:', numero);
        return;
    }

    // Marcar contacto como activo
    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');

    // Cargar mensajes
    await cargarMensajes(numero);

    // En móvil, mostrar el panel de chat
    const chatPanel = document.getElementById('chatPanel');
    if (window.innerWidth <= 768) {
        chatPanel.classList.add('active');
    }
}

// ============================================
// CARGAR MENSAJES DE UN CONTACTO
// ============================================
async function cargarMensajes(numero, esInicial = true) {
    try {
        if (cargandoMensajes) {
            console.log('⏳ Ya hay una carga en progreso...');
            return;
        }

        cargandoMensajes = true;
        const token = obtenerToken();

        if (esInicial) {
            mensajesActuales = [];
            mensajesCargados = 0;
            mensajesTotales = 0;
            console.log(`📥 Cargando mensajes iniciales para ${numero}...`);
        } else {
            console.log(`📥 Cargando más mensajes para ${numero}... (${mensajesCargados} de ${mensajesTotales})`);
        }

        // Obtener los mensajes más recientes primero (ORDER BY DESC en backend)
        // Cargar solo MENSAJES_POR_PAGINA mensajes a la vez
        const offset = esInicial ? 0 : mensajesCargados;
        const response = await fetch(`/api/chat/mensajes/${numero}?limit=${MENSAJES_POR_PAGINA}&offset=${offset}&order=desc`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(`📊 Respuesta recibida - Status: ${response.status}`);

        // Verificar si la respuesta es JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('❌ La respuesta no es JSON:', textResponse);
            throw new Error('Error de servidor: respuesta inválida');
        }

        const data = await response.json();
        console.log('📦 Datos recibidos:', data);

        if (data.success) {
            const nuevosMensajes = data.mensajes || [];
            mensajesTotales = data.total || 0;

            if (esInicial) {
                mensajesActuales = nuevosMensajes.reverse(); // Revertir para orden cronológico
                mensajesCargados = nuevosMensajes.length;
                renderizarChat(mensajesActuales);
            } else {
                // Agregar mensajes antiguos al principio
                mensajesActuales = [...nuevosMensajes.reverse(), ...mensajesActuales];
                mensajesCargados += nuevosMensajes.length;
                actualizarChat(mensajesActuales, false); // No hacer scroll al final
            }

            console.log(`✅ ${nuevosMensajes.length} mensajes cargados. Total: ${mensajesCargados} de ${mensajesTotales}`);
        } else {
            throw new Error(data.error || 'Error cargando mensajes');
        }
    } catch (error) {
        console.error('❌ Error cargando mensajes:', error);
        console.error('Stack:', error.stack);
        mostrarError('Error al cargar mensajes: ' + error.message);
    } finally {
        cargandoMensajes = false;
    }
}

// ============================================
// FUNCIÓN AUXILIAR PARA ACTUALIZAR CHAT (sin reemplazar todo)
// ============================================
function actualizarChat(mensajes, scrollAlFinal = true) {
    try {
        const messagesContainer = document.getElementById('messagesContainer');
        if (!messagesContainer) return;

        // Guardar posición de scroll actual
        const scrollPosPrevio = messagesContainer.scrollTop;

        // Agrupar mensajes por fecha
        const mensajesPorFecha = agruparPorFecha(mensajes);

        const htmlMensajes = Object.keys(mensajesPorFecha).map(fecha => {
            const mensajesDia = mensajesPorFecha[fecha];
            return `
                <div class="date-divider">
                    <span class="date-badge">${fecha}</span>
                </div>
                ${mensajesDia.map(mensaje => renderizarMensaje(mensaje)).join('')}
            `;
        }).join('');

        // Botón cargar más (si hay más mensajes)
        const botonCargarMas = mensajesCargados < mensajesTotales ? `
            <div style="text-align: center; padding: 15px;">
                <button onclick="cargarMasMensajes()" class="btn-cargar-mas" style="background: #00a884; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-arrow-up"></i> Cargar mensajes antiguos (${mensajesTotales - mensajesCargados} restantes)
                </button>
            </div>
        ` : '';

        messagesContainer.innerHTML = botonCargarMas + htmlMensajes;

        // Restaurar posición de scroll (para cuando se cargan mensajes antiguos)
        if (!scrollAlFinal) {
            setTimeout(() => {
                messagesContainer.scrollTop = scrollPosPrevio + 100; // Mantener posición aprox
            }, 50);
        } else {
            // Scroll al final
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 100);
        }

        console.log('✅ Chat actualizado correctamente');
    } catch (error) {
        console.error('❌ Error actualizando chat:', error);
    }
}

// ============================================
// RENDERIZAR CHAT
// ============================================
function renderizarChat(mensajes) {
    try {
        const chatPanel = document.getElementById('chatPanel');

        if (!chatPanel) {
            console.error('❌ No se encontró el elemento chatPanel');
            return;
        }

        if (!contactoActual) {
            console.error('❌ No hay contacto actual seleccionado');
            return;
        }

        if (!mensajes || mensajes.length === 0) {
            chatPanel.innerHTML = `
                <div class="chat-header">
                    <button class="chat-back-btn" onclick="volverAContactos()">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <div class="chat-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div class="chat-info">
                        <div class="chat-name">${escapeHtml(contactoActual.nombre)}</div>
                        <div class="chat-status">${contactoActual.numero}</div>
                    </div>
                    <button class="chat-search-btn" onclick="toggleChatSearch()" title="Buscar en chat">
                        <i class="fas fa-search"></i>
                    </button>
                </div>
                <div class="chat-search-bar" id="chatSearchBar">
                    <div class="chat-search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" class="chat-search-input" id="chatSearchInput" placeholder="Buscar en mensajes..." oninput="buscarEnChat(this.value)">
                    </div>
                    <span class="chat-search-results" id="chatSearchResults"></span>
                    <button class="chat-search-close" onclick="toggleChatSearch()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="messages-container">
                    <div style="text-align: center; padding: 40px; color: #667781;">
                        <i class="fas fa-comment-slash" style="font-size: 48px; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p>No hay mensajes en este chat</p>
                    </div>
                </div>
            `;
            return;
        }

        console.log(`📝 Renderizando ${mensajes.length} mensajes de ${mensajesTotales} totales...`);

        // Agrupar mensajes por fecha
        const mensajesPorFecha = agruparPorFecha(mensajes);

        const htmlMensajes = Object.keys(mensajesPorFecha).map(fecha => {
            const mensajesDia = mensajesPorFecha[fecha];
            console.log(`📅 ${fecha}: ${mensajesDia.length} mensajes`);

            const mensajesHTML = mensajesDia.map((mensaje, idx) => {
                const html = renderizarMensaje(mensaje);
                if (!html || html.trim() === '') {
                    console.warn('⚠️ Mensaje sin HTML:', mensaje);
                }
                // Log primer mensaje de cada día para debug
                if (idx === 0) {
                    console.log(`🔍 Primer mensaje de ${fecha}:`, {
                        tipo: mensaje.tipo_mensaje,
                        texto: mensaje.contenido_texto?.substring(0, 30),
                        htmlLength: html?.length || 0
                    });
                }
                return html;
            }).join('');

            return `
                <div class="date-divider">
                    <span class="date-badge">${fecha}</span>
                </div>
                ${mensajesHTML}
            `;
        }).join('');

        // Botón cargar más (si hay más mensajes)
        const botonCargarMas = mensajesCargados < mensajesTotales ? `
            <div style="text-align: center; padding: 15px;">
                <button onclick="cargarMasMensajes()" class="btn-cargar-mas" style="background: #00a884; color: white; border: none; padding: 10px 20px; border-radius: 20px; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-arrow-up"></i> Cargar mensajes antiguos (${mensajesTotales - mensajesCargados} restantes)
                </button>
            </div>
        ` : '';

        chatPanel.innerHTML = `
            <div class="chat-header">
                <button class="chat-back-btn" onclick="volverAContactos()">
                    <i class="fas fa-arrow-left"></i>
                </button>
                <div class="chat-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <div class="chat-info">
                    <div class="chat-name">${escapeHtml(contactoActual.nombre)}</div>
                    <div class="chat-status">${contactoActual.numero} • ${mensajesCargados} de ${mensajesTotales} mensajes</div>
                </div>
                <button class="chat-search-btn" onclick="toggleChatSearch()" title="Buscar en chat">
                    <i class="fas fa-search"></i>
                </button>
            </div>
            <div class="chat-search-bar" id="chatSearchBar">
                <div class="chat-search-box">
                    <i class="fas fa-search"></i>
                    <input type="text" class="chat-search-input" id="chatSearchInput" placeholder="Buscar en mensajes..." oninput="buscarEnChat(this.value)">
                </div>
                <span class="chat-search-results" id="chatSearchResults"></span>
                <button class="chat-search-close" onclick="toggleChatSearch()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="messages-container" id="messagesContainer">
                ${botonCargarMas}
                ${htmlMensajes}
            </div>
        `;

        // Scroll al final
        setTimeout(() => {
            const messagesContainer = document.getElementById('messagesContainer');
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }, 100);

        console.log('✅ Chat renderizado correctamente');
    } catch (error) {
        console.error('❌ Error renderizando chat:', error);
        console.error('Stack:', error.stack);
        mostrarError('Error al renderizar el chat: ' + error.message);
    }
}

// ============================================
// CARGAR MÁS MENSAJES
// ============================================
async function cargarMasMensajes() {
    if (!contactoActual || cargandoMensajes) return;
    await cargarMensajes(contactoActual.numero, false);
}

// ============================================
// RENDERIZAR UN MENSAJE
// ============================================
function renderizarMensaje(mensaje) {
    try {
        if (!mensaje) {
            console.error('❌ Mensaje nulo o undefined');
            return '';
        }

        const tipo = mensaje.from_me ? 'sent' : 'received';
        const hora = new Date(mensaje.fecha_mensaje).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let contenido = '';

        // Debug: Log primeros mensajes
        if (Math.random() < 0.05) { // 5% de los mensajes para debug
            console.log('🔍 DEBUG Mensaje:', {
                tipo: mensaje.tipo_mensaje,
                texto: mensaje.contenido_texto?.substring(0, 50),
                from_me: mensaje.from_me,
                tiene_media: !!mensaje.media_url
            });
        }

        // Debug: Log message type for troubleshooting
        if (!mensaje.tipo_mensaje || mensaje.tipo_mensaje === '' || !['text', 'image', 'video', 'audio', 'document', 'ptt', 'sticker', 'location', 'vcard', 'call_log', 'chat', 'album'].includes(mensaje.tipo_mensaje)) {
            console.warn('⚠️ Mensaje con tipo desconocido:', mensaje.tipo_mensaje, 'Mensaje:', mensaje);
        }

        // Manejar diferentes tipos de mensajes
        if (mensaje.tipo_mensaje === 'text') {
            contenido = `<div class="message-text">${escapeHtml(mensaje.contenido_texto || '')}</div>`;
        } else if (['image', 'video'].includes(mensaje.tipo_mensaje)) {
            if (mensaje.media_url && mensaje.media_url.startsWith('data:')) {
                // Base64 directo
                if (mensaje.tipo_mensaje === 'image') {
                    // Imágenes - thumbnail clickeable
                    contenido = `
                        <div class="message-media">
                            <img src="${escapeHtml(mensaje.media_url)}"
                                 class="message-image-thumbnail"
                                 onclick="abrirImagenModal('${escapeHtml(mensaje.media_url)}')"
                                 onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'message-text\\'><i>❌ Imagen no disponible</i></div>'">
                        </div>
                        ${mensaje.contenido_texto ? `<div class="message-text">${escapeHtml(mensaje.contenido_texto)}</div>` : ''}
                    `;
                } else {
                    // Videos
                    contenido = `
                        <div class="message-media">
                            <video src="${escapeHtml(mensaje.media_url)}" controls class="message-video" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'message-text\\'><i>❌ Video no disponible</i></div>'">
                        </div>
                        ${mensaje.contenido_texto ? `<div class="message-text">${escapeHtml(mensaje.contenido_texto)}</div>` : ''}
                    `;
                }
            } else if (mensaje.media_url && mensaje.media_url.startsWith('whatsapp-media://')) {
                // Carga bajo demanda
                const messageId = mensaje.media_url.replace('whatsapp-media://', '');
                contenido = `
                    <div class="message-media" id="media-${escapeHtml(mensaje.mensaje_id)}">
                        <button class="load-media-btn" onclick="cargarMedia('${escapeHtml(messageId)}', '${escapeHtml(mensaje.mensaje_id)}', '${mensaje.tipo_mensaje}')">
                            <i class="fas fa-download"></i> Cargar ${mensaje.tipo_mensaje}
                        </button>
                    </div>
                    ${mensaje.contenido_texto ? `<div class="message-text">${escapeHtml(mensaje.contenido_texto)}</div>` : ''}
                `;
            } else {
                // Media no disponible - mostrar información del archivo
                const fileName = mensaje.media_filename || `${mensaje.tipo_mensaje}`;
                const fileSize = mensaje.media_size ? formatearTamaño(mensaje.media_size) : '';
                contenido = `
                    <div class="message-text" style="background: #fff3cd; color: #856404; padding: 8px; border-radius: 4px;">
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>${mensaje.tipo_mensaje === 'image' ? 'Imagen' : 'Video'} no sincronizado</strong>
                        ${fileName ? `<br><small>${escapeHtml(fileName)}</small>` : ''}
                        ${fileSize ? `<br><small>${fileSize}</small>` : ''}
                        <br><small style="opacity: 0.7;">Vuelve a sincronizar para descargar este archivo</small>
                    </div>
                `;
            }
        } else if (['document', 'audio', 'ptt'].includes(mensaje.tipo_mensaje)) {
            const icon = mensaje.tipo_mensaje === 'audio' || mensaje.tipo_mensaje === 'ptt' ? 'fa-microphone' : 'fa-file';
            if (mensaje.media_url && mensaje.media_url.startsWith('data:')) {
                // Base64 directo - renderizar directamente
                if (mensaje.tipo_mensaje === 'audio' || mensaje.tipo_mensaje === 'ptt') {
                    // Audios y notas de voz
                    contenido = `
                        <div class="message-audio">
                            <audio controls controlsList="nodownload">
                                <source src="${mensaje.media_url}" type="${mensaje.media_mimetype || 'audio/ogg'}">
                                Tu navegador no soporta audio.
                            </audio>
                        </div>
                        ${mensaje.contenido_texto ? `<div class="message-text">${escapeHtml(mensaje.contenido_texto)}</div>` : ''}
                    `;
                } else {
                    // Documentos
                    contenido = `
                        <div class="message-document" onclick="window.open('${escapeHtml(mensaje.media_url)}', '_blank')">
                            <i class="fas ${icon}"></i>
                            <div class="document-info">
                                <div class="document-name">${escapeHtml(mensaje.media_filename || 'Archivo')}</div>
                                ${mensaje.media_size ? `<div class="document-size">${formatearTamaño(mensaje.media_size)}</div>` : ''}
                            </div>
                        </div>
                        ${mensaje.contenido_texto ? `<div class="message-text">${escapeHtml(mensaje.contenido_texto)}</div>` : ''}
                    `;
                }
            } else if (mensaje.media_url && mensaje.media_url.startsWith('whatsapp-media://')) {
                // Carga bajo demanda
                const messageId = mensaje.media_url.replace('whatsapp-media://', '');
                contenido = `
                    <div class="message-media" id="media-${escapeHtml(mensaje.mensaje_id)}">
                        <button class="load-media-btn" onclick="cargarMedia('${escapeHtml(messageId)}', '${escapeHtml(mensaje.mensaje_id)}', '${mensaje.tipo_mensaje}')">
                            <i class="fas ${icon}"></i> Cargar ${mensaje.tipo_mensaje === 'ptt' ? 'audio' : mensaje.tipo_mensaje}
                        </button>
                    </div>
                    ${mensaje.contenido_texto ? `<div class="message-text">${escapeHtml(mensaje.contenido_texto)}</div>` : ''}
                `;
            } else {
                // Media no disponible - mostrar información del archivo
                const tipoTexto = mensaje.tipo_mensaje === 'ptt' ? 'Nota de voz' :
                                  mensaje.tipo_mensaje === 'audio' ? 'Audio' : 'Documento';
                const fileName = mensaje.media_filename || `${mensaje.tipo_mensaje}`;
                const fileSize = mensaje.media_size ? formatearTamaño(mensaje.media_size) : '';
                contenido = `
                    <div class="message-text" style="background: #fff3cd; color: #856404; padding: 8px; border-radius: 4px;">
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>${tipoTexto} no sincronizado</strong>
                        ${fileName ? `<br><small>${escapeHtml(fileName)}</small>` : ''}
                        ${fileSize ? `<br><small>${fileSize}</small>` : ''}
                        <br><small style="opacity: 0.7;">Vuelve a sincronizar para descargar este archivo</small>
                    </div>
                `;
            }
        } else if (mensaje.tipo_mensaje === 'sticker') {
            // Stickers
            contenido = `<div class="message-text"><i>🎭 Sticker</i></div>`;
        } else if (mensaje.tipo_mensaje === 'location') {
            // Ubicación
            contenido = `<div class="message-text"><i class="fas fa-map-marker-alt"></i> Ubicación compartida</div>`;
        } else if (mensaje.tipo_mensaje === 'vcard') {
            // Contacto
            contenido = `<div class="message-text"><i class="fas fa-address-card"></i> Contacto compartido</div>`;
        } else if (mensaje.tipo_mensaje === 'call_log') {
            // Llamada
            contenido = `<div class="message-text"><i class="fas fa-phone"></i> Llamada</div>`;
        } else if (mensaje.tipo_mensaje === 'chat') {
            // Mensaje de chat (mensaje del sistema o sin contenido específico)
            const textoMensaje = mensaje.contenido_texto || 'Mensaje de chat';
            contenido = `<div class="message-text"><i class="fas fa-comment"></i> ${escapeHtml(textoMensaje)}</div>`;
        } else if (mensaje.tipo_mensaje === 'album') {
            // Álbum de fotos/videos
            contenido = `<div class="message-text"><i class="fas fa-images"></i> Álbum de medios${mensaje.contenido_texto ? ': ' + escapeHtml(mensaje.contenido_texto) : ''}</div>`;
        } else {
            // Otros tipos de mensajes
            contenido = `<div class="message-text"><i>📎 ${mensaje.tipo_mensaje}</i></div>`;
        }

        return `
            <div class="message ${tipo}">
                <div class="message-bubble">
                    ${contenido}
                    <div class="message-time">
                        ${hora}
                        ${tipo === 'sent' ? '<i class="fas fa-check-double check-icon"></i>' : ''}
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('❌ Error renderizando mensaje:', error, mensaje);
        return `
            <div class="message received">
                <div class="message-bubble">
                    <div class="message-text"><i>⚠️ Error mostrando mensaje</i></div>
                </div>
            </div>
        `;
    }
}

// ============================================
// INICIAR SINCRONIZACIÓN
// ============================================
async function iniciarSincronizacion() {
    if (sincronizandoGlobal) {
        alert('Ya hay una sincronización en curso');
        return;
    }

    const confirmacion = confirm('¿Deseas sincronizar el historial de chats desde WhatsApp?\n\nEsto puede tardar varios minutos dependiendo de la cantidad de mensajes.');

    if (!confirmacion) return;

    sincronizandoGlobal = true;

    try {
        const token = obtenerToken();

        if (!token) {
            throw new Error('No hay token de autenticación. Por favor, inicia sesión nuevamente.');
        }

        // Mostrar barra de progreso
        mostrarBarraProgreso();

        const response = await fetch('/api/chat/sync', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Verificar si la respuesta es JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('❌ La respuesta no es JSON:', textResponse);
            throw new Error('Error de servidor: respuesta inválida. Verifica que estés autenticado correctamente.');
        }

        const data = await response.json();

        if (data.success) {
            console.log(`🔄 Sincronización iniciada: ${data.totalChats} chats`);

            // Monitorear progreso
            monitorearProgreso(data.totalChats);
        } else {
            throw new Error(data.error || 'Error iniciando sincronización');
        }
    } catch (error) {
        console.error('❌ Error iniciando sincronización:', error);
        alert('Error al iniciar la sincronización: ' + error.message);
        ocultarBarraProgreso();
        sincronizandoGlobal = false;
    }
}

// ============================================
// MONITOREAR PROGRESO DE SINCRONIZACIÓN
// ============================================
async function monitorearProgreso(totalChats) {
    const intervalo = setInterval(async () => {
        try {
            const token = obtenerToken();

            const response = await fetch('/api/chat/sync-status', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success) {
                // Verificar si hay sincronización en progreso
                if (data.sincronizacionEnProgreso && data.progresoActual) {
                    const progreso = data.progresoActual;

                    actualizarBarraProgreso(
                        progreso.porcentaje,
                        `Sincronizando... ${progreso.chatsProcessed} de ${progreso.totalChats} contactos`,
                        `${progreso.totalMensajes} mensajes sincronizados`
                    );
                } else {
                    // La sincronización terminó
                    clearInterval(intervalo);

                    const stats = data.stats;
                    actualizarBarraProgreso(
                        100,
                        'Sincronización completada',
                        `${stats.total_mensajes || 0} mensajes sincronizados`
                    );

                    setTimeout(() => {
                        ocultarBarraProgreso();
                        sincronizandoGlobal = false;
                        cargarContactos(); // Recargar contactos
                        alert(`✅ Sincronización completada!\n\n${stats.total_mensajes || 0} mensajes sincronizados de ${stats.total_contactos || 0} contactos.`);
                    }, 2000);
                }
            }
        } catch (error) {
            console.error('Error monitoreando progreso:', error);
        }
    }, 2000); // Actualizar cada 2 segundos
}

// ============================================
// CARGAR ESTADO DE SINCRONIZACIÓN
// ============================================
async function cargarEstadoSync() {
    try {
        const token = obtenerToken();

        const response = await fetch('/api/chat/sync-status', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            console.log('📊 Estado de sincronización:', data.stats);

            // Si hay una sincronización en progreso, reanudar el monitoreo
            if (data.sincronizacionEnProgreso && data.progresoActual) {
                console.log('🔄 Sincronización en progreso detectada, reanudando monitoreo...');
                sincronizandoGlobal = true;
                mostrarBarraProgreso();
                monitorearProgreso(data.progresoActual.totalChats);
            }
        }
    } catch (error) {
        console.error('Error cargando estado de sync:', error);
    }
}

// ============================================
// FUNCIONES DE BARRA DE PROGRESO
// ============================================
function mostrarBarraProgreso() {
    const progressBar = document.getElementById('syncProgressBar');
    if (progressBar) {
        progressBar.classList.add('active');
    }
}

function ocultarBarraProgreso() {
    const progressBar = document.getElementById('syncProgressBar');
    if (progressBar) {
        progressBar.classList.remove('active');
    }
}

function actualizarBarraProgreso(porcentaje, texto, stats) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const progressStats = document.getElementById('progressStats');

    if (progressFill) {
        progressFill.style.width = `${porcentaje}%`;
    }

    if (progressText) {
        progressText.textContent = texto;
    }

    if (progressStats) {
        progressStats.textContent = stats;
    }
}

// ============================================
// FILTRAR CONTACTOS
// ============================================
function filtrarContactos(event) {
    const query = event.target.value.toLowerCase();

    if (!query) {
        renderizarContactos(contactos);
        return;
    }

    const filtrados = contactos.filter(contacto =>
        contacto.nombre.toLowerCase().includes(query) ||
        contacto.numero.includes(query) ||
        contacto.ultimoMensaje.toLowerCase().includes(query)
    );

    renderizarContactos(filtrados);
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================
function agruparPorFecha(mensajes) {
    const grupos = {};

    mensajes.forEach(mensaje => {
        const fecha = new Date(mensaje.fecha_mensaje);
        const fechaKey = formatearFecha(fecha);

        if (!grupos[fechaKey]) {
            grupos[fechaKey] = [];
        }

        grupos[fechaKey].push(mensaje);
    });

    return grupos;
}

function formatearFecha(fecha) {
    const hoy = new Date();
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);

    if (fecha.toDateString() === hoy.toDateString()) {
        return 'Hoy';
    } else if (fecha.toDateString() === ayer.toDateString()) {
        return 'Ayer';
    } else {
        return fecha.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
}

function formatearFechaRelativa(fecha) {
    if (!fecha) return '';

    const fechaObj = new Date(fecha);
    const hoy = new Date();

    if (fechaObj.toDateString() === hoy.toDateString()) {
        return fechaObj.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    return fechaObj.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit'
    });
}

function formatearTamaño(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function mostrarError(mensaje) {
    alert('⚠️ ' + mensaje);
}

// ============================================
// CARGAR ARCHIVO MULTIMEDIA BAJO DEMANDA
// ============================================
async function cargarMedia(messageId, elementId, tipoMensaje) {
    try {
        const container = document.getElementById(`media-${elementId}`);
        if (!container) {
            console.error('Contenedor no encontrado:', elementId);
            return;
        }

        // Mostrar indicador de carga
        container.innerHTML = '<div class="loading-media"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';

        const token = obtenerToken();

        console.log(`📥 Descargando media: ${messageId}`);

        const response = await fetch(`/api/chat/media/${encodeURIComponent(messageId)}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success && data.media) {
            console.log(`✅ Media descargado: ${data.media.mimetype}`);

            const mediaUrl = `data:${data.media.mimetype};base64,${data.media.data}`;

            // Renderizar según el tipo
            if (tipoMensaje === 'image') {
                // Imagen con thumbnail clickeable
                container.innerHTML = `<img src="${mediaUrl}" class="message-image-thumbnail" onclick="abrirImagenModal('${mediaUrl.replace(/'/g, "\\'")}')">`;
            } else if (tipoMensaje === 'video') {
                // Video con controles
                container.innerHTML = `<video src="${mediaUrl}" controls class="message-video">`;
            } else if (['audio', 'ptt'].includes(tipoMensaje)) {
                container.innerHTML = `
                    <div class="message-audio">
                        <audio controls controlsList="nodownload">
                            <source src="${mediaUrl}" type="${data.media.mimetype}">
                            Tu navegador no soporta el elemento de audio.
                        </audio>
                    </div>
                `;
            } else {
                // Documento u otro
                container.innerHTML = `
                    <div class="message-document" onclick="window.open('${mediaUrl}', '_blank')">
                        <i class="fas fa-file"></i>
                        <div class="document-info">
                            <div class="document-name">${escapeHtml(data.media.filename)}</div>
                            <div class="document-action">Click para abrir</div>
                        </div>
                    </div>
                `;
            }
        } else {
            throw new Error(data.error || 'No se pudo descargar el archivo');
        }
    } catch (error) {
        console.error('❌ Error cargando media:', error);
        const container = document.getElementById(`media-${elementId}`);
        if (container) {
            container.innerHTML = '<div class="message-text"><i>❌ Error cargando archivo</i></div>';
        }
    }
}

// Hacer la función global para que pueda ser llamada desde onclick
window.cargarMedia = cargarMedia;

// ============================================
// MODAL PARA VER IMÁGENES AMPLIADAS
// ============================================
function abrirImagenModal(imagenUrl) {
    // Crear o obtener el modal
    let modal = document.getElementById('imageModal');

    if (!modal) {
        // Crear el modal si no existe
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.className = 'image-modal';
        modal.innerHTML = `
            <div class="image-modal-content">
                <span class="image-modal-close" onclick="cerrarImagenModal()">&times;</span>
                <img class="image-modal-img" id="modalImage">
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Mostrar la imagen
    const modalImg = document.getElementById('modalImage');
    modalImg.src = imagenUrl;
    modal.style.display = 'flex';

    // Cerrar al hacer click fuera de la imagen
    modal.onclick = function(event) {
        if (event.target === modal) {
            cerrarImagenModal();
        }
    };
}

function cerrarImagenModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Hacer las funciones globales
window.abrirImagenModal = abrirImagenModal;
window.cerrarImagenModal = cerrarImagenModal;

// Cerrar modal con tecla ESC
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        cerrarImagenModal();
    }
});

// ============================================
// FUNCIÓN PARA VOLVER A LA LISTA DE CONTACTOS (MÓVIL)
// ============================================
function volverAContactos() {
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) {
        chatPanel.classList.remove('active');
    }
}

// Hacer la función global
window.volverAContactos = volverAContactos;

// ============================================
// VER CHATS DISPONIBLES EN WHATSAPP
// ============================================
async function verChatsDisponibles() {
    try {
        const token = obtenerToken();

        const viewChatsBtn = document.getElementById('viewChatsBtn');
        if (viewChatsBtn) {
            viewChatsBtn.disabled = true;
            viewChatsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        const response = await fetch('/api/chat/available-chats', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            // Mostrar en un modal o alerta los chats disponibles
            let mensaje = `📊 CHATS DISPONIBLES EN WHATSAPP\n\n`;
            mensaje += `Total de chats: ${data.totalChats}\n`;
            mensaje += `Individuales: ${data.chats.filter(c => !c.esGrupo).length}\n`;
            mensaje += `Grupos: ${data.chats.filter(c => c.esGrupo).length}\n`;
            mensaje += `Archivados: ${data.chats.filter(c => c.archivado).length}\n\n`;
            mensaje += `Los primeros 10 chats:\n`;

            data.chats.slice(0, 10).forEach((chat, idx) => {
                mensaje += `${idx + 1}. ${chat.nombre} (${chat.esGrupo ? 'Grupo' : 'Individual'})\n`;
            });

            if (data.chats.length > 10) {
                mensaje += `\n... y ${data.chats.length - 10} chats más\n`;
            }

            mensaje += `\nRevisa la consola del navegador para ver la lista completa.`;

            console.log('📊 LISTA COMPLETA DE CHATS DISPONIBLES:', data.chats);

            alert(mensaje);
        } else {
            alert(`❌ Error: ${data.error}`);
        }

    } catch (error) {
        console.error('Error obteniendo chats disponibles:', error);
        alert('❌ Error obteniendo chats disponibles');
    } finally {
        const viewChatsBtn = document.getElementById('viewChatsBtn');
        if (viewChatsBtn) {
            viewChatsBtn.disabled = false;
            viewChatsBtn.innerHTML = '<i class="fas fa-list"></i>';
        }
    }
}

// ============================================
// LIMPIAR SINCRONIZACIÓN (FORZAR RE-SYNC)
// ============================================
async function limpiarSincronizacion() {
    const confirmar = confirm(
        '⚠️ ADVERTENCIA:\n\n' +
        'Esto marcará todos los chats como NO sincronizados.\n' +
        'La próxima sincronización descargará TODO el historial de nuevo.\n\n' +
        '¿Estás seguro de continuar?'
    );

    if (!confirmar) {
        return;
    }

    try {
        const token = obtenerToken();

        const clearSyncBtn = document.getElementById('clearSyncBtn');
        if (clearSyncBtn) {
            clearSyncBtn.disabled = true;
            clearSyncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        const response = await fetch('/api/chat/clear-sync', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();

        if (data.success) {
            alert('✅ Sincronización limpiada exitosamente.\n\nAhora puedes iniciar una nueva sincronización completa.');
            // Recargar contactos
            cargarContactos();
        } else {
            alert(`❌ Error: ${data.error}`);
        }

    } catch (error) {
        console.error('Error limpiando sincronización:', error);
        alert('❌ Error limpiando sincronización');
    } finally {
        const clearSyncBtn = document.getElementById('clearSyncBtn');
        if (clearSyncBtn) {
            clearSyncBtn.disabled = false;
            clearSyncBtn.innerHTML = '<i class="fas fa-eraser"></i>';
        }
    }
}

// Función para mostrar/ocultar la barra de búsqueda en el chat
function toggleChatSearch() {
    const searchBar = document.getElementById('chatSearchBar');
    const searchInput = document.getElementById('chatSearchInput');

    if (!searchBar) return;

    if (searchBar.classList.contains('active')) {
        // Cerrar búsqueda
        searchBar.classList.remove('active');
        searchInput.value = '';
        buscarEnChat(''); // Limpiar resaltados
    } else {
        // Abrir búsqueda
        searchBar.classList.add('active');
        setTimeout(() => searchInput.focus(), 100);
    }
}

// Función para buscar en los mensajes del chat
function buscarEnChat(texto) {
    const searchResults = document.getElementById('chatSearchResults');

    // Limpiar búsqueda anterior
    const messages = document.querySelectorAll('.message');
    messages.forEach(msg => {
        msg.classList.remove('highlighted');
        // Restaurar texto original
        const messageText = msg.querySelector('.message-text');
        if (messageText && messageText.dataset.originalText) {
            messageText.innerHTML = messageText.dataset.originalText;
        }
    });

    if (!texto || texto.trim() === '') {
        if (searchResults) searchResults.textContent = '';
        return;
    }

    const searchTerm = texto.toLowerCase().trim();
    let resultadosEncontrados = 0;

    messages.forEach(msg => {
        const messageText = msg.querySelector('.message-text');
        if (!messageText) return;

        const textoMensaje = messageText.textContent.toLowerCase();

        if (textoMensaje.includes(searchTerm)) {
            msg.classList.add('highlighted');
            resultadosEncontrados++;

            // Guardar texto original si no existe
            if (!messageText.dataset.originalText) {
                messageText.dataset.originalText = messageText.innerHTML;
            }

            // Resaltar el término de búsqueda
            const regex = new RegExp(`(${escapeRegex(texto)})`, 'gi');
            const nuevoHTML = messageText.dataset.originalText.replace(
                regex,
                '<span style="background: yellow; font-weight: bold;">$1</span>'
            );
            messageText.innerHTML = nuevoHTML;

            // Scroll al primer resultado
            if (resultadosEncontrados === 1) {
                msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });

    // Mostrar resultados
    if (searchResults) {
        if (resultadosEncontrados > 0) {
            searchResults.textContent = `${resultadosEncontrados} resultado${resultadosEncontrados > 1 ? 's' : ''}`;
        } else {
            searchResults.textContent = 'Sin resultados';
        }
    }
}

// Función auxiliar para escapar caracteres especiales en regex
function escapeRegex(texto) {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// CAMBIAR MODO DE CHAT (BOT/HUMANO)
// ============================================
async function cambiarModoChat(event, numero, modoActual) {
    // Prevenir que se seleccione el contacto al hacer clic en el botón
    event.stopPropagation();

    const nuevoModo = modoActual === 'humano' ? 'bot' : 'humano';
    const confirmacion = confirm(
        `¿Deseas cambiar este chat a modo ${nuevoModo.toUpperCase()}?\n\n` +
        `• MODO BOT: El bot responderá automáticamente\n` +
        `• MODO HUMANO: Requiere atención manual de un asesor`
    );

    if (!confirmacion) return;

    try {
        const token = obtenerToken();

        if (!token) {
            alert(`❌ No hay sesión activa.

Tokens disponibles:
• localStorage.token: ${localStorage.getItem('token') ? '✅' : '❌'}
• localStorage.chatbot_token: ${localStorage.getItem('chatbot_token') ? '✅' : '❌'}

Por favor, inicia sesión nuevamente.`);
            window.location.href = '/';
            return;
        }

        console.log('🔄 Enviando solicitud para cambiar modo:', { numero, nuevoModo });
        console.log('🔑 Token encontrado:', token.substring(0, 20) + '...');

        const response = await fetch('/api/chat/cambiar-modo', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include', // Incluir cookies
            body: JSON.stringify({
                numero: numero,
                modo: nuevoModo
            })
        });

        console.log('📡 Respuesta recibida:', response.status, response.statusText);

        // Verificar si la respuesta es JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await response.text();
            console.error('❌ Respuesta no es JSON:', textResponse.substring(0, 200));

            // Mostrar error detallado
            const errorMsg = `❌ ERROR AL CAMBIAR MODO

Código HTTP: ${response.status} ${response.statusText}
Content-Type: ${contentType || 'ninguno'}

Respuesta del servidor (primeros 200 caracteres):
${textResponse.substring(0, 200)}

¿Es HTML? ${textResponse.includes('<!DOCTYPE') || textResponse.includes('<html') ? 'SÍ' : 'NO'}`;

            alert(errorMsg);

            // Si es HTML, probablemente es login
            if (textResponse.includes('<!DOCTYPE') || textResponse.includes('<html')) {
                window.location.href = '/';
                return;
            }

            throw new Error('Error de servidor: respuesta inválida');
        }

        const data = await response.json();
        console.log('📦 Datos recibidos:', data);

        if (data.success) {
            console.log(`✅ Modo cambiado: ${numero} → ${nuevoModo}`);

            // Recargar la lista de contactos para reflejar el cambio
            await cargarContactos();

            // Mostrar notificación de éxito
            alert(`✅ Chat cambiado a modo ${nuevoModo.toUpperCase()} exitosamente`);
        } else {
            throw new Error(data.error || 'Error cambiando modo');
        }
    } catch (error) {
        console.error('❌ Error cambiando modo:', error);
        alert('❌ Error al cambiar el modo del chat: ' + error.message);
    }
}

// Hacer la función global
window.cambiarModoChat = cambiarModoChat;
