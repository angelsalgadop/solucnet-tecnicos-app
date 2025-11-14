// Variables globales
let visitasAsignadas = [];
let visitasSinFiltrar = []; // Copia sin filtrar para los filtros
let tecnicoActual = null;
let fotosSeleccionadas = [];
let intervaloActualizacion = null; // Intervalo para actualización automática
let ultimaActualizacion = null; // Timestamp de última actualización
let hashVisitasAnterior = null; // Hash para detectar cambios
let visitasConPdfsDescargados = new Set(); // 🔧 v1.62: IDs de visitas con PDFs ya descargados
let intentosGpsUsuario = 0; // 🔧 v1.63: Contador de intentos del usuario para GPS (máximo 3)
const MAX_INTENTOS_GPS_USUARIO = 3; // 🔧 v1.63: Máximo de intentos permitidos

// Elementos del DOM
const visitasContainer = document.getElementById('visitasAsignadas');
const nombreTecnico = document.getElementById('nombreTecnico');

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', function() {
    inicializarSistema();
    configurarEventListeners();
    iniciarActualizacionAutomatica(); // Iniciar actualización automática cada 10 segundos
});

// Configurar event listeners
function configurarEventListeners() {
    // Cerrar sesión
    document.getElementById('btnCerrarSesion').addEventListener('click', function() {
        console.log('🚪 Cerrando sesión...');
        // Limpiar datos de sesión del técnico
        localStorage.removeItem('token_tecnico');
        localStorage.removeItem('user_tecnico');
        localStorage.removeItem('login_timestamp');
        localStorage.removeItem('remember_tecnico');
        sessionStorage.removeItem('user_tecnico');

        // Limpiar también filtros guardados
        localStorage.removeItem('filtro_localidad_tecnico');
        localStorage.removeItem('filtro_estado_tecnico');

        console.log('✅ Sesión cerrada, redirigiendo al login...');
        // Redirigir al login de técnicos
        APP_CONFIG.redirectTo('login_tecnicos.html');
    });

    // Escuchar evento de sincronización completada
    window.addEventListener('offline-sync-completed', async () => {
        console.log('📢 [VISITAS] Sincronización completada, recargando visitas...');
        await cargarVisitasTecnico();

        // 🆕 v1.74.3: Reverificar permisos NAP después de sincronizar
        console.log('🔄 [NAP] Reverificando permisos después de sincronización...');
        await verificarPermisoAgregarNaps();

        mostrarAlerta('✅ Datos sincronizados con el servidor', 'success');
    });

    // Drag and drop para fotos
    const uploadArea = document.querySelector('.file-upload-area');

    if (uploadArea) {
        uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            this.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('dragover');

            const files = e.dataTransfer.files;
            handleFiles(files);
        });
    }
}

// Inicializar sistema
async function inicializarSistema() {
    try {
        // El usuario ya está autenticado (verificado en el HTML)
        // Verificar permisos para agregar cajas NAP
        await verificarPermisoAgregarNaps();
        // Cargar visitas asignadas directamente
        await cargarVisitasTecnico();
    } catch (error) {
        console.error('Error inicializando sistema:', error);
        mostrarAlerta('Error inicializando el sistema', 'danger');
    }
}


// Función simple de hash para comparar datos
function hashSimple(data) {
    return JSON.stringify(data);
}

// 🔧 v1.62: Mostrar barra de progreso inline dentro del contenedor de visitas
function mostrarBarraProgresoInline() {
    const barraHtml = `
        <div id="barraProgresoInline" class="card shadow-sm mb-3" style="border-left: 4px solid #0d6efd;">
            <div class="card-body">
                <div class="d-flex align-items-center mb-2">
                    <div class="spinner-border spinner-border-sm text-primary me-2" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                    <h6 class="mb-0" id="textoProgresoInline">Verificando actualizaciones...</h6>
                </div>
                <div class="progress" style="height: 20px;">
                    <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary"
                         role="progressbar"
                         id="barraProgresoInlineBar"
                         style="width: 0%"
                         aria-valuenow="0"
                         aria-valuemin="0"
                         aria-valuemax="100">
                        <span id="porcentajeInline" class="fw-bold">0%</span>
                    </div>
                </div>
                <small class="text-muted mt-1 d-block" id="contadorInline">Iniciando...</small>
            </div>
        </div>
    `;

    // Insertar al inicio del contenedor (antes de las visitas existentes)
    visitasContainer.insertAdjacentHTML('afterbegin', barraHtml);
}

// 🔧 v1.62: Actualizar barra de progreso inline
function actualizarBarraProgresoInline(texto, porcentaje, contador = '') {
    const textoEl = document.getElementById('textoProgresoInline');
    const barraEl = document.getElementById('barraProgresoInlineBar');
    const porcentajeEl = document.getElementById('porcentajeInline');
    const contadorEl = document.getElementById('contadorInline');

    if (textoEl) textoEl.textContent = texto;
    if (barraEl) {
        barraEl.style.width = `${porcentaje}%`;
        barraEl.setAttribute('aria-valuenow', porcentaje);
    }
    if (porcentajeEl) porcentajeEl.textContent = `${Math.round(porcentaje)}%`;
    if (contadorEl) contadorEl.textContent = contador;
}

// 🔧 v1.62: Ocultar barra de progreso inline
function ocultarBarraProgresoInline() {
    const barra = document.getElementById('barraProgresoInline');
    if (barra) {
        barra.remove();
    }
}

// 🔧 v1.81: Cargar visitas - CACHE PRIMERO, actualización silenciosa DESPUÉS
async function cargarVisitasTecnico(mostrarSpinner = true, esActualizacionBackground = false) {
    try {
        const token = localStorage.getItem('token_tecnico');
        if (!token) {
            APP_CONFIG.redirectTo('login_tecnicos.html');
            return;
        }

        // 🆕 v1.81: PASO 1 - Cargar y RENDERIZAR cache INMEDIATAMENTE
        let cacheRenderizado = false;
        if (visitasAsignadas.length === 0) {
            try {
                const visitasCache = localStorage.getItem('visitas_cache');
                if (visitasCache) {
                    const visitasCargadas = JSON.parse(visitasCache);
                    if (visitasCargadas && visitasCargadas.length > 0) {
                        visitasAsignadas = visitasCargadas;
                        visitasSinFiltrar = [...visitasCargadas];

                        console.log(`📦 [CACHE] ${visitasCargadas.length} visitas cargadas desde localStorage`);

                        // RENDERIZAR INMEDIATAMENTE sin spinner
                        llenarFiltroLocalidades();
                        mostrarVisitasAsignadas();
                        setTimeout(restaurarCronometros, 100);

                        cacheRenderizado = true;
                        console.log('✅ [CACHE] Visitas renderizadas inmediatamente desde cache');
                    }
                }
            } catch (e) {
                console.warn('⚠️ [CACHE] Error cargando visitas desde cache:', e);
            }
        }

        // 🆕 v1.81: Si ya renderizamos cache O es actualización de background, NO mostrar spinner
        const esCargaInicial = !cacheRenderizado && visitasAsignadas.length === 0;
        const mostrarUI = !esActualizacionBackground && !cacheRenderizado;

        // 🔧 v1.81: CARGA INICIAL con barra de progreso (solo si no hay cache)
        if (esCargaInicial && mostrarUI) {
            visitasContainer.innerHTML = ''; // Limpiar contenedor
            mostrarBarraProgresoInline();
            actualizarBarraProgresoInline('Conectando con el servidor...', 0, 'Iniciando...');
        }

        // 🆕 v1.81: PASO 2 - Verificar si hay cambios en el servidor (SIEMPRE, incluso con cache)
        if (navigator.onLine) {
            console.log('🔍 [VALIDACIÓN] Verificando si hay cambios en el servidor...');

            try {
                const checkResponse = await fetch(APP_CONFIG.getApiUrl('/api/mis-visitas/check-updates'), {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-cache'
                });

                if (checkResponse.ok) {
                    const checkResult = await checkResponse.json();

                    if (checkResult.success) {
                        const hashAnterior = localStorage.getItem('visitas_hash');
                        const hashActual = checkResult.hash;

                        console.log(`🔍 [VALIDACIÓN] Hash anterior: ${hashAnterior?.substring(0, 8) || 'ninguno'}, Hash actual: ${hashActual.substring(0, 8)}`);

                        // Si los hashes coinciden, NO hay cambios
                        if (hashAnterior === hashActual) {
                            console.log('✅ [VALIDACIÓN] No hay cambios. Manteniendo visitas actuales.');

                            // 🆕 v1.81: Si ya hay visitas renderizadas, simplemente retornar
                            if (visitasAsignadas.length > 0) {
                                console.log('✅ [VALIDACIÓN] Visitas ya en pantalla, sin actualizaciones necesarias');
                                return; // ⚠️ SALIR - No hacer nada
                            }

                            // Si no hay visitas renderizadas pero hay cache, renderizar
                            renderizarVisitas(visitasAsignadas);

                            // Actualizar contadores
                            const pendientes = visitasAsignadas.filter(v => v.estado !== 'completada' && v.estado !== 'cancelada').length;
                            totalVisitas.textContent = visitasAsignadas.length;
                            visitasPendientes.textContent = pendientes;

                            return; // ⚠️ SALIR - No descargar nada
                        }

                        console.log('🔄 [VALIDACIÓN] Cambios detectados. Descargando visitas actualizadas...');
                        if (esActualizacionBackground) {
                            console.log('🔄 [BACKGROUND] Actualización silenciosa en curso...');
                        }
                    }
                }
            } catch (checkError) {
                console.warn('⚠️ [VALIDACIÓN] Error verificando cambios:', checkError.message);
                // 🆕 v1.81: Si es actualización de background y hay error, retornar sin molestar al usuario
                if (esActualizacionBackground && visitasAsignadas.length > 0) {
                    console.log('⏭️ [BACKGROUND] Error en validación, manteniendo visitas actuales');
                    return;
                }
            }
        }

        // 🆕 v1.81: Descargar visitas del servidor (con o sin UI)
        if (esCargaInicial && mostrarUI) {
            actualizarBarraProgresoInline('Descargando lista de visitas...', 5, 'Consultando servidor...');
        } else if (esActualizacionBackground) {
            console.log('🔄 [BACKGROUND] Descargando visitas actualizadas silenciosamente...');
        }

        const response = await fetch(APP_CONFIG.getApiUrl('/api/mis-visitas'), {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-cache'
        });

        const resultado = await response.json();

        if (!response.ok || !resultado.success) {
            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('token_tecnico');
                localStorage.removeItem('user_tecnico');
                localStorage.removeItem('remember_tecnico');
                APP_CONFIG.redirectTo('login_tecnicos.html');
                return;
            }
            throw new Error(resultado.message || 'Error cargando visitas');
        }

        // Actualizar información del técnico
        if (resultado.tecnico) {
            tecnicoActual = resultado.tecnico;
            nombreTecnico.textContent = resultado.tecnico.nombre;
        }

        // 🔧 v1.72: Filtrar visitas completadas del servidor Y de IndexedDB
        // 1. Obtener IDs de visitas completadas localmente (números)
        const visitasCompletadasIds = await window.offlineManager.obtenerVisitasCompletadas();

        // 2. Convertir a Set para búsqueda O(1) y normalizar tipos
        const visitasCompletadasSet = new Set(visitasCompletadasIds);

        // 3. Filtrar tanto por estado del servidor como por historial local
        const visitasSinCompletar = resultado.visitas.filter(v => {
            // Excluir si el servidor la marcó como completada
            if (v.estado === 'completada') return false;

            // Normalizar v.id a número para comparación consistente
            const visitaIdNum = typeof v.id === 'string' ? parseInt(v.id, 10) : v.id;

            // Excluir si está en el historial local de completadas
            if (visitasCompletadasSet.has(visitaIdNum)) return false;

            return true;
        });

        const visitasCompletadasServidor = resultado.visitas.filter(v => v.estado === 'completada').length;
        const totalExcluidas = resultado.visitas.length - visitasSinCompletar.length;

        console.log(`🔍 [FILTRADO] Filtrando visitas: ${visitasSinCompletar.length} activas de ${resultado.visitas.length} totales`);
        console.log(`🔍 [FILTRADO] Excluidas ${totalExcluidas} completadas: ${visitasCompletadasIds.length} locales + ${visitasCompletadasServidor} del servidor`);

        if (totalExcluidas > 0) {
            const excluidas = resultado.visitas
                .filter(v => !visitasSinCompletar.includes(v))
                .map(v => `#${v.id} (${v.estado})`);
            console.log(`🔒 [FILTRADO] Visitas excluidas: ${excluidas.join(', ')}`);
        }

        // Guardar SOLO visitas NO completadas en IndexedDB
        if (visitasSinCompletar.length > 0 && window.offlineManager) {
            let tecnicoId = resultado.tecnico?.id || tecnicoActual?.id;
            if (!tecnicoId) {
                const userStorage = localStorage.getItem('user_tecnico');
                if (userStorage) {
                    try {
                        const user = JSON.parse(userStorage);
                        tecnicoId = user.id;
                    } catch (e) {}
                }
            }
            tecnicoId = tecnicoId || 'unknown';
            await window.offlineManager.saveVisitasOffline(visitasSinCompletar, tecnicoId);
            console.log(`💾 [CACHE] ${visitasSinCompletar.length} visitas NO completadas guardadas en IndexedDB`);
        }

        // Usar visitas ya filtradas
        const visitasNuevas = visitasSinCompletar;

        // DETECTAR VISITAS NUEVAS (comparar IDs)
        const idsActuales = new Set(visitasAsignadas.map(v => v.id));
        const visitasRealmenteNuevas = visitasNuevas.filter(v => !idsActuales.has(v.id));

        console.log(`🔍 Visitas actuales: ${visitasAsignadas.length}, Visitas totales: ${visitasNuevas.length}, Nuevas detectadas: ${visitasRealmenteNuevas.length}`);

        // DESCARGAR PDFs SOLO DE VISITAS NUEVAS (si hay y si hay conexión)
        if (visitasRealmenteNuevas.length > 0 && navigator.onLine) {
            console.log(`📥 Descargando PDFs de ${visitasRealmenteNuevas.length} visitas nuevas...`);

            // 🆕 v1.81: Mostrar barra de progreso solo si se debe mostrar UI
            if (mostrarUI) {
                mostrarBarraProgresoInline();
                actualizarBarraProgresoInline('Verificando archivos nuevos...', 5, 'Iniciando...');
            } else if (esActualizacionBackground) {
                console.log('🔄 [BACKGROUND] Descargando PDFs silenciosamente...');
            }

            // Contar PDFs de visitas nuevas
            let totalPdfs = 0;
            const pdfsParaDescargar = [];

            for (let i = 0; i < visitasRealmenteNuevas.length; i++) {
                const visita = visitasRealmenteNuevas[i];
                if (mostrarUI) {
                    actualizarBarraProgresoInline(
                        `Verificando visita nueva ${i + 1}/${visitasRealmenteNuevas.length}...`,
                        5 + (i / visitasRealmenteNuevas.length) * 20,
                        `Analizando visita ${visita.cliente_nombre}...`
                    );
                }

                try {
                    const respPdfs = await fetch(APP_CONFIG.getApiUrl(`/api/visitas/${visita.id}/archivos-pdf`), {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (respPdfs.ok) {
                        const resultPdfs = await respPdfs.json();
                        if (resultPdfs.success && resultPdfs.archivos && resultPdfs.archivos.length > 0) {
                            for (const archivo of resultPdfs.archivos) {
                                pdfsParaDescargar.push({ visita, archivo });
                                totalPdfs++;
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️ Error verificando PDFs de visita ${visita.id}:`, error.message);
                }
            }

            console.log(`📊 ${totalPdfs} PDFs nuevos encontrados`);

            // Descargar PDFs nuevos
            if (totalPdfs > 0) {
                let descargados = 0;

                for (let i = 0; i < pdfsParaDescargar.length; i++) {
                    const { visita, archivo } = pdfsParaDescargar[i];

                    try {
                        const pdfUrl = APP_CONFIG.getApiUrl(`/uploads/pdfs_visitas/${archivo.nombre_archivo}`);
                        const pdfResponse = await fetch(pdfUrl, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });

                        if (pdfResponse.ok) {
                            const pdfBlob = await pdfResponse.blob();
                            await window.offlineManager.savePdfOffline(visita.id, archivo.nombre_archivo, archivo.nombre_original, pdfBlob);
                            descargados++;
                            visitasConPdfsDescargados.add(visita.id);
                            console.log(`✅ Descargado: ${archivo.nombre_original}`);
                        }

                        // Actualizar progreso (25% - 95%)
                        const progreso = 25 + (descargados / totalPdfs) * 70;
                        if (mostrarUI) {
                            actualizarBarraProgresoInline(
                                `Descargando ${archivo.nombre_original}...`,
                                progreso,
                                `${descargados} / ${totalPdfs} archivos`
                            );
                        }

                    } catch (pdfError) {
                        console.warn(`⚠️ Error descargando ${archivo.nombre_archivo}:`, pdfError.message);
                    }
                }

                console.log(`✅ ${descargados} PDFs nuevos descargados`);

                // Completar progreso
                if (mostrarUI) {
                    actualizarBarraProgresoInline('¡Descarga completada!', 100, `${descargados} archivos descargados`);
                    setTimeout(() => ocultarBarraProgresoInline(), 1500);
                }
            } else {
                // No hay PDFs que descargar
                if (mostrarUI) {
                    ocultarBarraProgresoInline();
                }
            }
        }

        // Actualizar vista de visitas
        const hashNuevo = hashSimple(resultado.visitas);

        if (hashNuevo !== hashVisitasAnterior || visitasAsignadas.length === 0) {
            console.log('✅ Datos actualizados detectados, recargando vista');

            // Cargar filtros
            const filtroLocalidadGuardado = localStorage.getItem('filtro_localidad_tecnico') || '';
            const filtroEstadoGuardado = localStorage.getItem('filtro_estado_tecnico') || '';
            const filtroLocalidadActual = document.getElementById('filtroLocalidad')?.value || filtroLocalidadGuardado;
            const filtroEstadoActual = document.getElementById('filtroEstado')?.value || filtroEstadoGuardado;

            visitasAsignadas = visitasNuevas;
            visitasSinFiltrar = [...visitasNuevas];

            // 🔧 v1.78: Guardar visitas en localStorage para evitar recarga inicial
            try {
                localStorage.setItem('visitas_cache', JSON.stringify(visitasNuevas));
                console.log(`💾 [CACHE] ${visitasNuevas.length} visitas guardadas en localStorage`);
            } catch (e) {
                console.warn('⚠️ [CACHE] Error guardando visitas:', e);
            }

            // 🆕 v1.81: SIEMPRE intentar enviar notificaciones (el manager maneja permisos internamente)
            if (window.notificationsManager) {
                console.log('🔔 [NOTIFICACIONES] Verificando nuevas visitas y observaciones urgentes...');
                console.log(`🔔 [NOTIFICACIONES] Estado: isInitialized=${window.notificationsManager.isInitialized}`);

                await window.notificationsManager.checkNewVisits(visitasNuevas);
                await window.notificationsManager.checkUrgentObservations(visitasNuevas);
            } else {
                console.warn('⚠️ [NOTIFICACIONES] NotificationsManager no disponible');
            }

            llenarFiltroLocalidades();

            // Aplicar filtros
            let filtrosAplicados = false;
            if (filtroLocalidadActual) {
                const selectLocalidad = document.getElementById('filtroLocalidad');
                if (selectLocalidad) {
                    selectLocalidad.value = filtroLocalidadActual;
                    filtrosAplicados = true;
                }
            }
            if (filtroEstadoActual) {
                const selectEstado = document.getElementById('filtroEstado');
                if (selectEstado) {
                    selectEstado.value = filtroEstadoActual;
                    filtrosAplicados = true;
                }
            }

            if (filtrosAplicados) {
                let visitasFiltradas = [...visitasSinFiltrar];
                if (filtroLocalidadActual) {
                    visitasFiltradas = visitasFiltradas.filter(v => v.localidad === filtroLocalidadActual);
                }
                if (filtroEstadoActual) {
                    visitasFiltradas = visitasFiltradas.filter(v => v.estado === filtroEstadoActual);
                }
                visitasAsignadas = visitasFiltradas;
            }

            mostrarVisitasAsignadas();
            setTimeout(restaurarCronometros, 100);
            hashVisitasAnterior = hashNuevo;

            // 🔧 v1.81: Ocultar barra inline después de mostrar visitas (solo si se mostró)
            if (mostrarUI) {
                setTimeout(() => ocultarBarraProgresoInline(), 1500);
            }
        } else {
            console.log('⏭️ Sin cambios en los datos');
        }

        ultimaActualizacion = Date.now();
        actualizarIndicadorActualizacion();

        // 🔧 v1.68: Guardar hash de visitas para futuras validaciones
        if (navigator.onLine) {
            try {
                const checkResponse = await fetch(APP_CONFIG.getApiUrl('/api/mis-visitas/check-updates'), {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-cache'
                });

                if (checkResponse.ok) {
                    const checkResult = await checkResponse.json();
                    if (checkResult.success && checkResult.hash) {
                        localStorage.setItem('visitas_hash', checkResult.hash);
                        console.log(`💾 [VALIDACIÓN] Hash guardado: ${checkResult.hash.substring(0, 8)}...`);
                    }
                }
            } catch (hashError) {
                console.warn('⚠️ [VALIDACIÓN] No se pudo guardar hash:', hashError.message);
            }
        }

    } catch (error) {
        console.error('Error cargando visitas:', error);

        // Si está offline, intentar cargar desde IndexedDB
        if (!navigator.onLine && window.offlineManager) {
            console.log('📴 [OFFLINE] Cargando visitas desde IndexedDB...');
            try {
                // Obtener tecnicoId desde tecnicoActual o localStorage como fallback
                let tecnicoId = tecnicoActual?.id;
                if (!tecnicoId) {
                    const userStorage = localStorage.getItem('user_tecnico');
                    if (userStorage) {
                        try {
                            const user = JSON.parse(userStorage);
                            tecnicoId = user.id;
                        } catch (e) {}
                    }
                }
                tecnicoId = tecnicoId || 'unknown';
                console.log(`📴 [OFFLINE] Buscando visitas para técnico ID: ${tecnicoId}`);

                const visitasOffline = await window.offlineManager.loadVisitasOffline(tecnicoId);

                if (visitasOffline && visitasOffline.length > 0) {
                    console.log(`✅ [OFFLINE] ${visitasOffline.length} visitas cargadas desde cache`);

                    // Filtrar visitas completadas
                    const visitasSinCompletar = visitasOffline.filter(v => v.estado !== 'completada');
                    visitasAsignadas = visitasSinCompletar;
                    visitasSinFiltrar = [...visitasSinCompletar];

                    // Cargar filtros y mostrar
                    llenarFiltroLocalidades();
                    const filtroLocalidadGuardado = localStorage.getItem('filtro_localidad_tecnico') || '';
                    const filtroEstadoGuardado = localStorage.getItem('filtro_estado_tecnico') || '';

                    if (filtroLocalidadGuardado || filtroEstadoGuardado) {
                        const selectLocalidad = document.getElementById('filtroLocalidad');
                        const selectEstado = document.getElementById('filtroEstado');

                        if (selectLocalidad && filtroLocalidadGuardado) {
                            selectLocalidad.value = filtroLocalidadGuardado;
                        }
                        if (selectEstado && filtroEstadoGuardado) {
                            selectEstado.value = filtroEstadoGuardado;
                        }

                        let visitasFiltradas = [...visitasSinFiltrar];
                        if (filtroLocalidadGuardado) {
                            visitasFiltradas = visitasFiltradas.filter(v => v.localidad === filtroLocalidadGuardado);
                        }
                        if (filtroEstadoGuardado) {
                            visitasFiltradas = visitasFiltradas.filter(v => v.estado === filtroEstadoGuardado);
                        }
                        visitasAsignadas = visitasFiltradas;
                    }

                    mostrarVisitasAsignadas();
                    setTimeout(restaurarCronometros, 100);

                    // Mostrar mensaje de modo offline
                    if (visitasContainer) {
                        const offlineMsg = document.createElement('div');
                        offlineMsg.className = 'alert alert-warning mb-3';
                        offlineMsg.innerHTML = '<i class="fas fa-wifi-slash"></i> <strong>Modo offline:</strong> Mostrando visitas guardadas en cache';
                        visitasContainer.insertBefore(offlineMsg, visitasContainer.firstChild);
                    }

                    actualizarIndicadorActualizacion();
                    return; // Salir exitosamente
                } else {
                    console.log('⚠️ [OFFLINE] No hay visitas guardadas en cache');

                    // Mostrar mensaje informativo cuando no hay cache
                    if (visitasContainer) {
                        visitasContainer.innerHTML = `
                            <div class="alert alert-warning text-center" style="margin-top: 50px;">
                                <i class="fas fa-wifi-slash fa-3x mb-3"></i>
                                <h5><strong>Modo Offline - Sin visitas en cache</strong></h5>
                                <p class="mb-2">No hay visitas guardadas para trabajar sin conexión.</p>
                                <hr>
                                <p class="mb-1"><strong>Para usar la app offline:</strong></p>
                                <ol class="text-start" style="display: inline-block;">
                                    <li>Conéctate a internet</li>
                                    <li>Carga tus visitas una vez</li>
                                    <li>Luego podrás trabajar sin conexión</li>
                                </ol>
                                <hr>
                                <p class="text-muted small mb-0">
                                    <i class="fas fa-info-circle"></i> Las visitas se guardarán automáticamente para acceso offline
                                </p>
                            </div>
                        `;
                    }
                    actualizarIndicadorActualizacion();
                    return; // Salir después de mostrar el mensaje
                }
            } catch (offlineError) {
                console.error('❌ [OFFLINE] Error cargando desde IndexedDB:', offlineError);
            }
        }

        // Si no hay visitas cargadas, mostrar error
        if (visitasAsignadas.length === 0) {
            visitasContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle"></i>
                    ${!navigator.onLine ? 'Sin conexión y sin datos guardados. Conéctate a internet para cargar tus visitas.' : 'Error cargando visitas asignadas'}
                </div>
            `;
        }
        actualizarIndicadorActualizacion();
    }
}

// Mostrar visitas asignadas
function mostrarVisitasAsignadas() {
    if (visitasAsignadas.length === 0) {
        visitasContainer.innerHTML = `
            <div class="alert alert-info text-center">
                <i class="fas fa-calendar-times fa-2x mb-2"></i>
                <h6>No hay visitas asignadas</h6>
                <p class="mb-0">No tienes visitas técnicas asignadas en este momento.</p>
            </div>
        `;
        return;
    }

    const html = visitasAsignadas.map(visita => `
        <div class="card visita-card">
            <div class="card-body">
                <div class="row">
                    <div class="col-md-8">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title mb-0">${visita.cliente_nombre}</h6>
                            <span class="badge status-${visita.estado} ms-2">${visita.estado.replace('_', ' ')}</span>
                        </div>

                        <div class="row text-muted">
                            <div class="col-md-6">
                                <p class="mb-1"><i class="fas fa-id-card"></i> ${visita.cliente_cedula}</p>
                                <p class="mb-1"><i class="fas fa-phone"></i> ${visita.cliente_telefono || 'No disponible'}</p>
                                <p class="mb-1"><i class="fas fa-mobile-alt"></i> ${visita.cliente_movil || 'Móvil no disponible'}</p>
                                <p class="mb-1"><i class="fas fa-calendar"></i> ${new Date(visita.fecha_programada).toLocaleDateString('es-ES', {
                                    weekday: 'long',
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}</p>
                                ${(visita.serial_equipo_asignado || (visita.todos_los_equipos && visita.todos_los_equipos.length > 0)) ? `
                                    <div class="mt-2 p-3 border border-warning border-3 rounded bg-warning-subtle shadow-sm">
                                        <p class="mb-2 fw-bold text-warning fs-6">
                                            <i class="fas fa-microchip"></i> EQUIPOS ASIGNADOS:
                                        </p>
                                        ${visita.todos_los_equipos && visita.todos_los_equipos.length > 0 ?
                                            visita.todos_los_equipos.map((equipo, index) => `
                                                <div class="mb-2 p-2 bg-white rounded border-start border-warning border-4 ${index < visita.todos_los_equipos.length - 1 ? 'mb-3' : ''}">
                                                    <div class="row g-1">
                                                        <div class="col-12 col-sm-4">
                                                            <p class="mb-1 small"><strong>Tipo:</strong><br><span class="text-dark">${equipo.tipo}</span></p>
                                                        </div>
                                                        <div class="col-12 col-sm-5">
                                                            <p class="mb-1 small"><strong>Serial:</strong><br><span class="text-primary fw-bold font-monospace">${equipo.serial}</span></p>
                                                        </div>
                                                        <div class="col-12 col-sm-3">
                                                            <p class="mb-1 small"><strong>Estado:</strong><br><span class="badge bg-info fs-6">${equipo.estado}</span></p>
                                                        </div>
                                                    </div>
                                                </div>
                                            `).join('') :
                                            `<div class="mb-0 p-2 bg-white rounded border-start border-warning border-4">
                                                <div class="row g-1">
                                                    <div class="col-12 col-sm-4">
                                                        <p class="mb-1 small"><strong>Tipo:</strong><br><span class="text-dark">${visita.equipo_tipo || 'No especificado'}</span></p>
                                                    </div>
                                                    <div class="col-12 col-sm-5">
                                                        <p class="mb-1 small"><strong>Serial:</strong><br><span class="text-primary fw-bold font-monospace">${visita.serial_equipo_asignado}</span></p>
                                                    </div>
                                                    <div class="col-12 col-sm-3">
                                                        <p class="mb-1 small"><strong>Estado:</strong><br><span class="badge bg-info fs-6">${visita.equipo_estado || 'comodato'}</span></p>
                                                    </div>
                                                </div>
                                            </div>`
                                        }
                                        ${visita.todos_los_equipos && visita.todos_los_equipos.length > 1 ?
                                            `<div class="mt-2 text-center">
                                                <small class="text-muted"><i class="fas fa-info-circle"></i> Total: ${visita.todos_los_equipos.length} equipos asignados</small>
                                            </div>` : ''
                                        }
                                    </div>
                                ` : ''}
                            </div>
                            <div class="col-md-6">
                                <p class="mb-1"><i class="fas fa-home"></i> ${visita.cliente_direccion || 'Dirección no disponible'}</p>
                                ${visita.cliente_coordenadas ?
                                    `<p class="mb-1"><i class="fas fa-map-marker-alt"></i> ${visita.cliente_coordenadas}
                                    <a href="https://www.google.com/maps?q=${visita.cliente_coordenadas}" target="_blank" class="btn btn-sm btn-primary ms-2">
                                        <i class="fas fa-map"></i> Ver en Maps
                                    </a></p>` :
                                    `<p class="mb-1"><i class="fas fa-map-marker-alt"></i> <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(visita.cliente_direccion || visita.cliente_nombre)}" target="_blank" class="btn btn-sm btn-outline-primary">
                                        <i class="fas fa-search-location"></i> Buscar dirección en Maps
                                    </a></p>`
                                }
                                ${visita.localidad ? `<p class="mb-1"><i class="fas fa-map-marker-alt"></i> Localidad: ${visita.localidad}</p>` : ''}
                                ${visita.usuario_ppp ? `<p class="mb-1"><i class="fas fa-user-cog"></i> Usuario PPP/HS: ${visita.usuario_ppp}</p>` : ''}
                                <p class="mb-1"><i class="fas fa-user-tie"></i> Técnico asignado: <strong>${tecnicoActual ? tecnicoActual.nombre : 'No asignado'}</strong></p>
                                <p class="mb-1"><i class="fas fa-server"></i> BD: ${visita.bd_origen}</p>
                                <p class="mb-1"><i class="fas fa-clock"></i> Creada: ${new Date(visita.fecha_creacion).toLocaleDateString()}</p>
                            </div>
                        </div>

                        <div class="mt-2">
                            <h6 class="text-primary">Motivo de la visita:</h6>
                            <p class="mb-2">${visita.motivo_visita}</p>
                        </div>

                        ${visita.notas_admin ? `
                            <div class="mt-2">
                                <h6 class="text-info">Notas del administrador:</h6>
                                <p class="mb-0">${visita.notas_admin}</p>
                            </div>
                        ` : ''}

                        ${visita.observacion_ultima_hora ? `
                            <div class="mt-3 mb-3 p-4 border border-danger border-3 bg-danger-subtle rounded shadow-lg position-relative" style="animation: pulse 2s infinite;">
                                <div class="position-absolute top-0 start-0 w-100 h-100 bg-danger opacity-25 rounded"></div>
                                <div class="position-relative">
                                    <div class="text-center mb-3">
                                        <h5 class="text-danger mb-2 fw-bold">
                                            <i class="fas fa-exclamation-triangle fa-2x text-danger me-2"></i>
                                            <span class="badge bg-danger fs-5 p-2">¡OBSERVACIÓN URGENTE!</span>
                                            <i class="fas fa-exclamation-triangle fa-2x text-danger ms-2"></i>
                                        </h5>
                                        <div class="text-danger fw-bold fs-6">MENSAJE IMPORTANTE DEL ADMINISTRADOR</div>
                                    </div>
                                    <div class="alert alert-danger mb-2 border-danger border-3 shadow" style="background: linear-gradient(135deg, #f8d7da 0%, #f5c2c7 100%);">
                                        <div class="text-center">
                                            <i class="fas fa-bell fa-lg text-danger me-2"></i>
                                            <strong style="font-size: 1.2em; text-transform: uppercase;">${visita.observacion_ultima_hora}</strong>
                                            <i class="fas fa-bell fa-lg text-danger ms-2"></i>
                                        </div>
                                    </div>
                                    <div class="text-center">
                                        <small class="text-danger fw-bold">
                                            <i class="fas fa-clock me-1"></i>
                                            Lee atentamente antes de proceder con la visita
                                        </small>
                                    </div>
                                </div>
                            </div>
                            <style>
                                @keyframes pulse {
                                    0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
                                    70% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
                                    100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
                                }
                            </style>
                        ` : ''}

                        <!-- Sección de archivos PDF -->
                        <div class="mt-2" id="pdfs-visita-${visita.id}">
                            <h6 class="text-warning">
                                <i class="fas fa-file-pdf"></i> Archivos adjuntos
                                <button class="btn btn-sm btn-outline-warning ms-2" onclick="cargarPdfsVisita(${visita.id})">
                                    <i class="fas fa-sync"></i>
                                </button>
                            </h6>
                            <div id="lista-pdfs-${visita.id}">
                                <p class="text-muted small">Clic en actualizar para ver archivos</p>
                            </div>
                        </div>
                    </div>

                    <div class="col-md-4 text-end">
                        <div class="d-flex flex-column gap-2">
                            ${visita.cliente_telefono && visita.cliente_telefono !== 'No disponible' ?
                                `<a href="tel:${visita.cliente_telefono}" class="btn btn-outline-success btn-sm">
                                    <i class="fas fa-phone"></i> Llamar (Fijo)
                                </a>` : ''
                            }

                            ${visita.cliente_movil ?
                                `<a href="tel:${visita.cliente_movil}" class="btn btn-outline-primary btn-sm">
                                    <i class="fas fa-mobile-alt"></i> Llamar (Móvil)
                                </a>` : ''
                            }

                            ${visita.estado === 'asignada' ?
                                `<button class="btn btn-primary btn-sm" onclick="iniciarVisita(${visita.id})">
                                    <i class="fas fa-play"></i> Iniciar Visita
                                </button>
                                <button class="btn btn-warning btn-sm" id="btnNotificar${visita.id}" onclick="notificarClienteLlegada(${visita.id})">
                                    <i class="fas fa-bell"></i> Notificar Mi Llegada
                                </button>` : ''
                            }

                            ${visita.estado === 'en_progreso' ?
                                `<button class="btn btn-success btn-sm" onclick="completarVisita(${visita.id})">
                                    <i class="fas fa-check-circle"></i> Completar
                                </button>
                                <button class="btn btn-warning btn-sm" id="btnNotificar${visita.id}" onclick="notificarClienteLlegada(${visita.id})">
                                    <i class="fas fa-bell"></i> Notificar Mi Llegada
                                </button>` : ''
                            }
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    visitasContainer.innerHTML = html;
}

// Iniciar visita
function iniciarVisita(visitaId) {
    document.getElementById('visitaIniciarId').value = visitaId;
    const modal = new bootstrap.Modal(document.getElementById('modalIniciarVisita'));
    modal.show();
}

// Confirmar inicio de visita
async function confirmarInicioVisita() {
    try {
        const visitaId = document.getElementById('visitaIniciarId').value;

        // Detectar si está offline
        if (!navigator.onLine) {
            console.log('📴 [OFFLINE] Sin conexión, guardando inicio de visita para sincronizar después');

            // Guardar en IndexedDB para sincronizar luego
            const guardado = await window.offlineManager.saveInicioVisitaOffline(visitaId);

            if (guardado) {
                mostrarAlerta('⚠️ Sin conexión: Visita iniciada en modo offline. Se sincronizará cuando vuelva la conexión.', 'warning');

                // Actualizar estado local inmediatamente
                const visitaIndex = visitasAsignadas.findIndex(v => v.id == visitaId);
                if (visitaIndex !== -1) {
                    visitasAsignadas[visitaIndex].estado = 'en_progreso';
                    mostrarVisitasAsignadas();
                }

                bootstrap.Modal.getInstance(document.getElementById('modalIniciarVisita')).hide();
            } else {
                mostrarAlerta('❌ Error guardando inicio de visita offline', 'danger');
            }
            return;
        }

        // Modo online: enviar al servidor
        const response = await fetch(APP_CONFIG.getApiUrl(`/api/visitas-tecnicas/${visitaId}/iniciar`), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Visita iniciada exitosamente', 'success');

            // Actualizar estado local
            const visitaIndex = visitasAsignadas.findIndex(v => v.id == visitaId);
            if (visitaIndex !== -1) {
                visitasAsignadas[visitaIndex].estado = 'en_progreso';
                mostrarVisitasAsignadas();
            }

            bootstrap.Modal.getInstance(document.getElementById('modalIniciarVisita')).hide();
        } else {
            mostrarAlerta(resultado.message || 'Error iniciando la visita', 'danger');
        }

    } catch (error) {
        console.error('Error iniciando visita:', error);

        // Si falla por conexión, intentar guardar offline
        if (!navigator.onLine) {
            const visitaId = document.getElementById('visitaIniciarId').value;
            const guardado = await window.offlineManager.saveInicioVisitaOffline(visitaId);

            if (guardado) {
                mostrarAlerta('⚠️ Sin conexión: Visita iniciada en modo offline. Se sincronizará cuando vuelva la conexión.', 'warning');

                const visitaIndex = visitasAsignadas.findIndex(v => v.id == visitaId);
                if (visitaIndex !== -1) {
                    visitasAsignadas[visitaIndex].estado = 'en_progreso';
                    mostrarVisitasAsignadas();
                }

                bootstrap.Modal.getInstance(document.getElementById('modalIniciarVisita')).hide();
            } else {
                mostrarAlerta('Error iniciando la visita en modo offline', 'danger');
            }
        } else {
            mostrarAlerta('Error iniciando la visita', 'danger');
        }
    }
}

// Completar visita
// Variable global para almacenar coordenadas capturadas
let coordenadasCapturadas = null;

// Variable global para coordenadas de cajas NAP
let coordenadasNapCapturadas = null;

function completarVisita(visitaId) {
    // Pausar actualización automática mientras se completa la visita
    detenerActualizacionAutomatica();

    const visita = visitasAsignadas.find(v => v.id == visitaId);
    if (!visita) return;

    // Resetear coordenadas capturadas
    coordenadasCapturadas = null;

    // Resetear serial capturado
    window.serialEquipoCapturado = null;

    // 🔧 v1.63: Resetear contador de intentos GPS
    intentosGpsUsuario = 0;

    // Determinar si se requieren coordenadas GPS según el motivo de visita
    const seccionCoordenadas = document.getElementById('seccionCoordenadas');
    const motivoVisita = visita.motivo_visita ? visita.motivo_visita.toLowerCase() : '';
    const esTraslado = motivoVisita.includes('traslado');
    const esInstalacion = motivoVisita.includes('instalación') || motivoVisita.includes('instalacion');

    // Verificar si el cliente tiene coordenadas
    const clienteTieneCoords = visita.cliente_coordenadas && visita.cliente_coordenadas.trim() !== '' && visita.cliente_coordenadas !== '0,0';

    // Requiere GPS si:
    // 1. Es traslado o instalación (siempre)
    // 2. El cliente NO tiene coordenadas (para cualquier otro motivo)
    const requiereGPS = esTraslado || esInstalacion || !clienteTieneCoords;

    // Determinar si es cambio de equipo (requiere captura de serial obligatoria)
    const esCambioEquipo = motivoVisita.includes('cambio de equipo') || motivoVisita.includes('cambio equipo');

    // Determinar si el cliente tiene equipos asignados
    const clienteTieneEquipos = (visita.todos_los_equipos && visita.todos_los_equipos.length > 0) || visita.serial_equipo_asignado;

    // Requiere serial si:
    // 1. Es instalación
    // 2. Es cambio de equipo
    // 3. El cliente NO tiene equipos asignados (primera asignación)
    const requiereSerial = esInstalacion || esCambioEquipo || !clienteTieneEquipos;

    console.log('🔍 Debug motivo visita:', {
        motivoOriginal: visita.motivo_visita,
        motivoLower: motivoVisita,
        clienteTieneCoords: clienteTieneCoords,
        coordenadasActuales: visita.cliente_coordenadas,
        requiereGPS: requiereGPS,
        esInstalacion: esInstalacion,
        esTraslado: esTraslado,
        esCambioEquipo: esCambioEquipo,
        clienteTieneEquipos: clienteTieneEquipos,
        requiereSerial: requiereSerial
    });

    if (requiereGPS) {
        // Mostrar sección de coordenadas
        seccionCoordenadas.classList.remove('d-none');

        // Mensaje personalizado según el caso
        const mensajeCoords = document.querySelector('#seccionCoordenadas .alert-danger');
        if (!clienteTieneCoords && !esInstalacion && !esTraslado) {
            mensajeCoords.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <strong>OBLIGATORIO:</strong> El cliente no tiene coordenadas registradas. Debes capturar las coordenadas GPS con precisión de 9 metros o menor antes de completar la visita.';
        } else {
            mensajeCoords.innerHTML = '<i class="fas fa-exclamation-triangle"></i> <strong>OBLIGATORIO:</strong> Debes capturar las coordenadas GPS con precisión de 9 metros o menor antes de completar la visita.';
        }

        console.log('✅ Mostrando sección de coordenadas GPS');
        // Resetear estado de coordenadas
        document.getElementById('estadoCoordenadas').classList.add('d-none');
        document.getElementById('btnTomarCoordenadas').disabled = false;
    } else {
        // Ocultar sección de coordenadas solo si tiene coordenadas y no es instalación/traslado
        seccionCoordenadas.classList.add('d-none');
        console.log('❌ Ocultando sección de coordenadas GPS (cliente ya tiene coordenadas)');
    }

    // Llenar información del cliente
    let clienteInfo = `
        <p><strong>Nombre:</strong> ${visita.cliente_nombre}</p>
        <p><strong>Cédula:</strong> ${visita.cliente_cedula}</p>
        <p><strong>Teléfono:</strong> ${visita.cliente_telefono || 'No disponible'}</p>
        <p><strong>Fecha programada:</strong> ${new Date(visita.fecha_programada).toLocaleDateString()}</p>
        <p><strong>Motivo:</strong> ${visita.motivo_visita}</p>
    `;

    // ** NUEVA FUNCIONALIDAD: Agregar sección de serial si es instalación, cambio de equipo o cliente sin equipos **
    if (requiereSerial) {
        let tituloSerial = 'visita';
        let mensajeSerial = 'Debes capturar el serial del modem/equipo.';

        if (esInstalacion) {
            tituloSerial = 'instalación';
            mensajeSerial = 'Debes capturar el serial del modem/equipo para esta instalación.';
        } else if (esCambioEquipo) {
            tituloSerial = 'cambio de equipo';
            mensajeSerial = 'Debes capturar el serial del nuevo modem/equipo.';
        } else if (!clienteTieneEquipos) {
            tituloSerial = 'primera asignación';
            mensajeSerial = 'El cliente no tiene equipos asignados. Debes capturar el serial del equipo que se le asignará.';
        }

        clienteInfo += `
            <hr>
            <div class="alert alert-primary">
                <h6><i class="fas fa-barcode"></i> Serial del Equipo (OBLIGATORIO)</h6>
                <p class="mb-2">${mensajeSerial}</p>
                <button type="button" class="btn btn-primary btn-sm" onclick="abrirModalSerialEquipo(${visitaId}, '${visita.motivo_visita}')">
                    <i class="fas fa-barcode"></i> Capturar Serial del Equipo
                </button>
                <div id="serialCapturadoInfo" class="mt-2"></div>
            </div>
        `;
    } else {
        // ** NUEVA FUNCIONALIDAD: Checkbox para cambio de equipo en otras visitas **
        clienteInfo += `
            <hr>
            <div class="card border-primary">
                <div class="card-body">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="checkboxCambioEquipo" onchange="toggleCambioEquipo()">
                        <label class="form-check-label" for="checkboxCambioEquipo">
                            <strong>¿Cambiaste el equipo?</strong>
                        </label>
                    </div>
                    <div id="seccionCambioEquipo" class="d-none mt-3">
                        <div class="alert alert-warning">
                            <p class="mb-2"><i class="fas fa-exclamation-triangle"></i> Indica el serial del nuevo equipo instalado.</p>
                            <button type="button" class="btn btn-warning btn-sm" onclick="abrirModalSerialEquipo(${visitaId}, '${visita.motivo_visita}')">
                                <i class="fas fa-barcode"></i> Capturar Serial del Nuevo Equipo
                            </button>
                            <div id="serialCapturadoInfo" class="mt-2"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Agregar información de equipos si está disponible
    if (visita.serial_equipo_asignado || visita.localidad || visita.usuario_ppp || (visita.todos_los_equipos && visita.todos_los_equipos.length > 0)) {
        clienteInfo += `<hr><h6><i class="fas fa-microchip"></i> Información de Equipos Actuales</h6>`;

        if (visita.localidad) {
            clienteInfo += `<p><strong><i class="fas fa-map-marker-alt"></i> Localidad:</strong> ${visita.localidad}</p>`;
        }

        if (visita.usuario_ppp) {
            clienteInfo += `<p><strong><i class="fas fa-user"></i> Usuario PPP:</strong> ${visita.usuario_ppp}</p>`;
        }

        // Mostrar todos los equipos si están disponibles
        if (visita.todos_los_equipos && visita.todos_los_equipos.length > 0) {
            clienteInfo += `
                <div class="border-start border-warning border-4 ps-3 mb-3 bg-warning-subtle rounded p-3">
                    <p class="mb-3"><strong><i class="fas fa-microchip text-warning"></i> EQUIPOS ASIGNADOS AL CLIENTE:</strong></p>
            `;

            visita.todos_los_equipos.forEach((equipo, index) => {
                clienteInfo += `
                    <div class="mb-3 p-2 bg-white rounded border ${index < visita.todos_los_equipos.length - 1 ? 'mb-3' : ''}">
                        <div class="row g-2">
                            <div class="col-md-4">
                                <p class="mb-1"><strong>Tipo:</strong><br><span class="text-dark">${equipo.tipo}</span></p>
                            </div>
                            <div class="col-md-5">
                                <p class="mb-1"><strong>Serial:</strong><br><span class="text-primary fw-bold font-monospace">${equipo.serial}</span></p>
                            </div>
                            <div class="col-md-3">
                                <p class="mb-1"><strong>Estado:</strong><br><span class="badge bg-info fs-6">${equipo.estado}</span></p>
                            </div>
                        </div>
                    </div>
                `;
            });

            clienteInfo += `
                    <div class="text-center mt-2">
                        <small class="text-muted"><i class="fas fa-info-circle"></i> Total: ${visita.todos_los_equipos.length} equipos registrados</small>
                    </div>
                </div>
            `;
        } else if (visita.serial_equipo_asignado) {
            // Fallback para un solo equipo
            clienteInfo += `
                <div class="border-start border-warning border-4 ps-3 mb-3 bg-warning-subtle rounded p-3">
                    <p class="mb-2"><strong><i class="fas fa-microchip text-warning"></i> EQUIPO ASIGNADO:</strong></p>
                    <div class="p-2 bg-white rounded border">
                        <div class="row g-2">
                            <div class="col-md-4">
                                <p class="mb-1"><strong>Tipo:</strong><br><span class="text-dark">${visita.equipo_tipo || 'No especificado'}</span></p>
                            </div>
                            <div class="col-md-5">
                                <p class="mb-1"><strong>Serial:</strong><br><span class="text-primary fw-bold font-monospace">${visita.serial_equipo_asignado}</span></p>
                            </div>
                            <div class="col-md-3">
                                <p class="mb-1"><strong>Estado:</strong><br><span class="badge bg-info fs-6">${visita.equipo_estado || 'comodato'}</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    document.getElementById('datosCliente').innerHTML = clienteInfo;

    document.getElementById('visitaId').value = visitaId;
    document.getElementById('tecnicoId').value = tecnicoActual ? tecnicoActual.id : '';

    // Limpiar formulario
    document.getElementById('formCompletarVisita').reset();
    document.getElementById('previsualizacionFotos').innerHTML = '';
    fotosSeleccionadas = [];

    // Limpiar inputs de fotos
    document.getElementById('fotosReporte').value = '';
    document.getElementById('fotosCamara').value = '';
    document.getElementById('fotosGaleria').value = '';

    const modal = new bootstrap.Modal(document.getElementById('modalCompletarVisita'));
    modal.show();

    // Reanudar actualización automática cuando se cierre el modal
    document.getElementById('modalCompletarVisita').addEventListener('hidden.bs.modal', function() {
        iniciarActualizacionAutomatica();
    }, { once: true });
}

// Nueva función para agregar fotos desde los inputs de cámara o galería
function agregarFotosSeleccionadas(sourceInput) {
    const fotosReporte = document.getElementById('fotosReporte');
    const dt = new DataTransfer();

    // Agregar fotos existentes primero
    for (let i = 0; i < fotosReporte.files.length; i++) {
        dt.items.add(fotosReporte.files[i]);
    }

    // Agregar las nuevas fotos seleccionadas
    for (let i = 0; i < sourceInput.files.length; i++) {
        const file = sourceInput.files[i];

        // Validar tipo de imagen y tamaño
        if (file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) { // 5MB máx
            // Verificar que no excedamos el límite de 10 fotos
            if (dt.files.length < 10) {
                dt.items.add(file);
            } else {
                mostrarAlerta('⚠️ Máximo 10 fotos permitidas', 'warning');
                break;
            }
        } else {
            if (!file.type.startsWith('image/')) {
                mostrarAlerta('⚠️ Solo se permiten archivos de imagen', 'warning');
            } else {
                mostrarAlerta('⚠️ La imagen excede el tamaño máximo de 5MB', 'warning');
            }
        }
    }

    // Actualizar el input principal con todas las fotos acumuladas
    fotosReporte.files = dt.files;

    // Limpiar el input de origen para permitir seleccionar las mismas fotos nuevamente si es necesario
    sourceInput.value = '';

    // Actualizar la previsualización
    previsualizarFotos();
}

// Manejar archivos seleccionados (para drag and drop)
function handleFiles(files) {
    const fileInput = document.getElementById('fotosReporte');
    const dt = new DataTransfer();

    // Agregar archivos existentes
    for (let i = 0; i < fileInput.files.length; i++) {
        dt.items.add(fileInput.files[i]);
    }

    // Agregar nuevos archivos
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) { // 5MB máx
            // Verificar límite de 10 fotos
            if (dt.files.length < 10) {
                dt.items.add(file);
            } else {
                mostrarAlerta('⚠️ Máximo 10 fotos permitidas', 'warning');
                break;
            }
        }
    }

    fileInput.files = dt.files;
    previsualizarFotos();
}

// Previsualizar fotos seleccionadas
function previsualizarFotos() {
    const files = document.getElementById('fotosReporte').files;
    const preview = document.getElementById('previsualizacionFotos');

    if (files.length === 0) {
        preview.innerHTML = '';
        fotosSeleccionadas = [];
        return;
    }

    // Actualizar array de fotos seleccionadas
    fotosSeleccionadas = Array.from(files);

    // Crear un array para almacenar las promesas de lectura
    const readPromises = [];

    // Crear el HTML del encabezado
    let htmlHeader = `
        <div class="mt-2">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h6 class="mb-0">
                    <i class="fas fa-images text-success"></i>
                    Fotos seleccionadas:
                    <span class="badge bg-success">${files.length} / 10</span>
                </h6>
                <button type="button" class="btn btn-sm btn-outline-danger" onclick="eliminarTodasFotos()">
                    <i class="fas fa-trash"></i> Eliminar todas
                </button>
            </div>
            <div class="d-flex flex-wrap" id="fotosPreviews">
    `;

    preview.innerHTML = htmlHeader + '</div></div>';

    // Leer cada archivo y agregarlo al preview
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const promise = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const photoHtml = `
                    <div class="position-relative m-1" data-index="${i}">
                        <img src="${e.target.result}" class="photo-preview" alt="Foto ${i + 1}"
                             title="${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)">
                        <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0"
                                onclick="eliminarFoto(${i})" style="transform: translate(50%, -50%);"
                                title="Eliminar foto">
                            <i class="fas fa-times"></i>
                        </button>
                        <div class="position-absolute bottom-0 start-0 bg-dark bg-opacity-75 text-white px-1"
                             style="font-size: 0.75rem;">
                            ${i + 1}
                        </div>
                    </div>
                `;
                resolve({ index: i, html: photoHtml });
            };
            reader.readAsDataURL(file);
        });

        readPromises.push(promise);
    }

    // Cuando todas las fotos se hayan leído, agregarlas al DOM en orden
    Promise.all(readPromises).then((results) => {
        const fotosPreviews = document.getElementById('fotosPreviews');
        if (fotosPreviews) {
            // Ordenar por índice para mantener el orden correcto
            results.sort((a, b) => a.index - b.index);
            results.forEach(result => {
                fotosPreviews.insertAdjacentHTML('beforeend', result.html);
            });
        }
    });
}

// Eliminar foto de la selección
function eliminarFoto(index) {
    const fileInput = document.getElementById('fotosReporte');
    const dt = new DataTransfer();

    for (let i = 0; i < fileInput.files.length; i++) {
        if (i !== index) {
            dt.items.add(fileInput.files[i]);
        }
    }

    fileInput.files = dt.files;
    previsualizarFotos();
}

// Eliminar todas las fotos
function eliminarTodasFotos() {
    if (confirm('¿Estás seguro de que deseas eliminar todas las fotos seleccionadas?')) {
        document.getElementById('fotosReporte').value = '';
        document.getElementById('previsualizacionFotos').innerHTML = '';
        fotosSeleccionadas = [];
    }
}

// Guardar reporte de visita completada
async function guardarReporteVisita() {
    try {
        const visitaId = document.getElementById('visitaId').value;
        const visita = visitasAsignadas.find(v => v.id == visitaId);

        // 🔧 FIX: Obtener tecnico_id de manera robusta (no depender solo del campo hidden)
        let tecnicoId = tecnicoActual?.id;
        if (!tecnicoId) {
            const userStorage = localStorage.getItem('user_tecnico');
            if (userStorage) {
                try {
                    const user = JSON.parse(userStorage);
                    tecnicoId = user.id;
                } catch (e) {
                    console.error('❌ Error parseando user_tecnico desde localStorage:', e);
                }
            }
        }

        console.log(`🔍 [DEBUG] tecnico_id obtenido: ${tecnicoId} (tecnicoActual: ${tecnicoActual?.id}, localStorage: ${localStorage.getItem('user_tecnico') ? 'existe' : 'no existe'})`);

        const formData = {
            visita_id: visitaId,
            tecnico_id: tecnicoId || 'unknown',
            problemas_encontrados: document.getElementById('problemasEncontrados').value,
            solucion_aplicada: document.getElementById('solucionAplicada').value,
            materiales_utilizados: document.getElementById('materialesUtilizados').value,
            cliente_satisfecho: document.getElementById('clienteSatisfecho').value,
            requiere_seguimiento: document.getElementById('requiereSeguimiento').checked,
            notas: document.getElementById('notasAdicionales').value
        };

        // Validaciones
        if (!formData.problemas_encontrados || !formData.solucion_aplicada || !formData.cliente_satisfecho) {
            mostrarAlerta('Por favor completa todos los campos obligatorios', 'warning');
            return;
        }

        // ** NUEVA VALIDACIÓN: Serial obligatorio para instalaciones, cambio de equipo y clientes sin equipos **
        const motivoVisita = visita.motivo_visita ? visita.motivo_visita.toLowerCase() : '';
        const esInstalacion = motivoVisita.includes('instalación') || motivoVisita.includes('instalacion');
        const esCambioEquipo = motivoVisita.includes('cambio de equipo') || motivoVisita.includes('cambio equipo');

        // Determinar si el cliente tiene equipos asignados
        const clienteTieneEquipos = (visita.todos_los_equipos && visita.todos_los_equipos.length > 0) || visita.serial_equipo_asignado;

        // Requiere serial si es instalación, cambio de equipo o cliente sin equipos
        const requiereSerial = esInstalacion || esCambioEquipo || !clienteTieneEquipos;

        if (requiereSerial && !window.serialEquipoCapturado) {
            let mensajeError = '❌ ERROR: Debes capturar el serial del equipo antes de completar la visita. Presiona el botón "Capturar Serial del Equipo".';

            if (!clienteTieneEquipos) {
                mensajeError = '❌ ERROR: El cliente no tiene equipos asignados. Debes capturar el serial del equipo que se le asignará antes de completar la visita.';
            }

            mostrarAlerta(mensajeError, 'danger');
            return;
        }

        // Validación para cambio de equipo
        const checkboxCambioEquipo = document.getElementById('checkboxCambioEquipo');
        if (checkboxCambioEquipo && checkboxCambioEquipo.checked && !window.serialEquipoCapturado) {
            mostrarAlerta('❌ ERROR: Marcaste que cambiaste el equipo, pero no capturaste el serial del nuevo equipo.', 'danger');
            return;
        }

        // VALIDACIÓN OBLIGATORIA DE FOTOS
        if (fotosSeleccionadas.length === 0) {
            mostrarAlerta('❌ ERROR: Debes adjuntar al menos 1 foto del trabajo realizado. Presiona el botón de cámara para tomar una foto.', 'danger');
            // Hacer scroll a la sección de fotos
            document.querySelector('.file-upload-area').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // VALIDACIÓN DE COORDENADAS GPS
        const esTraslado = motivoVisita.includes('traslado');
        const esInstalacionGPS = motivoVisita.includes('instalación') || motivoVisita.includes('instalacion');

        // Verificar si el cliente tiene coordenadas
        const clienteTieneCoords = visita.cliente_coordenadas && visita.cliente_coordenadas.trim() !== '' && visita.cliente_coordenadas !== '0,0';

        // Requiere GPS si:
        // 1. Es traslado o instalación (siempre)
        // 2. El cliente NO tiene coordenadas (para cualquier otro motivo)
        const requiereGPS = esTraslado || esInstalacionGPS || !clienteTieneCoords;

        console.log('🔍 [GUARDAR REPORTE] Validación GPS:', {
            motivoVisita: visita.motivo_visita,
            clienteTieneCoords: clienteTieneCoords,
            coordenadasActuales: visita.cliente_coordenadas,
            requiereGPS: requiereGPS,
            coordenadasCapturadas: coordenadasCapturadas
        });

        if (requiereGPS) {
            if (!coordenadasCapturadas) {
                const mensajeError = !clienteTieneCoords && !esInstalacionGPS && !esTraslado
                    ? '❌ ERROR: El cliente no tiene coordenadas registradas. Debes capturar las coordenadas GPS antes de completar la visita. Presiona el botón "Tomar Coordenadas GPS".'
                    : '❌ ERROR: Debes capturar las coordenadas GPS antes de completar la visita. Presiona el botón "Tomar Coordenadas GPS".';
                mostrarAlerta(mensajeError, 'danger');
                // Hacer scroll a la sección de coordenadas
                document.getElementById('seccionCoordenadas').scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // 🔧 v1.65: VALIDACIÓN GPS REFORZADA (online y offline)
            console.log(`🔍 [GPS VALIDACIÓN] Precisión: ${coordenadasCapturadas.accuracy.toFixed(2)}m, Intentos: ${intentosGpsUsuario}/${MAX_INTENTOS_GPS_USUARIO}, Online: ${navigator.onLine}`);

            if (coordenadasCapturadas.accuracy > 9) {
                // Si aún no alcanzó los 3 intentos, BLOQUEAR completar
                if (intentosGpsUsuario < MAX_INTENTOS_GPS_USUARIO) {
                    const intentosRestantes = MAX_INTENTOS_GPS_USUARIO - intentosGpsUsuario;
                    console.error(`❌ [GPS BLOQUEADO] Precisión ${coordenadasCapturadas.accuracy.toFixed(2)}m > 9m con solo ${intentosGpsUsuario} intentos (faltan ${intentosRestantes})`);
                    mostrarAlerta(`❌ ERROR DE COORDENADAS: La precisión actual es de ${coordenadasCapturadas.accuracy.toFixed(2)} metros. Se requiere 9 metros o menos.<br><strong>⏳ Te quedan ${intentosRestantes} ${intentosRestantes === 1 ? 'intento' : 'intentos'}.</strong> Intenta capturar las coordenadas nuevamente en un lugar con mejor señal GPS.`, 'danger');
                    return; // 🔧 BLOQUEAR completar
                } else {
                    // Después de 3 intentos, permitir completar con advertencia
                    console.warn(`⚠️ [GPS EXCEPCIÓN] Permitiendo completar después de ${intentosGpsUsuario} intentos con precisión ${coordenadasCapturadas.accuracy.toFixed(2)}m`);
                    formData.excepcion_gps = true; // Marcar como excepción
                    formData.observacion_gps = `Coordenadas capturadas con precisión de ${coordenadasCapturadas.accuracy.toFixed(2)}m después de ${intentosGpsUsuario} intentos (máximo permitido)`;
                    mostrarAlerta(`⚠️ EXCEPCIÓN GPS: Se completará la visita con precisión de ${coordenadasCapturadas.accuracy.toFixed(2)} metros (máximo de intentos alcanzado).`, 'warning');
                }
            } else {
                console.log(`✅ [GPS OK] Precisión ${coordenadasCapturadas.accuracy.toFixed(2)}m <= 9m, permitiendo completar`);
            }

            // Agregar coordenadas al reporte
            formData.latitud = coordenadasCapturadas.latitude;
            formData.longitud = coordenadasCapturadas.longitude;
            formData.precision_gps = coordenadasCapturadas.accuracy;
            console.log('✅ Coordenadas validadas y agregadas al reporte:', coordenadasCapturadas);
        }

        // Detectar si está offline
        if (!navigator.onLine) {
            console.log('📴 [OFFLINE] Sin conexión, guardando reporte offline');

            // Agregar información de serial si se capturó (para asignar cuando sincronice)
            if (window.serialEquipoCapturado) {
                formData.serialEquipo = window.serialEquipoCapturado;
                formData.tipoEquipo = window.tipoEquipoCapturado || 'Onu CData';
                formData.costoEquipo = 180000;
                console.log(`📦 [OFFLINE] Serial guardado en reporte offline: ${formData.serialEquipo}`);
            }

            // Guardar reporte en IndexedDB
            const reporteLocalId = await window.offlineManager.saveReporteOffline(formData);

            if (reporteLocalId) {
                // Guardar fotos en IndexedDB
                if (fotosSeleccionadas.length > 0) {
                    await window.offlineManager.saveFotosOffline(reporteLocalId, fotosSeleccionadas);
                }

                mostrarAlerta('⚠️ Sin conexión: Reporte guardado en modo offline. Se sincronizará cuando vuelva la conexión.', 'warning');

                // Limpiar serial capturado
                window.serialEquipoCapturado = null;
                window.tipoEquipoCapturado = null;

                // Remover la visita de la lista local
                visitasAsignadas = visitasAsignadas.filter(v => v.id != formData.visita_id);
                visitasSinFiltrar = visitasSinFiltrar.filter(v => v.id != formData.visita_id);
                mostrarVisitasAsignadas();
                console.log(`🗑️ [OFFLINE] Visita ${formData.visita_id} eliminada de la lista local`);

                // 🔧 v1.71: CRÍTICO - Marcar visita como completada permanentemente ANTES de eliminar del cache
                await window.offlineManager.marcarVisitaCompletada(formData.visita_id, tecnicoId);

                // CRÍTICO: Eliminar la visita del cache de IndexedDB
                await window.offlineManager.deleteVisitaOffline(formData.visita_id);

                // 🔧 FIX v1.48: Eliminar PDFs al completar visita
                try {
                    await window.offlineManager.deletePdfsForVisita(formData.visita_id);
                    console.log(`🗑️ [PDFS] PDFs eliminados para visita ${formData.visita_id}`);
                } catch (error) {
                    console.warn('⚠️ [PDFS] Error eliminando PDFs:', error);
                }

                // Cerrar modal
                bootstrap.Modal.getInstance(document.getElementById('modalCompletarVisita')).hide();
            } else {
                mostrarAlerta('❌ Error guardando reporte offline', 'danger');
            }
            return;
        }

        // Modo online: enviar al servidor
        const response = await fetch(APP_CONFIG.getApiUrl('/api/reportes-visitas'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const resultado = await response.json();

        if (resultado.success) {
            // Si hay fotos, subirlas
            if (fotosSeleccionadas.length > 0) {
                await subirFotosReporte(resultado.reporteId);
            }

            mostrarAlerta('Reporte de visita guardado exitosamente', 'success');

            // ** NUEVA FUNCIONALIDAD: Asignar equipo si se capturó serial **
            if (window.serialEquipoCapturado) {
                console.log(`📦 [GUARDAR REPORTE] Asignando equipo con serial: ${window.serialEquipoCapturado}, tipo: ${window.tipoEquipoCapturado || 'Onu CData'}`);

                const resultadoAsignacion = await asignarEquipoAlCompletar(
                    visitaId,
                    window.serialEquipoCapturado,
                    180000,
                    window.tipoEquipoCapturado || 'Onu CData'
                );

                if (resultadoAsignacion.success) {
                    console.log(`✅ [GUARDAR REPORTE] Equipo asignado exitosamente: ${resultadoAsignacion.message}`);
                } else {
                    console.error(`⚠️ [GUARDAR REPORTE] Error asignando equipo: ${resultadoAsignacion.message}`);
                    // No fallar la visita si hay error asignando equipo, solo avisar
                    mostrarAlerta(`⚠️ Visita completada, pero hubo un error asignando el equipo: ${resultadoAsignacion.message}`, 'warning');
                }

                // Limpiar serial y tipo capturado
                window.serialEquipoCapturado = null;
                window.tipoEquipoCapturado = null;
            }

            // 🔧 v1.71: Marcar visita como completada permanentemente (online mode)
            await window.offlineManager.marcarVisitaCompletada(formData.visita_id, tecnicoId);

            // Remover la visita de la lista local
            visitasAsignadas = visitasAsignadas.filter(v => v.id != formData.visita_id);
            mostrarVisitasAsignadas();

            // 🔧 FIX v1.48: Eliminar PDFs al completar visita para liberar espacio
            try {
                await window.offlineManager.deletePdfsForVisita(formData.visita_id);
                console.log(`🗑️ [PDFS] PDFs eliminados para visita ${formData.visita_id}`);
            } catch (error) {
                console.warn('⚠️ [PDFS] Error eliminando PDFs:', error);
            }

            // Cerrar modal
            bootstrap.Modal.getInstance(document.getElementById('modalCompletarVisita')).hide();

        } else {
            mostrarAlerta(resultado.message || 'Error guardando el reporte', 'danger');
        }

    } catch (error) {
        console.error('Error guardando reporte:', error);

        // Si falla por conexión, intentar guardar offline
        if (!navigator.onLine) {
            console.log('📴 [OFFLINE] Error de conexión, guardando reporte offline');

            const formData = {
                visita_id: document.getElementById('visitaId').value,
                tecnico_id: document.getElementById('tecnicoId').value,
                problemas_encontrados: document.getElementById('problemasEncontrados').value,
                solucion_aplicada: document.getElementById('solucionAplicada').value,
                materiales_utilizados: document.getElementById('materialesUtilizados').value,
                cliente_satisfecho: document.getElementById('clienteSatisfecho').value,
                requiere_seguimiento: document.getElementById('requiereSeguimiento').checked,
                notas: document.getElementById('notasAdicionales').value
            };

            // Agregar coordenadas si están disponibles
            if (coordenadasCapturadas) {
                formData.latitud = coordenadasCapturadas.latitude;
                formData.longitud = coordenadasCapturadas.longitude;
                formData.precision_gps = coordenadasCapturadas.accuracy;
            }

            // Agregar información de serial si se capturó
            if (window.serialEquipoCapturado) {
                formData.serialEquipo = window.serialEquipoCapturado;
                formData.tipoEquipo = window.tipoEquipoCapturado || 'Onu CData';
                formData.costoEquipo = 180000;
                console.log(`📦 [OFFLINE] Serial guardado en reporte offline (catch): ${formData.serialEquipo}`);
            }

            const reporteLocalId = await window.offlineManager.saveReporteOffline(formData);

            if (reporteLocalId) {
                // Guardar fotos en IndexedDB
                if (fotosSeleccionadas.length > 0) {
                    await window.offlineManager.saveFotosOffline(reporteLocalId, fotosSeleccionadas);
                }

                mostrarAlerta('⚠️ Sin conexión: Reporte guardado en modo offline. Se sincronizará cuando vuelva la conexión.', 'warning');

                // Limpiar serial capturado
                window.serialEquipoCapturado = null;
                window.tipoEquipoCapturado = null;

                // Remover la visita de la lista local
                visitasAsignadas = visitasAsignadas.filter(v => v.id != formData.visita_id);
                visitasSinFiltrar = visitasSinFiltrar.filter(v => v.id != formData.visita_id);
                mostrarVisitasAsignadas();
                console.log(`🗑️ [OFFLINE] Visita ${formData.visita_id} eliminada de la lista local`);

                // 🔧 v1.71: CRÍTICO - Marcar visita como completada permanentemente ANTES de eliminar del cache
                await window.offlineManager.marcarVisitaCompletada(formData.visita_id, tecnicoId);

                // CRÍTICO: Eliminar la visita del cache de IndexedDB
                await window.offlineManager.deleteVisitaOffline(formData.visita_id);

                // 🔧 FIX v1.48: Eliminar PDFs al completar visita
                try {
                    await window.offlineManager.deletePdfsForVisita(formData.visita_id);
                    console.log(`🗑️ [PDFS] PDFs eliminados para visita ${formData.visita_id}`);
                } catch (error) {
                    console.warn('⚠️ [PDFS] Error eliminando PDFs:', error);
                }

                // Cerrar modal
                bootstrap.Modal.getInstance(document.getElementById('modalCompletarVisita')).hide();
            } else {
                mostrarAlerta('Error guardando el reporte en modo offline', 'danger');
            }
        } else {
            mostrarAlerta('Error guardando el reporte de visita', 'danger');
        }
    }
}

// Subir fotos del reporte
async function subirFotosReporte(reporteId) {
    try {
        if (fotosSeleccionadas.length === 0) {
            return { success: true, message: 'No hay fotos para subir' };
        }

        // Mostrar indicador de carga de fotos
        mostrarAlerta(`Subiendo ${fotosSeleccionadas.length} fotos...`, 'info');

        const formData = new FormData();
        formData.append('reporteId', reporteId);

        for (let i = 0; i < fotosSeleccionadas.length; i++) {
            formData.append('fotos', fotosSeleccionadas[i]);
        }

        const response = await fetch(APP_CONFIG.getApiUrl('/api/reportes-fotos'), {
            method: 'POST',
            body: formData
        });

        const resultado = await response.json();

        if (resultado.success) {
            console.log(`📸 ${fotosSeleccionadas.length} fotos subidas exitosamente`);
            mostrarAlerta(`${fotosSeleccionadas.length} fotos subidas exitosamente`, 'success');
            return resultado;
        } else {
            console.error('Error subiendo fotos:', resultado.message);
            mostrarAlerta(`Error subiendo fotos: ${resultado.message}`, 'danger');
            return resultado;
        }

    } catch (error) {
        console.error('Error subiendo fotos:', error);
        mostrarAlerta('Error de conexión subiendo fotos', 'danger');
        return { success: false, message: error.message };
    }
}

// Capturar coordenadas manualmente (desde el botón)
async function capturarCoordenadasManual() {
    const btnCapturar = document.getElementById('btnTomarCoordenadas');
    const estadoCoordenadas = document.getElementById('estadoCoordenadas');

    // 🔧 v1.63: Incrementar contador de intentos del usuario
    intentosGpsUsuario++;
    const intentosRestantes = MAX_INTENTOS_GPS_USUARIO - intentosGpsUsuario;

    console.log(`🔄 [GPS] Intento ${intentosGpsUsuario}/${MAX_INTENTOS_GPS_USUARIO} del usuario`);

    btnCapturar.disabled = true;
    btnCapturar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Capturando...';

    try {
        const coordenadas = await capturarCoordenadasGPS();

        if (coordenadas) {
            // Almacenar coordenadas globalmente
            coordenadasCapturadas = coordenadas;

            // Mostrar coordenadas capturadas
            document.getElementById('latitudCapturada').value = coordenadas.latitude.toFixed(8);
            document.getElementById('longitudCapturada').value = coordenadas.longitude.toFixed(8);
            document.getElementById('precisionCapturada').value = coordenadas.accuracy.toFixed(2);

            // Mostrar estado de precisión
            const estadoPrecision = document.getElementById('estadoPrecision');
            if (coordenadas.accuracy <= 9) {
                estadoPrecision.innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle"></i> <strong>¡Excelente!</strong> Precisión de ${coordenadas.accuracy.toFixed(2)} metros. Las coordenadas son válidas para completar la visita.
                    </div>
                `;
            } else {
                // 🔧 v1.63: Mostrar intentos restantes
                let mensajeIntentos = '';
                if (intentosRestantes > 0) {
                    mensajeIntentos = `<br><strong>⏳ Te quedan ${intentosRestantes} ${intentosRestantes === 1 ? 'intento' : 'intentos'} para obtener mejor precisión.</strong>`;
                } else {
                    mensajeIntentos = '<br><strong>✓ Has alcanzado el máximo de intentos. Podrás completar la visita con estas coordenadas.</strong>';
                }

                estadoPrecision.innerHTML = `
                    <div class="alert alert-${intentosRestantes > 0 ? 'danger' : 'warning'}">
                        <i class="fas fa-exclamation-triangle"></i> <strong>Precisión insuficiente:</strong> ${coordenadas.accuracy.toFixed(2)} metros. Se requiere 9 metros o menos.
                        ${mensajeIntentos}
                    </div>
                `;
            }

            estadoCoordenadas.classList.remove('d-none');
            btnCapturar.innerHTML = '<i class="fas fa-redo"></i> Volver a Tomar Coordenadas';
        }
    } catch (error) {
        console.error('Error capturando coordenadas:', error);
        btnCapturar.innerHTML = '<i class="fas fa-crosshairs"></i> Reintentar Captura de Coordenadas';
    } finally {
        btnCapturar.disabled = false;
    }
}

// Capturar coordenadas GPS con validación de precisión
async function capturarCoordenadasGPS() {
    return new Promise((resolve, reject) => {
        // Verificar si el navegador soporta geolocalización
        if (!navigator.geolocation) {
            mostrarAlerta('Tu navegador no soporta geolocalización', 'danger');
            reject(null);
            return;
        }

        // Mostrar alerta de que se está obteniendo ubicación
        mostrarAlerta('📍 Obteniendo ubicación GPS... Por favor espera', 'info');

        const intentarCaptura = (intento = 1, maxIntentos = 5) => {
            console.log(`🗺️ Intento ${intento} de captura GPS...`);

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const accuracy = position.coords.accuracy;
                    const coords = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: accuracy
                    };

                    console.log(`📍 Coordenadas obtenidas - Precisión: ${accuracy.toFixed(2)} metros`);

                    // Si la precisión es buena o alcanzamos el máximo de intentos, retornar
                    if (accuracy <= 9) {
                        mostrarAlerta(`✅ Ubicación GPS capturada con precisión de ${accuracy.toFixed(2)} metros`, 'success');
                        resolve(coords);
                    } else if (intento < maxIntentos) {
                        mostrarAlerta(`⚠️ Precisión insuficiente (${accuracy.toFixed(2)}m). Intento ${intento}/${maxIntentos}. Reintentando...`, 'warning');
                        setTimeout(() => intentarCaptura(intento + 1, maxIntentos), 2000);
                    } else {
                        // En el último intento, retornar las coordenadas aunque no cumplan el requisito
                        mostrarAlerta(`⚠️ Precisión obtenida: ${accuracy.toFixed(2)} metros. No se alcanzó la precisión requerida (≤9m).`, 'warning');
                        resolve(coords);
                    }
                },
                (error) => {
                    console.error('Error obteniendo ubicación:', error);
                    let mensaje = 'Error obteniendo ubicación GPS';

                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            mensaje = 'Permiso de ubicación denegado. Por favor, habilita la ubicación en tu navegador.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            mensaje = 'Ubicación no disponible. Verifica tu conexión GPS.';
                            break;
                        case error.TIMEOUT:
                            mensaje = 'Tiempo de espera agotado obteniendo ubicación.';
                            break;
                    }

                    if (intento < maxIntentos) {
                        mostrarAlerta(`${mensaje} Reintentando... (${intento}/${maxIntentos})`, 'warning');
                        setTimeout(() => intentarCaptura(intento + 1, maxIntentos), 2000);
                    } else {
                        mostrarAlerta(mensaje, 'danger');
                        reject(null);
                    }
                },
                {
                    enableHighAccuracy: true, // Solicitar alta precisión
                    timeout: 10000, // Timeout de 10 segundos
                    maximumAge: 0 // No usar caché
                }
            );
        };

        // Iniciar primer intento
        intentarCaptura();
    });
}

// Función para llenar el filtro de Localidades con las disponibles
function llenarFiltroLocalidades() {
    const filtroSelect = document.getElementById('filtroLocalidad');
    const localidades = [...new Set(visitasSinFiltrar
        .map(visita => visita.localidad)
        .filter(localidad => localidad && localidad.trim() !== '')
    )].sort();

    // Limpiar opciones existentes excepto "Todos"
    filtroSelect.innerHTML = '<option value="">Todas las Localidades</option>';

    // Agregar opciones de Localidades
    localidades.forEach(localidad => {
        const option = document.createElement('option');
        option.value = localidad;
        option.textContent = localidad;
        filtroSelect.appendChild(option);
    });
}

// Aplicar filtros a las visitas
function aplicarFiltros() {
    const localidadSeleccionada = document.getElementById('filtroLocalidad').value;
    const estadoSeleccionado = document.getElementById('filtroEstado').value;

    // GUARDAR filtros en localStorage para persistencia
    localStorage.setItem('filtro_localidad_tecnico', localidadSeleccionada);
    localStorage.setItem('filtro_estado_tecnico', estadoSeleccionado);
    console.log(`💾 Filtros guardados en localStorage - Localidad: "${localidadSeleccionada}", Estado: "${estadoSeleccionado}"`);

    let visitasFiltradas = [...visitasSinFiltrar];

    // Filtrar por Localidad
    if (localidadSeleccionada) {
        visitasFiltradas = visitasFiltradas.filter(visita =>
            visita.localidad === localidadSeleccionada
        );
    }

    // Filtrar por estado
    if (estadoSeleccionado) {
        visitasFiltradas = visitasFiltradas.filter(visita =>
            visita.estado === estadoSeleccionado
        );
    }

    // Actualizar la vista con las visitas filtradas
    visitasAsignadas = visitasFiltradas;
    mostrarVisitasAsignadas();

    // Mostrar mensaje si no hay resultados
    if (visitasFiltradas.length === 0 && visitasSinFiltrar.length > 0) {
        visitasContainer.innerHTML = `
            <div class="alert alert-warning text-center">
                <i class="fas fa-filter"></i>
                <h6>No se encontraron visitas con los filtros aplicados</h6>
                <p class="mb-2">Prueba ajustando los criterios de búsqueda.</p>
                <button class="btn btn-outline-warning btn-sm" onclick="limpiarFiltros()">
                    <i class="fas fa-times"></i> Limpiar filtros
                </button>
            </div>
        `;
    }
}

// Limpiar todos los filtros
function limpiarFiltros() {
    document.getElementById('filtroLocalidad').value = '';
    document.getElementById('filtroEstado').value = '';

    // LIMPIAR filtros de localStorage
    localStorage.removeItem('filtro_localidad_tecnico');
    localStorage.removeItem('filtro_estado_tecnico');
    console.log('🗑️ Filtros eliminados de localStorage');

    // Restaurar todas las visitas
    visitasAsignadas = [...visitasSinFiltrar];
    mostrarVisitasAsignadas();
}

// Función para cargar PDFs de una visita técnica
async function cargarPdfsVisita(visitaId) {
    try {
        const botonActualizar = document.querySelector(`#pdfs-visita-${visitaId} button`);
        const iconoBoton = botonActualizar.querySelector('i');

        // Mostrar spinner de carga
        iconoBoton.className = 'fas fa-spinner fa-spin';
        botonActualizar.disabled = true;

        console.log(`📄 [PDFS] Cargando archivos de visita ${visitaId}...`);

        // 🔧 FIX v1.58: Si está offline, cargar PDFs desde cache directamente
        if (!navigator.onLine) {
            console.log(`📴 [PDFS] Modo offline - Cargando PDFs desde IndexedDB...`);

            // Obtener todos los PDFs guardados para esta visita
            const pdfsOffline = await window.offlineManager.getPdfsForVisita(visitaId);

            if (pdfsOffline && pdfsOffline.length > 0) {
                console.log(`📄 [PDFS] ${pdfsOffline.length} PDFs encontrados en caché offline`);

                const archivosConUrl = pdfsOffline.map(pdf => ({
                    nombre_original: pdf.nombre_original,
                    nombre_archivo: pdf.nombre_archivo,
                    tamaño: pdf.blob.size,
                    url: URL.createObjectURL(pdf.blob),
                    fromCache: true
                }));

                // Generar HTML
                const listaHtml = archivosConUrl.map((archivo, index) => {
                    const pdfId = `pdf-${visitaId}-${index}`;
                    return `
                        <div class="d-flex justify-content-between align-items-center py-1 px-2 bg-light rounded mb-2">
                            <div>
                                <span>💾</span>
                                <i class="fas fa-file-pdf text-danger me-2"></i>
                                <span class="small">${archivo.nombre_original}</span>
                                <small class="text-muted ms-2">(${(archivo.tamaño / 1024).toFixed(1)} KB)</small>
                            </div>
                            <button onclick="abrirPdfEnApp('${archivo.url}', '${archivo.nombre_original}')" class="btn btn-sm btn-outline-primary" id="${pdfId}">
                                <i class="fas fa-eye"></i> Ver
                            </button>
                        </div>
                    `;
                }).join('');

                document.getElementById(`lista-pdfs-${visitaId}`).innerHTML = listaHtml;
            } else {
                console.log(`📄 [PDFS] No hay PDFs en caché para visita ${visitaId}`);
                document.getElementById(`lista-pdfs-${visitaId}`).innerHTML =
                    '<p class="text-warning small"><i class="fas fa-wifi-slash"></i> Sin conexión. Los archivos se mostrarán cuando te conectes a internet.</p>';
            }

            // Restaurar botón
            iconoBoton.className = 'fas fa-sync';
            botonActualizar.disabled = false;
            return; // Salir de la función
        }

        // 🔧 Online: Obtener lista de PDFs del servidor
        const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');
        if (!token) {
            throw new Error('No hay token de autenticación. Por favor inicia sesión nuevamente.');
        }

        const response = await fetch(APP_CONFIG.getApiUrl(`/api/visitas/${visitaId}/archivos-pdf`), {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(`📄 [PDFS] Respuesta HTTP ${response.status} ${response.statusText}`);

        // 🔧 FIX CRÍTICO: Verificar Content-Type antes de parsear JSON
        const contentType = response.headers.get('content-type');
        console.log(`📄 [PDFS] Content-Type: ${contentType}`);

        if (!response.ok) {
            // Leer respuesta como texto para ver el error
            const errorText = await response.text();
            console.error(`❌ [PDFS] Respuesta del servidor:`, errorText.substring(0, 500));
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Verificar que la respuesta sea JSON
        if (!contentType || !contentType.includes('application/json')) {
            const htmlResponse = await response.text();
            console.error(`❌ [PDFS] Servidor devolvió HTML en lugar de JSON:`);
            console.error(htmlResponse.substring(0, 500));
            throw new Error(`Servidor devolvió ${contentType || 'HTML'} en lugar de JSON. Posible error de autenticación o configuración.`);
        }

        const resultado = await response.json();
        console.log(`📄 [PDFS] Resultado:`, resultado);

        if (resultado.success && resultado.archivos.length > 0) {
            console.log(`📄 [PDFS] ${resultado.archivos.length} archivos encontrados`);

            // 🔧 FIX v1.48: Descargar PDFs automáticamente para acceso offline
            const archivosConUrl = [];
            for (const archivo of resultado.archivos) {
                try {
                    // Verificar si ya está en caché
                    const pdfCached = await window.offlineManager.getPdfOffline(visitaId, archivo.nombre_archivo);

                    if (pdfCached) {
                        // Usar PDF desde caché
                        const blobUrl = URL.createObjectURL(pdfCached);
                        archivosConUrl.push({ ...archivo, url: blobUrl, fromCache: true });
                        console.log(`📄 [PDFS] Usando PDF desde caché: ${archivo.nombre_archivo}`);
                    } else if (navigator.onLine) {
                        // Descargar y guardar en caché
                        console.log(`📥 [PDFS] Descargando PDF: ${archivo.nombre_archivo}`);
                        const pdfUrl = APP_CONFIG.getApiUrl(`/uploads/pdfs_visitas/${archivo.nombre_archivo}`);
                        const pdfResponse = await fetch(pdfUrl, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });

                        if (pdfResponse.ok) {
                            const pdfBlob = await pdfResponse.blob();
                            await window.offlineManager.savePdfOffline(visitaId, archivo.nombre_archivo, archivo.nombre_original, pdfBlob);
                            const blobUrl = URL.createObjectURL(pdfBlob);
                            archivosConUrl.push({ ...archivo, url: blobUrl, fromCache: false });
                            console.log(`✅ [PDFS] PDF descargado y guardado: ${archivo.nombre_archivo}`);
                        } else {
                            console.warn(`⚠️ [PDFS] Error descargando PDF: ${archivo.nombre_archivo}`);
                            archivosConUrl.push({ ...archivo, url: null, fromCache: false });
                        }
                    } else {
                        // Offline y no hay caché
                        console.warn(`⚠️ [PDFS] Offline, PDF no disponible: ${archivo.nombre_archivo}`);
                        archivosConUrl.push({ ...archivo, url: null, fromCache: false });
                    }
                } catch (error) {
                    console.error(`❌ [PDFS] Error procesando PDF ${archivo.nombre_archivo}:`, error);
                    archivosConUrl.push({ ...archivo, url: null, fromCache: false });
                }
            }

            // Generar HTML con URLs de blob o mensaje de offline
            const listaHtml = archivosConUrl.map((archivo, index) => {
                const iconoEstado = archivo.fromCache ? '💾' : '📄';
                const pdfId = `pdf-${visitaId}-${index}`;

                const botonHtml = archivo.url
                    ? `<button onclick="abrirPdfEnApp('${archivo.url}', '${archivo.nombre_original}')" class="btn btn-sm btn-outline-primary" id="${pdfId}">
                           <i class="fas fa-eye"></i> Ver
                       </button>`
                    : `<span class="btn btn-sm btn-outline-secondary disabled">
                           <i class="fas fa-wifi-slash"></i> Offline
                       </span>`;

                return `
                    <div class="d-flex justify-content-between align-items-center py-1 px-2 bg-light rounded mb-2">
                        <div>
                            <span>${iconoEstado}</span>
                            <i class="fas fa-file-pdf text-danger me-2"></i>
                            <span class="small">${archivo.nombre_original}</span>
                            <small class="text-muted ms-2">(${(archivo.tamaño / 1024).toFixed(1)} KB)</small>
                        </div>
                        ${botonHtml}
                    </div>
                `;
            }).join('');

            document.getElementById(`lista-pdfs-${visitaId}`).innerHTML = listaHtml;
        } else {
            console.log(`📄 [PDFS] Sin archivos para visita ${visitaId}`);
            document.getElementById(`lista-pdfs-${visitaId}`).innerHTML =
                '<p class="text-muted small">No hay archivos adjuntos para esta visita</p>';
        }

        // Restaurar botón
        iconoBoton.className = 'fas fa-sync';
        botonActualizar.disabled = false;

    } catch (error) {
        console.error('❌ [PDFS] Error cargando archivos:', error);
        console.error('❌ [PDFS] Tipo de error:', error.name);
        console.error('❌ [PDFS] Mensaje:', error.message);
        console.error('❌ [PDFS] Stack:', error.stack);

        // 🔧 FIX: Mostrar mensaje apropiado según el tipo de error
        let mensajeError;
        if (!navigator.onLine) {
            mensajeError = '<p class="text-warning small"><i class="fas fa-wifi-slash"></i> Sin conexión. Los archivos se mostrarán cuando te conectes a internet.</p>';
        } else if (error.message.includes('HTML') || error.message.includes('JSON') || error.message.includes('autenticación')) {
            mensajeError = '<p class="text-danger small"><i class="fas fa-lock"></i> Error de autenticación. Por favor cierra e inicia sesión nuevamente.</p>';
        } else if (error.message.includes('HTTP 401') || error.message.includes('HTTP 403')) {
            mensajeError = '<p class="text-danger small"><i class="fas fa-lock"></i> No autorizado. Inicia sesión nuevamente.</p>';
        } else if (error.message.includes('HTTP 404')) {
            mensajeError = '<p class="text-muted small"><i class="fas fa-info-circle"></i> No se encontraron archivos para esta visita.</p>';
        } else if (error.message.includes('HTTP 500')) {
            mensajeError = '<p class="text-danger small"><i class="fas fa-server"></i> Error del servidor. Intenta más tarde.</p>';
        } else if (error.name === 'SyntaxError') {
            mensajeError = '<p class="text-danger small"><i class="fas fa-lock"></i> Error de formato. Cierra e inicia sesión nuevamente.</p>';
        } else {
            mensajeError = `<p class="text-danger small"><i class="fas fa-exclamation-triangle"></i> Error: ${error.message}</p>`;
        }

        document.getElementById(`lista-pdfs-${visitaId}`).innerHTML = mensajeError;

        // Restaurar botón
        const botonActualizar = document.querySelector(`#pdfs-visita-${visitaId} button`);
        if (botonActualizar) {
            const iconoBoton = botonActualizar.querySelector('i');
            iconoBoton.className = 'fas fa-sync';
            botonActualizar.disabled = false;
        }

        // Solo mostrar alerta de error si NO es por estar offline
        if (navigator.onLine) {
            mostrarAlerta(`Error cargando archivos: ${error.message}`, 'danger');
        }
    }
}

// 🔧 FIX v1.60: Descargar PDFs automáticamente con barra de progreso
async function descargarPDFsEnBackground(mostrarModal = false) {
    // Solo ejecutar si hay conexión
    if (!navigator.onLine) {
        console.log('📴 [PDFS AUTO] Sin conexión, omitiendo descarga automática');
        return;
    }

    // Solo ejecutar si hay visitas asignadas
    if (!visitasAsignadas || visitasAsignadas.length === 0) {
        console.log('📄 [PDFS AUTO] No hay visitas asignadas');
        return;
    }

    console.log(`📥 [PDFS AUTO] Iniciando descarga automática de PDFs para ${visitasAsignadas.length} visitas...`);

    const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');
    if (!token) {
        console.warn('⚠️ [PDFS AUTO] Sin token, omitiendo descarga');
        return;
    }

    // Mostrar modal si se solicita
    let modal = null;
    if (mostrarModal && document.getElementById('modalCargaPdfs')) {
        modal = new bootstrap.Modal(document.getElementById('modalCargaPdfs'));
        modal.show();
    }

    try {
        // PASO 1: Contar total de PDFs disponibles
        if (modal) document.getElementById('textoCargaPdfs').textContent = 'Verificando archivos disponibles...';

        let totalPdfs = 0;
        const pdfsParaDescargar = [];

        for (const visita of visitasAsignadas) {
            try {
                const response = await fetch(APP_CONFIG.getApiUrl(`/api/visitas/${visita.id}/archivos-pdf`), {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const resultado = await response.json();
                    if (resultado.success && resultado.archivos && resultado.archivos.length > 0) {
                        for (const archivo of resultado.archivos) {
                            pdfsParaDescargar.push({ visita, archivo });
                            totalPdfs++;
                        }
                    }
                }
            } catch (error) {
                console.warn(`⚠️ [PDFS AUTO] Error obteniendo lista de visita ${visita.id}:`, error.message);
            }
        }

        console.log(`📊 [PDFS AUTO] Total de PDFs encontrados: ${totalPdfs}`);

        if (totalPdfs === 0) {
            console.log('📄 [PDFS AUTO] No hay PDFs para descargar');
            if (modal) modal.hide();
            return;
        }

        // PASO 2: Descargar PDFs con progreso
        let descargados = 0;
        let yaEnCache = 0;

        for (let i = 0; i < pdfsParaDescargar.length; i++) {
            const { visita, archivo } = pdfsParaDescargar[i];

            try {
                // Verificar si ya está en caché
                const pdfCached = await window.offlineManager.getPdfOffline(visita.id, archivo.nombre_archivo);

                if (pdfCached) {
                    yaEnCache++;
                    console.log(`💾 [PDFS AUTO] Ya en caché: ${archivo.nombre_original}`);
                } else {
                    // Descargar
                    const pdfUrl = APP_CONFIG.getApiUrl(`/uploads/pdfs_visitas/${archivo.nombre_archivo}`);
                    const pdfResponse = await fetch(pdfUrl, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (pdfResponse.ok) {
                        const pdfBlob = await pdfResponse.blob();
                        await window.offlineManager.savePdfOffline(visita.id, archivo.nombre_archivo, archivo.nombre_original, pdfBlob);
                        descargados++;
                        console.log(`✅ [PDFS AUTO] Descargado: ${archivo.nombre_original}`);
                    }
                }

                // Actualizar progreso
                const procesados = descargados + yaEnCache;
                const porcentaje = Math.round((procesados / totalPdfs) * 100);

                if (modal) {
                    document.getElementById('textoCargaPdfs').textContent = `Descargando ${archivo.nombre_original}...`;
                    document.getElementById('barraProgresoPdfs').style.width = `${porcentaje}%`;
                    document.getElementById('barraProgresoPdfs').setAttribute('aria-valuenow', porcentaje);
                    document.getElementById('porcentajePdfs').textContent = `${porcentaje}%`;
                    document.getElementById('contadorPdfs').textContent = `${procesados} / ${totalPdfs} archivos`;
                }

            } catch (pdfError) {
                console.warn(`⚠️ [PDFS AUTO] Error descargando ${archivo.nombre_archivo}:`, pdfError.message);
            }
        }

        console.log(`📥 [PDFS AUTO] Descarga completada - Nuevos: ${descargados}, Ya en caché: ${yaEnCache}`);

        // Cerrar modal después de 500ms
        if (modal) {
            document.getElementById('textoCargaPdfs').textContent = '¡Descarga completada!';
            setTimeout(() => modal.hide(), 500);
        }

    } catch (error) {
        console.error('❌ [PDFS AUTO] Error en descarga:', error);
        if (modal) modal.hide();
    }
}

// Variables globales para cronómetros
let cronometrosActivos = {};

// Funciones para persistencia de cronómetros
function guardarCronometro(visitaId, tiempoInicio, duracionSegundos) {
    const cronometros = JSON.parse(localStorage.getItem('cronometrosActivos') || '{}');
    cronometros[visitaId] = {
        tiempoInicio: tiempoInicio,
        duracionSegundos: duracionSegundos
    };
    localStorage.setItem('cronometrosActivos', JSON.stringify(cronometros));
}

function eliminarCronometro(visitaId) {
    const cronometros = JSON.parse(localStorage.getItem('cronometrosActivos') || '{}');
    delete cronometros[visitaId];
    localStorage.setItem('cronometrosActivos', JSON.stringify(cronometros));
}

function obtenerCronometrosSalvados() {
    return JSON.parse(localStorage.getItem('cronometrosActivos') || '{}');
}

// *** FUNCIONES PARA PERSISTIR ESTADO "CANCELAR VISITA" ***
function guardarEstadoCancelar(visitaId) {
    const estadosCancelar = JSON.parse(localStorage.getItem('estadosCancelarVisita') || '{}');
    estadosCancelar[visitaId] = {
        timestamp: Date.now(),
        estado: 'cancelar'
    };
    localStorage.setItem('estadosCancelarVisita', JSON.stringify(estadosCancelar));
    console.log(`💾 Estado "cancelar" guardado para visita ${visitaId}`);
}

function eliminarEstadoCancelar(visitaId) {
    const estadosCancelar = JSON.parse(localStorage.getItem('estadosCancelarVisita') || '{}');
    delete estadosCancelar[visitaId];
    localStorage.setItem('estadosCancelarVisita', JSON.stringify(estadosCancelar));
    console.log(`🗑️ Estado "cancelar" eliminado para visita ${visitaId}`);
}

function obtenerEstadosCancelar() {
    return JSON.parse(localStorage.getItem('estadosCancelarVisita') || '{}');
}

function restaurarCronometros() {
    const cronometrosSalvados = obtenerCronometrosSalvados();
    const estadosCancelar = obtenerEstadosCancelar();
    const ahora = Date.now();

    console.log('🔄 Restaurando cronómetros:', Object.keys(cronometrosSalvados));
    console.log('🔄 Restaurando estados cancelar:', Object.keys(estadosCancelar));

    // *** PRIMERO RESTAURAR ESTADOS "CANCELAR" ***
    Object.keys(estadosCancelar).forEach(visitaId => {
        const boton = document.getElementById(`btnNotificar${visitaId}`);
        if (boton) {
            console.log(`🚨 Restaurando estado "cancelar" para visita ${visitaId}`);
            mostrarBotonCancelar(visitaId, boton);
        }
    });

    // *** LUEGO RESTAURAR CRONÓMETROS ACTIVOS (solo si no están en estado cancelar) ***
    Object.keys(cronometrosSalvados).forEach(visitaId => {
        // Si ya está en estado "cancelar", no restaurar cronómetro
        if (estadosCancelar[visitaId]) {
            console.log(`⏭️ Omitiendo cronómetro para visita ${visitaId} - ya está en estado cancelar`);
            return;
        }

        const cronometro = cronometrosSalvados[visitaId];
        const tiempoTranscurrido = Math.floor((ahora - cronometro.tiempoInicio) / 1000);
        const tiempoRestante = cronometro.duracionSegundos - tiempoTranscurrido;

        console.log(`⏰ Visita ${visitaId}: ${tiempoRestante}s restantes de ${cronometro.duracionSegundos}s`);

        const boton = document.getElementById(`btnNotificar${visitaId}`);
        if (boton && tiempoRestante > 0) {
            // Restaurar cronómetro con el tiempo restante calculado
            console.log(`✅ Restaurando cronómetro para visita ${visitaId}`);
            iniciarCronometroConTiempo(visitaId, boton, tiempoRestante, cronometro.tiempoInicio, cronometro.duracionSegundos);
        } else if (boton) {
            // El tiempo ya expiró, mostrar botón de cancelar
            console.log(`⏰ Cronómetro expirado para visita ${visitaId}, mostrando botón cancelar`);
            mostrarBotonCancelar(visitaId, boton);
        } else {
            console.log(`❌ No se encontró botón para visita ${visitaId}`);
        }
    });
}

// Función para notificar cliente de llegada
async function notificarClienteLlegada(visitaId) {
    const visita = visitasAsignadas.find(v => v.id == visitaId);
    if (!visita) return;

    const boton = document.getElementById(`btnNotificar${visitaId}`);

    // Validar que el cliente tenga móvil
    if (!visita.cliente_movil || visita.cliente_movil.trim() === '') {
        mostrarAlerta('Este cliente no tiene número móvil registrado', 'warning');
        return;
    }

    // Deshabilitar botón inmediatamente para evitar doble clic
    if (boton) {
        boton.disabled = true;
        boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    }

    try {
        // Enviar notificación de llegada
        const response = await fetch(APP_CONFIG.getApiUrl('/api/notificar-llegada-cliente'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visitaId: visitaId,
                clienteNombre: visita.cliente_nombre,
                clienteMovil: visita.cliente_movil
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Notificación enviada al cliente', 'success');

            // Iniciar cronómetro de 10 minutos (600 segundos) con timestamp del PC
            const ahora = Date.now();
            console.log(`⏰ Iniciando cronómetro para visita ${visitaId} - Timestamp: ${ahora}`);
            guardarCronometro(visitaId, ahora, 600);
            iniciarCronometroConTiempo(visitaId, boton, 600, ahora, 600);
        } else {
            // Si hay error, restaurar el botón
            if (boton) {
                boton.disabled = false;
                boton.innerHTML = '<i class="fas fa-bell"></i> Notificar Mi Llegada';
            }
            mostrarAlerta(resultado.message || 'Error enviando notificación', 'danger');
        }

    } catch (error) {
        console.error('Error notificando cliente:', error);
        // Si hay error, restaurar el botón
        if (boton) {
            boton.disabled = false;
            boton.innerHTML = '<i class="fas fa-bell"></i> Notificar Mi Llegada';
        }
        mostrarAlerta('Error enviando notificación al cliente', 'danger');
    }
}

// Función para mostrar botón de cancelar
function mostrarBotonCancelar(visitaId, boton) {
    console.log(`🚨 Convirtiendo botón a "Cancelar Visita" para visita ${visitaId}`);

    boton.disabled = false;
    boton.classList.remove('btn-secondary');
    boton.classList.add('btn-danger');
    boton.innerHTML = '<i class="fas fa-times"></i> Cancelar Visita';
    boton.onclick = () => cancelarVisitaPorFaltaContacto(visitaId);

    // *** GUARDAR ESTADO "CANCELAR" EN LOCALSTORAGE ***
    guardarEstadoCancelar(visitaId);

    // *** NO ELIMINAR CRONÓMETRO AQUÍ - se elimina solo al cancelar la visita ***
    console.log(`✅ Botón convertido exitosamente para visita ${visitaId}`);
}

// Función para iniciar cronómetro con timestamp del PC
function iniciarCronometroConTiempo(visitaId, boton, tiempoRestanteInicial, tiempoInicio, duracionTotal) {
    console.log(`🕐 Iniciando cronómetro para visita ${visitaId}: ${tiempoRestanteInicial}s restantes`);

    // Deshabilitar el botón
    boton.disabled = true;
    boton.classList.remove('btn-warning');
    boton.classList.add('btn-secondary');

    // Función para actualizar el display del cronómetro
    function actualizarCronometro() {
        const ahora = Date.now();
        const tiempoTranscurrido = Math.floor((ahora - tiempoInicio) / 1000);
        const tiempoRestante = duracionTotal - tiempoTranscurrido;

        console.log(`⏲️ Cronómetro visita ${visitaId}: ${tiempoRestante}s restantes (transcurrido: ${tiempoTranscurrido}s)`);

        if (tiempoRestante > 0) {
            const minutos = Math.floor(tiempoRestante / 60);
            const segs = tiempoRestante % 60;

            boton.innerHTML = `
                <i class="fas fa-clock"></i> ${minutos}:${segs.toString().padStart(2, '0')}
            `;
        } else {
            // Tiempo agotado
            console.log(`⏰ Tiempo agotado para visita ${visitaId}, convirtiendo a botón cancelar`);
            clearInterval(cronometrosActivos[visitaId]);
            delete cronometrosActivos[visitaId];
            mostrarBotonCancelar(visitaId, boton);
        }
    }

    // Actualizar inmediatamente
    actualizarCronometro();

    // Guardar referencia del cronómetro
    cronometrosActivos[visitaId] = setInterval(actualizarCronometro, 1000);
}

// Función para cancelar visita por falta de contacto
async function cancelarVisitaPorFaltaContacto(visitaId) {
    if (!confirm('¿Estás seguro de que quieres cancelar esta visita por falta de contacto?')) {
        return;
    }

    const visita = visitasAsignadas.find(v => v.id == visitaId);
    if (!visita) return;

    try {
        const response = await fetch(APP_CONFIG.getApiUrl('/api/cancelar-visita-sin-contacto'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visitaId: visitaId,
                clienteNombre: visita.cliente_nombre,
                clienteMovil: visita.cliente_movil
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Visita cancelada y cliente notificado', 'info');

            // Limpiar cronómetro activo y guardado
            if (cronometrosActivos[visitaId]) {
                clearInterval(cronometrosActivos[visitaId]);
                delete cronometrosActivos[visitaId];
            }
            eliminarCronometro(visitaId);

            // *** ELIMINAR ESTADO "CANCELAR" ***
            eliminarEstadoCancelar(visitaId);

            // *** RESTAURAR BOTÓN A "NOTIFICAR MI LLEGADA" ***
            const boton = document.getElementById(`btnNotificar${visitaId}`);
            if (boton) {
                boton.disabled = false;
                boton.classList.remove('btn-danger');
                boton.classList.add('btn-warning');
                boton.innerHTML = '<i class="fas fa-bell"></i> Notificar Mi Llegada';
                boton.onclick = () => notificarClienteLlegada(visitaId);
                console.log(`🔄 Botón restaurado a "Notificar Mi Llegada" para visita ${visitaId}`);
            }

            // Remover la visita de la lista local
            visitasAsignadas = visitasAsignadas.filter(v => v.id != visitaId);
            visitasSinFiltrar = visitasSinFiltrar.filter(v => v.id != visitaId);
            mostrarVisitasAsignadas();
        } else {
            mostrarAlerta(resultado.message || 'Error cancelando la visita', 'danger');
        }

    } catch (error) {
        console.error('Error cancelando visita:', error);
        mostrarAlerta('Error cancelando la visita', 'danger');
    }
}


// Función para actualizar el indicador de última actualización
function actualizarIndicadorActualizacion() {
    const indicador = document.getElementById('ultimaActualizacionTexto');
    if (!indicador) return;

    if (ultimaActualizacion) {
        const ahora = new Date();
        const horaActualizacion = new Date(ultimaActualizacion);
        const horaFormateada = horaActualizacion.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        indicador.innerHTML = `
            <i class="fas fa-check-circle"></i>
            Actualizado: ${horaFormateada}
            <span class="badge bg-light text-success ms-1">Auto: 10s</span>
        `;
    }
}

// Función para iniciar actualización automática cada 10 segundos
function iniciarActualizacionAutomatica() {
    // Limpiar intervalo anterior si existe
    if (intervaloActualizacion) {
        clearInterval(intervaloActualizacion);
    }

    // Configurar actualización cada 30 segundos (30000 ms) - Optimizado para mejor rendimiento
    intervaloActualizacion = setInterval(async () => {
        console.log('🔄 Actualizando visitas automáticamente...');
        await cargarVisitasTecnico(false); // No mostrar spinner en actualizaciones automáticas

        // 🆕 v1.74.3: Reverificar permisos NAP en cada actualización automática
        console.log('🔄 [NAP] Reverificando permisos en actualización automática...');
        await verificarPermisoAgregarNaps();
    }, 30000);

    console.log('✅ Actualización automática iniciada (cada 30 segundos)');
}

// Función para detener actualización automática
function detenerActualizacionAutomatica() {
    if (intervaloActualizacion) {
        clearInterval(intervaloActualizacion);
        intervaloActualizacion = null;
        console.log('⏸️ Actualización automática detenida');
    }
}

// Función para mostrar alertas
function mostrarAlerta(mensaje, tipo = 'info') {
    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo} alert-dismissible fade show position-fixed`;
    alerta.style.cssText = 'top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
    alerta.innerHTML = `
        ${mensaje}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(alerta);

    setTimeout(() => {
        if (document.body.contains(alerta)) {
            alerta.remove();
        }
    }, 5000);
}

// ==================== SISTEMA DE UBICACIÓN AUTOMÁTICA DEL TÉCNICO ====================

let intervaloUbicacion = null;
let ultimaUbicacionEnviada = null;

/**
 * Inicia el envío automático de ubicación del técnico cada 2 minutos
 */
function iniciarEnvioUbicacionAutomatica() {
    console.log('🚀 [CLIENTE] Iniciando sistema de envío automático de ubicación...');

    // Limpiar intervalo anterior si existe
    if (intervaloUbicacion) {
        console.log('🔄 [CLIENTE] Limpiando intervalo anterior');
        clearInterval(intervaloUbicacion);
    }

    // Enviar ubicación inmediatamente al cargar la página
    console.log('📍 [CLIENTE] Enviando ubicación inicial...');
    enviarUbicacionTecnico();

    // Configurar envío automático cada 10 segundos
    intervaloUbicacion = setInterval(() => {
        console.log('⏰ [CLIENTE] Intervalo de 10 segundos alcanzado, enviando ubicación automática...');
        enviarUbicacionTecnico();
    }, 10000); // 10 segundos

    console.log('✅ [CLIENTE] Sistema de envío automático configurado (cada 10 segundos)');
}

/**
 * Envía la ubicación actual del técnico al servidor
 */
async function enviarUbicacionTecnico() {
    try {
        console.log('📍 [CLIENTE] Iniciando envío de ubicación...');

        // Verificar si el navegador soporta geolocalización
        if (!navigator.geolocation) {
            console.error('❌ [CLIENTE] El navegador no soporta geolocalización');
            return;
        }

        // Obtener token de autenticación
        const token = localStorage.getItem('token_tecnico');
        if (!token) {
            console.error('❌ [CLIENTE] No hay token de autenticación para enviar ubicación');
            console.log('📍 [CLIENTE] Tokens disponibles en localStorage:', Object.keys(localStorage));
            return;
        }

        console.log('📍 [CLIENTE] Token encontrado, solicitando ubicación GPS...');

        // Obtener ubicación actual con timeout más largo
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                console.log('📍 [CLIENTE] Ubicación GPS obtenida exitosamente');

                const ubicacion = {
                    latitud: position.coords.latitude,
                    longitud: position.coords.longitude,
                    precision_gps: position.coords.accuracy
                };

                console.log(`📍 [CLIENTE] Coordenadas: Lat ${ubicacion.latitud}, Lng ${ubicacion.longitud}, Precisión: ${ubicacion.precision_gps}m`);

                // Verificar si la ubicación cambió significativamente (más de 10 metros)
                if (ultimaUbicacionEnviada) {
                    const distancia = calcularDistancia(
                        ultimaUbicacionEnviada.latitud,
                        ultimaUbicacionEnviada.longitud,
                        ubicacion.latitud,
                        ubicacion.longitud
                    );

                    if (distancia < 10) {
                        console.log(`📍 [CLIENTE] Ubicación similar a la anterior (${distancia.toFixed(2)}m), omitiendo envío`);
                        return;
                    }
                    console.log(`📍 [CLIENTE] Ubicación cambió ${distancia.toFixed(2)}m, enviando actualización`);
                }

                // NO enviar ubicación si está offline
                if (!navigator.onLine) {
                    console.log('📴 [CLIENTE] Offline: Omitiendo envío de ubicación');
                    return;
                }

                console.log('📍 [CLIENTE] Enviando ubicación al servidor...');

                // Enviar ubicación al servidor
                const response = await fetch(APP_CONFIG.getApiUrl('/api/tecnicos/ubicacion'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(ubicacion)
                });

                console.log(`📍 [CLIENTE] Respuesta del servidor: HTTP ${response.status}`);

                const resultado = await response.json();

                if (resultado.success) {
                    console.log('✅ [CLIENTE] Ubicación enviada y guardada exitosamente');
                    ultimaUbicacionEnviada = ubicacion;
                } else {
                    console.error('❌ [CLIENTE] Error del servidor:', resultado.message);
                }
            },
            (error) => {
                console.error('❌ [CLIENTE] Error obteniendo ubicación GPS:', error.message, `Código: ${error.code}`);

                // No mostrar alerta al usuario para no interrumpir su trabajo
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        console.error('⛔ [CLIENTE] Permiso de ubicación DENEGADO por el usuario o navegador');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        console.error('⚠️ [CLIENTE] Ubicación no disponible (GPS apagado o sin señal)');
                        break;
                    case error.TIMEOUT:
                        console.error('⏱️ [CLIENTE] Timeout obteniendo ubicación (tardó demasiado)');
                        break;
                }
            },
            {
                enableHighAccuracy: false, // Usar baja precisión para ahorrar batería
                timeout: 10000, // 10 segundos de timeout
                maximumAge: 60000 // Aceptar ubicaciones de hasta 1 minuto de antigüedad
            }
        );
    } catch (error) {
        console.error('❌ Error en enviarUbicacionTecnico:', error);
    }
}

/**
 * Calcula la distancia entre dos coordenadas GPS en metros (fórmula de Haversine)
 */
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radio de la Tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distancia = R * c;

    return distancia;
}

/**
 * Detiene el envío automático de ubicación
 */
function detenerEnvioUbicacionAutomatica() {
    if (intervaloUbicacion) {
        clearInterval(intervaloUbicacion);
        intervaloUbicacion = null;
        console.log('⏸️ Envío automático de ubicación detenido');
    }
}

// Iniciar envío de ubicación automática cuando se cargue el sistema
document.addEventListener('DOMContentLoaded', function() {
    // Dar tiempo a que el sistema se inicialice antes de enviar ubicación
    setTimeout(() => {
        iniciarEnvioUbicacionAutomatica();
    }, 3000); // Esperar 3 segundos después de cargar la página
});

// 🔧 FIX v1.57: Listener para abrir PDFs al tocar notificación
document.addEventListener('DOMContentLoaded', function() {
    // Solo en app nativa con Capacitor
    if (APP_CONFIG.isNative() && window.Capacitor?.Plugins?.LocalNotifications) {
        console.log('📱 [NOTIFICACIÓN] Registrando listener para clicks en notificaciones...');

        const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;

        // Listener para cuando se toca una notificación
        LocalNotifications.addListener('localNotificationActionPerformed', async (notification) => {
            console.log('🔔 [NOTIFICACIÓN] Usuario tocó notificación:', JSON.stringify(notification, null, 2));

            // Extraer información del PDF
            const fileUri = notification.notification?.extra?.fileUri;
            const fileName = notification.notification?.extra?.fileName;
            const action = notification.notification?.extra?.action;

            console.log('🔔 [NOTIFICACIÓN] Action:', action);
            console.log('🔔 [NOTIFICACIÓN] FileURI:', fileUri);
            console.log('🔔 [NOTIFICACIÓN] FileName:', fileName);

            if (action === 'open_pdf' && fileUri) {
                console.log('📄 [NOTIFICACIÓN] Intentando abrir PDF desde notificación...');

                try {
                    // Usar la función global abrirPDFConFileOpener
                    await window.abrirPDFConFileOpener(fileUri);
                    console.log('✅ [NOTIFICACIÓN] PDF abierto exitosamente desde notificación');
                } catch (error) {
                    console.error('❌ [NOTIFICACIÓN] Error abriendo PDF:', error);
                    alert(`Error al abrir el PDF.\n\nPuedes encontrarlo en:\nDocumentos/${fileName || 'archivo PDF'}`);
                }
            } else {
                console.warn('⚠️ [NOTIFICACIÓN] No se encontró fileUri en extras de notificación');
            }
        });

        console.log('✅ [NOTIFICACIÓN] Listener registrado correctamente');
    }
});

// 🔧 FIX v1.61: Listener para reconexión - recargar visitas y PDFs
window.addEventListener('online', function() {
    console.log('🌐 [CONEXIÓN] Conexión restaurada - El sistema de actualización automática descargará PDFs pendientes');
});

// Log cuando se pierde la conexión
window.addEventListener('offline', function() {
    console.log('📴 [CONEXIÓN] Conexión perdida - Modo offline activado');
});

// ========================================
// MAPA DE CLIENTES
// ========================================

// Variables globales para el mapa de clientes
let mapaClientes = null;
let grupoMarcadoresClientes = null; // LayerGroup para marcadores
let intervaloActualizacionMapa = null;

/**
 * Inicializa el mapa de clientes con Leaflet
 */
function inicializarMapaClientes() {
    console.log('🗺️ Inicializando mapa de clientes...');

    // NO limpiar mapa si ya existe - esto causaba el reseteo del zoom
    if (mapaClientes) {
        console.log('⚠️ Mapa ya inicializado, saltando reinicialización');
        return;
    }

    // Crear mapa centrado en Colombia (solo la primera vez)
    mapaClientes = L.map('mapaClientes').setView([7.8939, -76.2958], 13);

    // Capa base: OpenStreetMap (vista normal)
    const capaOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 22,
        maxNativeZoom: 19
    });

    // Capa satélite: Esri World Imagery
    const capaSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
        maxZoom: 22,
        maxNativeZoom: 18
    });

    // Capa híbrida: Satélite + etiquetas
    const capaHibrida = L.layerGroup([
        capaSatelite,
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
            maxZoom: 22,
            maxNativeZoom: 18
        })
    ]);

    // Control de capas para cambiar entre vistas
    const capasBase = {
        "Vista Normal": capaOSM,
        "Vista Satélite": capaSatelite,
        "Vista Híbrida": capaHibrida
    };

    // Agregar capa por defecto (satélite, como solicitó el usuario)
    capaSatelite.addTo(mapaClientes);

    // Agregar control de capas
    L.control.layers(capasBase, null, { position: 'topright' }).addTo(mapaClientes);

    // Agregar control de ubicación actual (botón azul)
    agregarControlUbicacionActualTecnico();

    // Crear LayerGroup para manejar marcadores de clientes
    grupoMarcadoresClientes = L.layerGroup().addTo(mapaClientes);

    console.log('✅ Mapa de clientes inicializado');
}

/**
 * Agrega un botón de ubicación actual que muestra la posición del técnico en tiempo real
 */
function agregarControlUbicacionActualTecnico() {
    let marcadorUbicacionActual = null;
    let circuloPrecision = null;
    let siguiendoUbicacion = false;
    let watchId = null;
    let esPrimeraUbicacion = true; // Para centrar solo la primera vez

    // Crear botón personalizado de ubicación
    const LocateControl = L.Control.extend({
        onAdd: function(map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
            container.innerHTML = '<button style="width: 30px; height: 30px; background: white; border: 2px solid rgba(0,0,0,0.2); border-radius: 4px; cursor: pointer; font-size: 18px;" title="Mi ubicación">📍</button>';

            container.onclick = function() {
                if (!siguiendoUbicacion) {
                    iniciarSeguimiento();
                } else {
                    detenerSeguimiento();
                }
            };

            return container;
        }
    });

    const locateControl = new LocateControl({ position: 'topleft' });
    locateControl.addTo(mapaClientes);

    function iniciarSeguimiento() {
        siguiendoUbicacion = true;
        esPrimeraUbicacion = true; // Resetear para centrar en la primera ubicación

        // Verificar si el navegador soporta geolocalización
        if (!navigator.geolocation) {
            alert('Tu navegador no soporta geolocalización');
            return;
        }

        // Iniciar seguimiento continuo
        watchId = navigator.geolocation.watchPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const precision = position.coords.accuracy;

                // Remover marcadores anteriores
                if (marcadorUbicacionActual) {
                    mapaClientes.removeLayer(marcadorUbicacionActual);
                }
                if (circuloPrecision) {
                    mapaClientes.removeLayer(circuloPrecision);
                }

                // Crear círculo de precisión
                circuloPrecision = L.circle([lat, lng], {
                    radius: precision,
                    color: '#4285F4',
                    fillColor: '#4285F4',
                    fillOpacity: 0.1,
                    weight: 1
                }).addTo(mapaClientes);

                // Crear marcador de ubicación actual (punto azul)
                marcadorUbicacionActual = L.circleMarker([lat, lng], {
                    radius: 8,
                    fillColor: '#4285F4',
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 1
                }).addTo(mapaClientes);

                // Centrar mapa SOLO en la primera ubicación, después solo actualizar marcador
                if (esPrimeraUbicacion) {
                    mapaClientes.setView([lat, lng], 16);
                    esPrimeraUbicacion = false;
                    console.log('📍 Primera ubicación - mapa centrado en:', lat, lng);
                } else {
                    console.log('📍 Ubicación actualizada (sin cambiar zoom):', lat, lng, 'Precisión:', precision, 'm');
                }
            },
            function(error) {
                console.error('❌ Error obteniendo ubicación:', error);
                alert('No se pudo obtener tu ubicación. Verifica los permisos del navegador.');
                detenerSeguimiento();
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 27000
            }
        );

        console.log('✅ Seguimiento de ubicación del técnico iniciado');
    }

    function detenerSeguimiento() {
        siguiendoUbicacion = false;

        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        // Remover marcadores
        if (marcadorUbicacionActual) {
            mapaClientes.removeLayer(marcadorUbicacionActual);
            marcadorUbicacionActual = null;
        }
        if (circuloPrecision) {
            mapaClientes.removeLayer(circuloPrecision);
            circuloPrecision = null;
        }

        console.log('⏹️ Seguimiento de ubicación del técnico detenido');
    }
}

/**
 * Abre el modal del mapa y carga las ubicaciones de clientes
 */
async function abrirMapaClientes() {
    console.log('📍 Abriendo mapa de clientes...');

    // Inicializar mapa si no existe
    if (!mapaClientes) {
        // Esperar a que el modal se muestre para que el div tenga dimensiones
        setTimeout(() => {
            inicializarMapaClientes();
            cargarUbicacionesClientes();
        }, 300);
    } else {
        // Si ya existe, solo actualizar las ubicaciones
        cargarUbicacionesClientes();
    }

    // Iniciar actualización automática cada 30 segundos
    if (intervaloActualizacionMapa) {
        clearInterval(intervaloActualizacionMapa);
    }

    intervaloActualizacionMapa = setInterval(() => {
        console.log('🔄 Actualización automática del mapa de clientes...');
        cargarUbicacionesClientes();
    }, 30000); // Cada 30 segundos

    // Detener actualización cuando se cierre el modal
    const modal = document.getElementById('modalMapaClientes');
    modal.addEventListener('hidden.bs.modal', function() {
        if (intervaloActualizacionMapa) {
            clearInterval(intervaloActualizacionMapa);
            intervaloActualizacionMapa = null;
            console.log('⏸️ Actualización automática del mapa detenida');
        }
    });
}

/**
 * Carga las ubicaciones de los clientes de las visitas asignadas
 */
async function cargarUbicacionesClientes() {
    try {
        console.log('📍 Cargando ubicaciones de clientes...');

        const token = localStorage.getItem('token_tecnico');
        if (!token) {
            console.error('❌ No hay token de autenticación');
            return;
        }

        let ubicaciones = [];

        // 🔧 v1.69: Intentar cargar desde servidor (online) o localStorage (offline)
        if (navigator.onLine) {
            try {
                console.log('🌐 [ONLINE] Descargando ubicaciones desde servidor...');

                // Obtener ubicaciones de clientes desde el servidor
                const response = await fetch(APP_CONFIG.getApiUrl('/api/ubicaciones-clientes-asignados'), {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();

                if (!data.success) {
                    console.error('❌ Error del servidor:', data.message);
                    return;
                }

                ubicaciones = data.ubicaciones || [];
                console.log(`📍 ${ubicaciones.length} ubicaciones de clientes descargadas`);

                // 🔧 v1.70: GUARDAR en localStorage CON ID del técnico (evita mezclar técnicos)
                if (ubicaciones.length > 0) {
                    const userStorage = localStorage.getItem('user_tecnico');
                    const tecnicoId = userStorage ? JSON.parse(userStorage).id : 'unknown';

                    localStorage.setItem(`ubicaciones_clientes_cache_${tecnicoId}`, JSON.stringify(ubicaciones));
                    localStorage.setItem(`ubicaciones_clientes_timestamp_${tecnicoId}`, Date.now().toString());
                    console.log(`💾 [CACHE] ${ubicaciones.length} ubicaciones guardadas para técnico ${tecnicoId}`);
                }

            } catch (fetchError) {
                console.warn('⚠️ [FETCH] Error descargando ubicaciones, intentando desde caché:', fetchError.message);

                // 🔧 v1.70: Fallback a localStorage del técnico específico
                const userStorage = localStorage.getItem('user_tecnico');
                const tecnicoId = userStorage ? JSON.parse(userStorage).id : 'unknown';
                const cachedData = localStorage.getItem(`ubicaciones_clientes_cache_${tecnicoId}`);

                if (cachedData) {
                    ubicaciones = JSON.parse(cachedData);
                    console.log(`💾 [CACHE] ${ubicaciones.length} ubicaciones cargadas desde caché del técnico ${tecnicoId} (fetch falló)`);
                }
            }
        } else {
            // 🔧 v1.70: MODO OFFLINE - Cargar desde localStorage del técnico específico
            console.log('📴 [OFFLINE] Cargando ubicaciones desde caché local...');

            const userStorage = localStorage.getItem('user_tecnico');
            const tecnicoId = userStorage ? JSON.parse(userStorage).id : 'unknown';
            const cachedData = localStorage.getItem(`ubicaciones_clientes_cache_${tecnicoId}`);

            if (cachedData) {
                ubicaciones = JSON.parse(cachedData);
                const timestamp = localStorage.getItem(`ubicaciones_clientes_timestamp_${tecnicoId}`);
                const fecha = timestamp ? new Date(parseInt(timestamp)).toLocaleString() : 'desconocida';
                console.log(`💾 [OFFLINE] ${ubicaciones.length} ubicaciones del técnico ${tecnicoId} cargadas desde caché (última actualización: ${fecha})`);
            } else {
                console.warn(`⚠️ [OFFLINE] No hay ubicaciones en caché para el técnico ${tecnicoId}. Descarga el mapa en modo online primero.`);
                alert('⚠️ No hay ubicaciones guardadas para este técnico. Abre el mapa con conexión para descargar las ubicaciones.');
                return;
            }
        }

        // Limpiar marcadores anteriores usando LayerGroup
        if (grupoMarcadoresClientes) {
            grupoMarcadoresClientes.clearLayers(); // Limpia sin afectar el zoom
            console.log('🧹 Marcadores anteriores limpiados del LayerGroup');
        }

        if (ubicaciones.length === 0) {
            console.log('⚠️ No hay clientes con ubicación asignados');
            return;
        }

        // Crear marcadores para cada cliente
        const bounds = [];

        ubicaciones.forEach((ubicacion, index) => {
            const lat = parseFloat(ubicacion.latitud);
            const lng = parseFloat(ubicacion.longitud);

            if (isNaN(lat) || isNaN(lng)) {
                console.warn(`⚠️ Coordenadas inválidas para cliente ${ubicacion.nombre_cliente}`);
                return;
            }

            bounds.push([lat, lng]);

            // Color según estado de la visita
            let colorMarcador = '#007bff'; // Azul por defecto (asignada)
            let iconoEstado = 'map-marker-alt';
            let textoEstado = 'Pendiente';

            if (ubicacion.estado_visita === 'en_progreso') {
                colorMarcador = '#ffc107'; // Amarillo
                iconoEstado = 'clock';
                textoEstado = 'En Progreso';
            } else if (ubicacion.estado_visita === 'programada') {
                colorMarcador = '#6c757d'; // Gris
                iconoEstado = 'calendar';
                textoEstado = 'Programada';
            }

            // Crear icono personalizado
            const iconoCliente = L.divIcon({
                className: 'custom-marker-cliente',
                html: `<div style="background-color: ${colorMarcador};">
                    <i class="fas fa-${iconoEstado}"></i>
                </div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15],
                popupAnchor: [0, -15]
            });

            // Contenido del popup
            const popupContent = `
                <div style="min-width: 200px;">
                    <h6 class="mb-2"><i class="fas fa-user"></i> ${ubicacion.nombre_cliente || 'Sin nombre'}</h6>
                    <p class="mb-1 text-muted" style="font-size: 0.85rem;">
                        <strong>Dirección:</strong><br>
                        ${ubicacion.direccion || 'No especificada'}
                    </p>
                    <p class="mb-1 text-muted" style="font-size: 0.85rem;">
                        <strong>Localidad:</strong> ${ubicacion.localidad || 'N/A'}
                    </p>
                    <p class="mb-1 text-muted" style="font-size: 0.85rem;">
                        <strong>Estado:</strong>
                        <span class="badge" style="background-color: ${colorMarcador};">${textoEstado}</span>
                    </p>
                    ${ubicacion.observaciones ? `
                        <p class="mb-1 text-muted" style="font-size: 0.85rem;">
                            <strong>Observaciones:</strong><br>
                            ${ubicacion.observaciones}
                        </p>
                    ` : ''}
                    <p class="mb-0 text-muted" style="font-size: 0.75rem;">
                        <i class="fas fa-map-pin"></i> ${lat.toFixed(6)}, ${lng.toFixed(6)}
                    </p>
                    <hr style="margin: 8px 0;">
                    <a href="https://www.google.com/maps?q=${lat},${lng}"
                       target="_blank"
                       class="btn btn-sm btn-primary w-100"
                       style="font-size: 0.8rem;">
                        <i class="fas fa-route"></i> Abrir en Google Maps
                    </a>
                </div>
            `;

            // Crear marcador y agregarlo al LayerGroup (NO al mapa directamente)
            const marcador = L.marker([lat, lng], { icon: iconoCliente });
            marcador.bindPopup(popupContent);
            marcador.addTo(grupoMarcadoresClientes); // Agregar al LayerGroup en lugar del mapa

            console.log(`✅ Marcador creado para: ${ubicacion.nombre_cliente} (${textoEstado})`);
        });

        // NO ajustar zoom ni posición del mapa
        // Las actualizaciones solo refrescan los marcadores
        // El usuario tiene control total del zoom

        // Actualizar hora de última actualización
        const ahora = new Date();
        const horaTexto = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('horaActualizacionMapa').textContent = horaTexto;

        console.log('✅ Ubicaciones de clientes cargadas en el mapa');

    } catch (error) {
        console.error('❌ Error cargando ubicaciones de clientes:', error);
    }
}

/**
 * Actualiza el mapa de clientes (llamado desde el botón)
 */
function actualizarMapaClientes() {
    console.log('🔄 Actualizando mapa de clientes manualmente...');
    cargarUbicacionesClientes();
}

/**
 * ============================================
 * FUNCIONALIDAD PARA AGREGAR CAJAS NAP
 * ============================================
 */

// Verificar si el técnico puede agregar NAPs y mostrar botón
async function verificarPermisoAgregarNaps() {
    try {
        console.log('🔍 [NAP] Verificando permisos para agregar cajas NAP...');

        // 🆕 v1.74.2: Si está offline, verificar permiso guardado en localStorage
        if (!navigator.onLine) {
            console.log('📴 [NAP] Offline: Verificando permiso guardado localmente');
            const permisoGuardado = localStorage.getItem('puede_agregar_naps');
            console.log('🔍 [NAP] Permiso guardado:', permisoGuardado);

            const btnNap = document.getElementById('btnNuevaNap');
            if (permisoGuardado === '1') {
                if (btnNap) {
                    btnNap.style.display = 'inline-block';
                    console.log('✅ [NAP] Offline: Botón mostrado usando permiso guardado');
                }

                // Cargar última zona seleccionada
                const ultimaZona = localStorage.getItem('ultimaZonaNap');
                if (ultimaZona) {
                    const selectZona = document.getElementById('zonaNap');
                    if (selectZona) {
                        selectZona.value = ultimaZona;
                    }
                }
            } else {
                // 🆕 v1.74.3: Ocultar botón si no hay permiso
                if (btnNap) {
                    btnNap.style.display = 'none';
                    console.log('🚫 [NAP] Offline: Botón ocultado - sin permiso');
                }
            }
            return;
        }

        const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');
        console.log('🔍 [NAP] Token encontrado:', token ? 'Sí' : 'No');

        const response = await fetch(APP_CONFIG.getApiUrl('/api/usuario-actual'), {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const resultado = await response.json();
        console.log('🔍 [NAP] Respuesta del servidor:', resultado);
        console.log('🔍 [NAP] puede_agregar_naps:', resultado.usuario?.puede_agregar_naps);
        console.log('🔍 [NAP] Tipo de puede_agregar_naps:', typeof resultado.usuario?.puede_agregar_naps);

        // 🆕 v1.74.2: Guardar permiso en localStorage para uso offline
        if (resultado.success && resultado.usuario) {
            const permiso = resultado.usuario.puede_agregar_naps === 1 ? '1' : '0';
            localStorage.setItem('puede_agregar_naps', permiso);
            console.log('💾 [NAP] Permiso guardado en localStorage:', permiso);
        }

        const btnNap = document.getElementById('btnNuevaNap');
        console.log('🔍 [NAP] Botón encontrado:', btnNap ? 'Sí' : 'No');

        if (resultado.success && resultado.usuario.puede_agregar_naps === 1) {
            if (btnNap) {
                btnNap.style.display = 'inline-block';
                console.log('✅ [NAP] Técnico autorizado - Botón mostrado');
            } else {
                console.error('❌ [NAP] Botón btnNuevaNap no encontrado en el DOM');
            }

            // Cargar última zona seleccionada
            const ultimaZona = localStorage.getItem('ultimaZonaNap');
            if (ultimaZona) {
                const selectZona = document.getElementById('zonaNap');
                if (selectZona) {
                    selectZona.value = ultimaZona;
                }
            }

            // Guardar zona cuando cambie
            const zonaNap = document.getElementById('zonaNap');
            if (zonaNap) {
                zonaNap.addEventListener('change', function() {
                    localStorage.setItem('ultimaZonaNap', this.value);
                });
            }

            // Limpiar formulario al cerrar modal
            const modalNap = document.getElementById('modalNuevaNap');
            if (modalNap) {
                // Restaurar última zona al abrir modal
                modalNap.addEventListener('shown.bs.modal', function() {
                    const ultimaZona = localStorage.getItem('ultimaZonaNap');
                    if (ultimaZona) {
                        document.getElementById('zonaNap').value = ultimaZona;
                        console.log('✅ [NAP] Zona restaurada:', ultimaZona);
                    }
                });

                // Limpiar formulario al cerrar modal
                modalNap.addEventListener('hidden.bs.modal', function() {
                    limpiarFormularioNap();
                });
            }
        } else {
            // 🆕 v1.74.3: Ocultar botón si no hay permiso
            if (btnNap) {
                btnNap.style.display = 'none';
                console.log('🚫 [NAP] Online: Botón ocultado - sin permiso');
            }
            console.log('ℹ️ [NAP] Técnico NO autorizado para agregar cajas NAP');
            console.log('ℹ️ [NAP] Success:', resultado.success);
            console.log('ℹ️ [NAP] Permiso:', resultado.usuario?.puede_agregar_naps);
        }
    } catch (error) {
        console.error('❌ [NAP] Error verificando permisos NAP:', error);
    }
}

// Actualizar valor del slider de puertos
function actualizarValorPuertos(valor) {
    document.getElementById('valorPuertos').textContent = `${valor} puertos`;
}

// Limpiar formulario de caja NAP
function limpiarFormularioNap() {
    document.getElementById('descripcionNap').value = '';
    document.getElementById('puertosNap').value = '8';
    document.getElementById('valorPuertos').textContent = '8 puertos';
    document.getElementById('ubicacionNap').value = '';
    document.getElementById('detallesNap').value = '';

    // Limpiar campos de coordenadas ocultos
    document.getElementById('latitudNap').value = '';
    document.getElementById('longitudNap').value = '';
    document.getElementById('precisionNap').value = '';

    // Limpiar campos de coordenadas visibles
    document.getElementById('latitudNapMostrar').value = '';
    document.getElementById('longitudNapMostrar').value = '';
    document.getElementById('precisionNapMostrar').value = '';

    // Ocultar estado de coordenadas
    document.getElementById('estadoCoordenadasNap').classList.add('d-none');

    // Resetear botón
    const btnCapturar = document.getElementById('btnTomarCoordenadasNap');
    btnCapturar.disabled = false;
    btnCapturar.innerHTML = '<i class="fas fa-crosshairs"></i> Tomar Coordenadas GPS';

    // Limpiar variable global
    coordenadasNapCapturadas = null;
}

// Función principal para capturar coordenadas NAP
async function capturarCoordenadasNap() {
    const btnCapturar = document.getElementById('btnTomarCoordenadasNap');
    const estadoCoordenadas = document.getElementById('estadoCoordenadasNap');

    btnCapturar.disabled = true;
    btnCapturar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Capturando...';

    try {
        const coordenadas = await capturarCoordenadasGPSNap();

        if (coordenadas) {
            // Almacenar coordenadas globalmente
            coordenadasNapCapturadas = coordenadas;

            // Mostrar coordenadas capturadas en campos visibles
            document.getElementById('latitudNapMostrar').value = coordenadas.latitude.toFixed(8);
            document.getElementById('longitudNapMostrar').value = coordenadas.longitude.toFixed(8);
            document.getElementById('precisionNapMostrar').value = coordenadas.accuracy.toFixed(2);

            // Guardar en campos ocultos
            document.getElementById('latitudNap').value = coordenadas.latitude;
            document.getElementById('longitudNap').value = coordenadas.longitude;
            document.getElementById('precisionNap').value = coordenadas.accuracy;

            // Mostrar estado de precisión
            const estadoPrecision = document.getElementById('estadoPrecisionNap');
            if (coordenadas.accuracy <= 9) {
                estadoPrecision.innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle"></i> <strong>¡Excelente!</strong> Precisión de ${coordenadas.accuracy.toFixed(2)} metros. Las coordenadas son válidas.
                    </div>
                `;
            } else {
                estadoPrecision.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle"></i> <strong>Precisión insuficiente:</strong> ${coordenadas.accuracy.toFixed(2)} metros. Se requiere 9 metros o menos. Por favor, intenta nuevamente en un lugar con mejor señal GPS.
                    </div>
                `;
                // Limpiar coordenadas si no cumplen el requisito
                document.getElementById('latitudNap').value = '';
                document.getElementById('longitudNap').value = '';
                document.getElementById('precisionNap').value = '';
                coordenadasNapCapturadas = null;
            }

            estadoCoordenadas.classList.remove('d-none');
            btnCapturar.innerHTML = '<i class="fas fa-redo"></i> Volver a Tomar Coordenadas';

            // Obtener ubicación automáticamente usando reverse geocoding
            obtenerUbicacionPorCoordenadas(coordenadas.latitude, coordenadas.longitude);
        }
    } catch (error) {
        console.error('Error capturando coordenadas NAP:', error);
        btnCapturar.innerHTML = '<i class="fas fa-crosshairs"></i> Reintentar Captura de Coordenadas';
    } finally {
        btnCapturar.disabled = false;
    }
}

// Capturar coordenadas GPS para NAP con validación de precisión (7 intentos)
async function capturarCoordenadasGPSNap() {
    return new Promise((resolve, reject) => {
        // Verificar si el navegador soporta geolocalización
        if (!navigator.geolocation) {
            mostrarAlerta('Tu navegador no soporta geolocalización', 'danger');
            reject(null);
            return;
        }

        // Mostrar alerta de que se está obteniendo ubicación
        mostrarAlerta('📍 Obteniendo ubicación GPS... Por favor espera', 'info');

        const intentarCaptura = (intento = 1, maxIntentos = 7) => {
            console.log(`🗺️ [NAP GPS] Intento ${intento} de ${maxIntentos}...`);

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const accuracy = position.coords.accuracy;
                    const coords = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: accuracy
                    };

                    console.log(`📍 [NAP GPS] Coordenadas obtenidas - Precisión: ${accuracy.toFixed(2)} metros`);

                    // Si la precisión es buena (≤9m), retornar
                    if (accuracy <= 9) {
                        mostrarAlerta(`✅ Ubicación GPS capturada con precisión de ${accuracy.toFixed(2)} metros`, 'success');
                        resolve(coords);
                    } else if (intento < maxIntentos) {
                        mostrarAlerta(`⚠️ Precisión insuficiente (${accuracy.toFixed(2)}m). Intento ${intento}/${maxIntentos}. Reintentando...`, 'warning');
                        setTimeout(() => intentarCaptura(intento + 1, maxIntentos), 2000);
                    } else {
                        // En el último intento, retornar las coordenadas aunque no cumplan el requisito
                        // El usuario verá el alert de error y deberá reintentar manualmente
                        mostrarAlerta(`⚠️ Precisión obtenida: ${accuracy.toFixed(2)} metros después de 7 intentos. No se alcanzó la precisión requerida (≤9m). Intenta en un lugar con mejor señal GPS.`, 'danger');
                        resolve(coords);
                    }
                },
                (error) => {
                    console.error('Error obteniendo ubicación NAP:', error);
                    let mensaje = 'Error obteniendo ubicación GPS';

                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            mensaje = 'Permiso de ubicación denegado. Por favor, habilita la ubicación en tu navegador.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            mensaje = 'Ubicación no disponible. Verifica tu conexión GPS.';
                            break;
                        case error.TIMEOUT:
                            mensaje = 'Tiempo de espera agotado obteniendo ubicación.';
                            break;
                    }

                    if (intento < maxIntentos) {
                        mostrarAlerta(`${mensaje} Reintentando... (${intento}/${maxIntentos})`, 'warning');
                        setTimeout(() => intentarCaptura(intento + 1, maxIntentos), 2000);
                    } else {
                        mostrarAlerta(mensaje, 'danger');
                        reject(null);
                    }
                },
                {
                    enableHighAccuracy: true, // Solicitar alta precisión
                    timeout: 10000, // Timeout de 10 segundos
                    maximumAge: 0 // No usar caché
                }
            );
        };

        // Iniciar primer intento
        intentarCaptura();
    });
}

// Obtener ubicación mediante reverse geocoding
async function obtenerUbicacionPorCoordenadas(latitud, longitud) {
    try {
        console.log('🌍 [NAP] Iniciando reverse geocoding para:', latitud, longitud);

        const campoUbicacion = document.getElementById('ubicacionNap');

        // Usar Nominatim de OpenStreetMap para reverse geocoding
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitud}&lon=${longitud}&zoom=18&addressdetails=1`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'WhatsApp-Chatbot-NAP-System'
            }
        });

        if (!response.ok) {
            throw new Error('Error en la respuesta del servicio de geocoding');
        }

        const data = await response.json();

        if (data && data.display_name) {
            // Construir dirección más legible
            const address = data.address || {};
            let direccion = '';

            if (address.road) direccion += address.road;
            if (address.house_number) direccion += ' ' + address.house_number;
            if (address.neighbourhood) direccion += ', ' + address.neighbourhood;
            if (address.suburb) direccion += ', ' + address.suburb;
            if (address.city || address.town || address.village) {
                direccion += ', ' + (address.city || address.town || address.village);
            }
            if (address.state) direccion += ', ' + address.state;

            // Si no se pudo construir dirección, usar display_name
            if (!direccion.trim()) {
                direccion = data.display_name;
            }

            campoUbicacion.value = direccion;
            console.log('✅ [NAP] Ubicación obtenida:', direccion);
        } else {
            throw new Error('No se encontró información de ubicación');
        }
    } catch (error) {
        console.error('❌ [NAP] Error en reverse geocoding:', error);
        const campoUbicacion = document.getElementById('ubicacionNap');
        // Si falla el geocoding, usar coordenadas como ubicación
        campoUbicacion.value = `Lat: ${latitud.toFixed(6)}, Lng: ${longitud.toFixed(6)}`;
        console.log('⚠️ [NAP] Usando coordenadas como ubicación por fallo en geocoding');
    }
}

// 🔧 v1.74: Guardar nueva caja NAP (con soporte offline)
async function guardarNuevaNap() {
    const zona = document.getElementById('zonaNap').value;
    const puertos = document.getElementById('puertosNap').value;
    const ubicacion = document.getElementById('ubicacionNap').value.trim();
    const detalles = document.getElementById('detallesNap').value.trim();
    const latitud = document.getElementById('latitudNap').value;
    const longitud = document.getElementById('longitudNap').value;
    const precision = document.getElementById('precisionNap').value;

    // Validaciones
    if (!zona) {
        mostrarAlerta('Por favor selecciona una zona', 'warning');
        return;
    }

    if (!puertos || puertos < 8 || puertos > 16) {
        mostrarAlerta('Por favor selecciona un número válido de puertos (8-16)', 'warning');
        return;
    }

    if (!latitud || !longitud) {
        mostrarAlerta('Por favor toma las coordenadas GPS', 'warning');
        return;
    }

    // Validar precisión de coordenadas (debe ser ≤9m)
    if (!precision || parseFloat(precision) > 9) {
        mostrarAlerta('⚠️ Las coordenadas GPS deben tener una precisión de 9 metros o menor. Por favor, vuelve a tomar las coordenadas en un lugar con mejor señal GPS.', 'danger');
        return;
    }

    // La descripción se genera automáticamente en el backend con formato: Caja_[Zona]_[Consecutivo]
    // Ejemplo: Caja_Churido_001, Caja_Reposo_002, Caja_Rio_Grande_003

    try {
        const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');

        const napData = {
            zona,
            puertos: parseInt(puertos),
            ubicacion,
            detalles,
            latitud: parseFloat(latitud),
            longitud: parseFloat(longitud),
            precision: parseFloat(precision)
        };

        // 🆕 v1.74: Detectar si estamos offline
        if (!navigator.onLine || !window.offlineManager.isOnline) {
            console.log('📴 [NAP] Sin conexión, guardando offline');

            // Guardar en IndexedDB
            await window.offlineManager.guardarNapOffline(napData);

            mostrarAlerta('📴 Sin conexión. Caja NAP guardada localmente y se sincronizará automáticamente cuando haya internet.', 'info');
            bootstrap.Modal.getInstance(document.getElementById('modalNuevaNap')).hide();
            limpiarFormularioNap();
            return;
        }

        // 🟢 Online: Enviar directamente al servidor
        const response = await fetch(APP_CONFIG.getApiUrl('/api/cajas-nap'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(napData)
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('✅ Caja NAP creada exitosamente', 'success');
            bootstrap.Modal.getInstance(document.getElementById('modalNuevaNap')).hide();
            limpiarFormularioNap();
        } else {
            mostrarAlerta(resultado.message || 'Error creando caja NAP', 'danger');
        }
    } catch (error) {
        console.error('❌ [NAP] Error guardando caja NAP:', error);

        // Si falló la conexión, guardar offline como fallback
        try {
            const napData = {
                zona,
                puertos: parseInt(puertos),
                ubicacion,
                detalles,
                latitud: parseFloat(latitud),
                longitud: parseFloat(longitud),
                precision: parseFloat(precision)
            };

            await window.offlineManager.guardarNapOffline(napData);
            mostrarAlerta('📴 Error de conexión. Caja NAP guardada localmente y se sincronizará cuando haya internet.', 'warning');
            bootstrap.Modal.getInstance(document.getElementById('modalNuevaNap')).hide();
            limpiarFormularioNap();
        } catch (offlineError) {
            console.error('❌ [NAP] Error guardando offline:', offlineError);
            mostrarAlerta('Error guardando la caja NAP. Verifica tu conexión e intenta nuevamente.', 'danger');
        }
    }
}

// ===== FUNCIÓN PARA TOGGLE DE CAMBIO DE EQUIPO =====
function toggleCambioEquipo() {
    const checkbox = document.getElementById('checkboxCambioEquipo');
    const seccion = document.getElementById('seccionCambioEquipo');

    if (checkbox && checkbox.checked) {
        seccion.classList.remove('d-none');
    } else {
        seccion.classList.add('d-none');
        // Limpiar serial si se desmarca
        window.serialEquipoCapturado = null;
        const infoDiv = document.getElementById('serialCapturadoInfo');
        if (infoDiv) {
            infoDiv.innerHTML = '';
        }
    }
}

// Agregar función global
window.toggleCambioEquipo = toggleCambioEquipo;

// ===== FUNCIÓN PARA ASIGNAR EQUIPO AL COMPLETAR VISITA =====
async function asignarEquipoAlCompletar(visitaId, serialEquipo, costoEquipo = 180000, tipoEquipo = 'Onu CData') {
    try {
        console.log(`📦 [ASIGNAR EQUIPO] Enviando petición para visita ${visitaId}, serial: ${serialEquipo}, tipo: ${tipoEquipo}`);

        const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');

        const response = await fetch(APP_CONFIG.getApiUrl('/api/asignar-equipo'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                visitaId: visitaId,
                serialEquipo: serialEquipo,
                costoEquipo: costoEquipo,
                tipoEquipo: tipoEquipo
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            console.log(`✅ [ASIGNAR EQUIPO] Equipo asignado exitosamente: ${resultado.message}`);
        } else {
            console.error(`❌ [ASIGNAR EQUIPO] Error: ${resultado.message}`);
        }

        return resultado;

    } catch (error) {
        console.error('❌ [ASIGNAR EQUIPO] Error de conexión:', error);
        return {
            success: false,
            message: `Error de conexión al asignar equipo: ${error.message}`
        };
    }
}

// 🔔 FIX v1.53: Función para mostrar notificaciones de descarga (Web o Nativa)
async function mostrarNotificacionDescarga(nombreArchivo, fileUri, fileName = null) {
    try {
        console.log('🔔 [NOTIFICACIÓN] Intentando mostrar notificación de descarga...');
        console.log('🔔 [NOTIFICACIÓN] FileURI:', fileUri);
        console.log('🔔 [NOTIFICACIÓN] FileName:', fileName);

        // Opción 1: Capacitor LocalNotifications (APK nativa)
        if (window.Capacitor?.Plugins?.LocalNotifications) {
            console.log('📱 [NOTIFICACIÓN] Usando LocalNotifications de Capacitor...');
            const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;

            // 🔧 v1.75.5: Verificar permisos (pero NO solicitar aquí - ya lo hace notifications-manager)
            const permResult = await LocalNotifications.checkPermissions();
            if (permResult.display !== 'granted') {
                console.warn('⚠️ [NOTIFICACIÓN] Permisos de notificaciones no concedidos - no se mostrará notificación');
                // NO solicitar aquí - ya lo hace notifications-manager.js con delay apropiado
                // Si el usuario no ha concedido permisos aún, simplemente no mostramos notificación
            }

            // Crear canal de notificaciones (requerido Android 8+)
            try {
                await LocalNotifications.createChannel({
                    id: 'downloads',
                    name: 'Descargas',
                    description: 'Notificaciones de descargas de archivos',
                    importance: 4, // High importance
                    visibility: 1, // Public
                    sound: 'default.wav',
                    vibration: true
                });
                console.log('✅ [NOTIFICACIÓN] Canal creado/verificado');
            } catch (channelError) {
                console.warn('⚠️ [NOTIFICACIÓN] Canal ya existe o error:', channelError.message);
            }

            // Generar ID válido para Java int (max 2147483647)
            const notificationId = Math.floor(Date.now() % 2147483647);
            console.log(`📱 [NOTIFICACIÓN] ID generado: ${notificationId}`);

            // Crear notificación INMEDIATA (sin schedule) con fileUri en extras
            await LocalNotifications.schedule({
                notifications: [{
                    title: '📄 PDF Descargado',
                    body: `${nombreArchivo} - Toca para abrir`,
                    id: notificationId,
                    // NO incluir 'schedule' para notificación inmediata
                    sound: 'default.wav',
                    channelId: 'downloads',
                    extra: {
                        action: 'open_pdf',
                        fileUri: fileUri,  // URI completo del archivo
                        fileName: fileName || nombreArchivo  // Nombre del archivo
                    }
                }]
            });
            console.log('✅ [NOTIFICACIÓN] Notificación nativa mostrada con URI:', fileUri);
            return;
        }

        // Opción 2: Web Notifications API (Navegador móvil/desktop)
        if ('Notification' in window) {
            console.log('🌐 [NOTIFICACIÓN] Usando Web Notifications API...');

            // Verificar permisos
            let permission = Notification.permission;

            if (permission === 'default') {
                console.log('🔔 [NOTIFICACIÓN] Solicitando permisos...');
                permission = await Notification.requestPermission();
            }

            if (permission === 'granted') {
                // Crear notificación web
                const notificacion = new Notification('📄 PDF Descargado', {
                    body: `${nombreArchivo}\nArchivo guardado en Documentos`,
                    icon: '/favicon.ico',
                    badge: '/favicon.ico',
                    tag: 'pdf-download',
                    requireInteraction: false,
                    silent: false,
                    vibrate: [200, 100, 200]
                });

                // Click handler para abrir el archivo
                notificacion.onclick = function() {
                    console.log('🔔 [NOTIFICACIÓN] Usuario hizo clic en notificación');
                    window.focus();
                    notificacion.close();
                };

                // Auto-cerrar después de 5 segundos
                setTimeout(() => notificacion.close(), 5000);

                console.log('✅ [NOTIFICACIÓN] Notificación web mostrada');
            } else {
                console.warn('⚠️ [NOTIFICACIÓN] Permisos denegados:', permission);
            }
            return;
        }

        console.warn('⚠️ [NOTIFICACIÓN] No hay soporte para notificaciones en este dispositivo');

    } catch (notifError) {
        console.error('❌ [NOTIFICACIÓN] Error mostrando notificación:', notifError);
        console.error('❌ [NOTIFICACIÓN] Stack:', notifError.stack);
    }
}

// 🔧 FIX v1.52: Función para descargar y abrir PDFs en app nativa (CON PERMISOS)
async function abrirPdfEnApp(blobUrl, nombreArchivo) {
    try {
        console.log(`📄 [ABRIR PDF] Intentando abrir: ${nombreArchivo}`);
        console.log(`📄 [ABRIR PDF] URL: ${blobUrl}`);
        console.log(`📄 [ABRIR PDF] Es app nativa: ${APP_CONFIG.isNative()}`);

        if (APP_CONFIG.isNative() && window.Capacitor) {
            // 1. SOLICITAR PERMISOS DE ALMACENAMIENTO
            console.log('🔐 [ABRIR PDF] Verificando permisos de almacenamiento...');

            const Filesystem = window.Capacitor.Plugins.Filesystem;

            // Solicitar permisos usando Capacitor Permissions
            try {
                if (window.Capacitor.Plugins.Permissions) {
                    const permissions = window.Capacitor.Plugins.Permissions;

                    // Verificar estado actual
                    const checkResult = await permissions.query({ name: 'storage' });
                    console.log(`🔐 [PERMISOS] Estado actual: ${checkResult.state}`);

                    if (checkResult.state !== 'granted') {
                        console.log('🔐 [PERMISOS] Solicitando permisos al usuario...');
                        const requestResult = await permissions.request({ name: 'storage' });
                        console.log(`🔐 [PERMISOS] Resultado: ${requestResult.state}`);

                        if (requestResult.state !== 'granted') {
                            throw new Error('Se requieren permisos de almacenamiento para descargar PDFs.\n\nPor favor ve a Configuración → Aplicaciones → SolucNet Técnicos → Permisos y habilita "Archivos y multimedia".');
                        }
                    }

                    console.log('✅ [PERMISOS] Permisos de almacenamiento concedidos');
                } else {
                    console.warn('⚠️ [PERMISOS] Permissions API no disponible, intentando sin verificación...');
                }
            } catch (permError) {
                console.error('❌ [PERMISOS] Error verificando permisos:', permError);
                // Continuar de todos modos, Filesystem puede tener sus propios permisos
            }

            // 2. Verificar permisos de Filesystem directamente
            try {
                if (Filesystem.checkPermissions) {
                    const fsPerms = await Filesystem.checkPermissions();
                    console.log(`🔐 [FILESYSTEM] Permisos actuales:`, fsPerms);

                    if (fsPerms.publicStorage !== 'granted') {
                        console.log('🔐 [FILESYSTEM] Solicitando permisos...');
                        const requestFs = await Filesystem.requestPermissions();
                        console.log(`🔐 [FILESYSTEM] Permisos solicitados:`, requestFs);

                        if (requestFs.publicStorage !== 'granted') {
                            throw new Error('Permisos de almacenamiento denegados.\n\nPara descargar PDFs, ve a:\nConfiguraci\u00f3n → Aplicaciones → SolucNet T\u00e9cnicos → Permisos → Archivos y multimedia → Permitir');
                        }
                    }
                    console.log('✅ [FILESYSTEM] Permisos verificados correctamente');
                }
            } catch (fsPermError) {
                console.warn('⚠️ [FILESYSTEM] No se pudieron verificar permisos, intentando de todos modos:', fsPermError.message);
            }

            // 3. DESCARGAR al almacenamiento y abrir con app externa
            console.log('📱 [ABRIR PDF] Descargando PDF al almacenamiento del teléfono...');

            // Obtener Blob desde blob URL
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            console.log(`📄 [ABRIR PDF] Blob obtenido: ${blob.size} bytes, tipo: ${blob.type}`);

            // Convertir Blob a base64
            const reader = new FileReader();
            const base64Data = await new Promise((resolve, reject) => {
                reader.onloadend = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            console.log(`📄 [ABRIR PDF] Convertido a base64: ${base64Data.length} caracteres`);

            // 4. Guardar en almacenamiento (usando string 'DOCUMENTS' directamente)
            const fileName = `solucnet_${Date.now()}_${nombreArchivo}`;
            console.log('📄 [ABRIR PDF] Guardando en almacenamiento...');
            await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: 'DOCUMENTS',  // String directo en lugar de Directory.Documents
                recursive: true
            });
            console.log(`✅ [ABRIR PDF] PDF guardado en Documents: ${fileName}`);

            // 5. Obtener URI del archivo
            const fileUri = await Filesystem.getUri({
                path: fileName,
                directory: 'DOCUMENTS'
            });
            console.log(`📄 [ABRIR PDF] URI del archivo: ${fileUri.uri}`);

            // 6. Mostrar notificación de descarga completa (pasando ruta completa)
            await mostrarNotificacionDescarga(nombreArchivo, fileUri.uri, fileName);

            // 7. Intentar abrir con FileOpener inmediatamente después de descargar
            console.log('📱 [ABRIR PDF] Intentando abrir con FileOpener...');
            console.log('📱 [ABRIR PDF] URI:', fileUri.uri);
            console.log('📱 [ABRIR PDF] FileName:', fileName);

            try {
                // Usar el URI completo que devuelve Capacitor Filesystem
                await abrirPDFConFileOpener(fileUri.uri);
                console.log('✅ [ABRIR PDF] PDF abierto exitosamente con FileOpener');
            } catch (openError) {
                console.error('❌ [ABRIR PDF] Error abriendo con FileOpener:', openError);

                // Fallback: Intentar compartir
                if (window.Capacitor.Plugins.Share) {
                    console.log('📱 [ABRIR PDF] Intentando compartir como alternativa...');
                    await window.Capacitor.Plugins.Share.share({
                        title: nombreArchivo,
                        text: 'Abrir PDF',
                        url: fileUri.uri,
                        dialogTitle: 'Abrir PDF con...'
                    });
                } else {
                    alert(`PDF descargado en Documentos:\n${fileName}\n\nNo se pudo abrir automáticamente. Búscalo en tu carpeta de Documentos.`);
                }
            }
        } else {
            // En web, mostrar notificación y abrir en nueva pestaña
            console.log('🌐 [ABRIR PDF] Abriendo en navegador web...');

            // Mostrar notificación web
            await mostrarNotificacionDescarga(nombreArchivo, blobUrl);

            const nuevaVentana = window.open(blobUrl, '_blank');
            if (!nuevaVentana) {
                throw new Error('No se pudo abrir el PDF. Tu navegador puede estar bloqueando ventanas emergentes.');
            }
            console.log('✅ [ABRIR PDF] PDF abierto en nueva pestaña');
        }
    } catch (error) {
        console.error('❌ [ABRIR PDF] Error:', error);
        console.error('❌ [ABRIR PDF] Stack:', error.stack);
        alert(`Error al abrir PDF: ${error.message}\n\nPor favor verifica que tienes permisos de almacenamiento habilitados.`);
    }
}

// 🔧 FIX v1.57: Función para abrir PDF con FileOpener plugin
async function abrirPDFConFileOpener(fileUri) {
    console.log('📱 [FILE OPENER] Intentando abrir PDF:', fileUri);

    // Verificar que FileOpener esté disponible
    if (!window.Capacitor || !window.Capacitor.Plugins) {
        throw new Error('Capacitor no está disponible');
    }

    // Importar FileOpener dinámicamente
    const { FileOpener } = window.Capacitor.Plugins;

    if (!FileOpener) {
        throw new Error('Plugin FileOpener no está disponible');
    }

    try {
        // Abrir el archivo con la aplicación predeterminada
        await FileOpener.open({
            filePath: fileUri,
            contentType: 'application/pdf'
        });
        console.log('✅ [FILE OPENER] PDF abierto correctamente');
    } catch (error) {
        console.error('❌ [FILE OPENER] Error:', error);
        throw error;
    }
}

// ==============================================
// 🔧 v1.67: FUNCIONES DE MAPAS OFFLINE
// ==============================================

// Estado del selector de área offline
let offlineMapSelectorActivo = false;

/**
 * Inicializar sistema de mapas offline
 */
async function inicializarSistemaMapasOffline() {
    try {
        if (window.offlineMapsManager) {
            await window.offlineMapsManager.init();
            console.log('✅ [OFFLINE MAPS] Sistema inicializado');
        }
    } catch (error) {
        console.error('❌ [OFFLINE MAPS] Error inicializando:', error);
    }
}

/**
 * Activar/desactivar selector de área para descarga offline
 */
function toggleMapaOfflineSelector() {
    if (!mapaClientes) {
        alert('El mapa no está inicializado. Por favor abre el mapa primero.');
        return;
    }

    if (!window.offlineMapsManager) {
        alert('Sistema de mapas offline no disponible');
        return;
    }

    const btnOffline = document.getElementById('btnMapaOffline');
    const areaInfo = document.getElementById('areaSeleccionInfo');

    if (!offlineMapSelectorActivo) {
        // ACTIVAR SELECTOR
        console.log('🟢 [OFFLINE MAPS] Activando selector de área...');

        window.offlineMapsManager.activateAreaSelector(mapaClientes, (info) => {
            // Actualizar UI con info del área en tiempo real
            document.getElementById('areaTiles').textContent = info.totalTiles;
            document.getElementById('areaTamano').textContent = info.estimatedSizeMB;
        });

        // Cambiar UI
        btnOffline.innerHTML = '<i class="fas fa-times"></i> Cancelar';
        btnOffline.classList.remove('btn-primary');
        btnOffline.classList.add('btn-danger');
        areaInfo.style.display = 'block';

        // Mostrar botón de descarga
        const botonesFooter = btnOffline.parentElement;
        const btnDescargar = document.createElement('button');
        btnDescargar.id = 'btnDescargarArea';
        btnDescargar.className = 'btn btn-success';
        btnDescargar.innerHTML = '<i class="fas fa-download"></i> Descargar Área';
        btnDescargar.onclick = iniciarDescargaMapaOffline;
        botonesFooter.insertBefore(btnDescargar, btnOffline);

        offlineMapSelectorActivo = true;
    } else {
        // DESACTIVAR SELECTOR
        console.log('🔴 [OFFLINE MAPS] Desactivando selector...');

        window.offlineMapsManager.deactivateAreaSelector(mapaClientes);

        // Restaurar UI
        btnOffline.innerHTML = '<i class="fas fa-download"></i> Modo Offline';
        btnOffline.classList.remove('btn-danger');
        btnOffline.classList.add('btn-primary');
        areaInfo.style.display = 'none';

        // Remover botón de descarga
        const btnDescargar = document.getElementById('btnDescargarArea');
        if (btnDescargar) {
            btnDescargar.remove();
        }

        offlineMapSelectorActivo = false;
    }
}

/**
 * Iniciar descarga del área seleccionada
 */
async function iniciarDescargaMapaOffline() {
    if (!window.offlineMapsManager || !window.offlineMapsManager.selectedBounds) {
        alert('Por favor selecciona un área en el mapa primero');
        return;
    }

    const info = window.offlineMapsManager.calculateAreaInfo(window.offlineMapsManager.selectedBounds);

    const confirmacion = confirm(
        `¿Descargar ${info.totalTiles} tiles del mapa?\n\n` +
        `Tamaño estimado: ${info.estimatedSizeMB} MB\n` +
        `Niveles de zoom: ${info.zoomLevels}\n\n` +
        `La descarga puede tardar varios minutos.`
    );

    if (!confirmacion) {
        return;
    }

    // Ocultar botones y mostrar progreso
    document.getElementById('areaSeleccionInfo').style.display = 'none';
    document.getElementById('descargaOfflineProgress').style.display = 'block';
    document.getElementById('btnDescargarArea').disabled = true;
    document.getElementById('btnMapaOffline').disabled = true;

    try {
        console.log('🚀 [OFFLINE MAPS] Iniciando descarga...');

        const resultado = await window.offlineMapsManager.downloadAllTiles((progress) => {
            // Actualizar barra de progreso
            const progressBar = document.getElementById('descargaOfflineProgressBar');
            const progressText = document.getElementById('descargaOfflineProgressText');
            const progressStats = document.getElementById('descargaOfflineStats');

            progressBar.style.width = progress.percentage + '%';
            progressText.textContent = progress.percentage + '%';
            progressStats.textContent = `${progress.downloaded}/${progress.total} tiles descargados (${progress.failed} fallidos) - Zoom ${progress.currentZoom}`;

            console.log(`📊 [OFFLINE MAPS] Progreso: ${progress.percentage}% (${progress.downloaded}/${progress.total})`);
        });

        // Descarga completada
        console.log('✅ [OFFLINE MAPS] Descarga completada:', resultado);

        alert(
            `¡Descarga completada!\n\n` +
            `Tiles descargados: ${resultado.downloaded}\n` +
            `Fallidos: ${resultado.failed}\n` +
            `Tiempo: ${resultado.duration}s\n\n` +
            `El mapa ya está disponible en modo offline.`
        );

        // Desactivar selector
        toggleMapaOfflineSelector();

    } catch (error) {
        console.error('❌ [OFFLINE MAPS] Error en descarga:', error);
        alert(`Error descargando mapa: ${error.message}`);
    } finally {
        // Restaurar UI
        document.getElementById('descargaOfflineProgress').style.display = 'none';
        document.getElementById('btnDescargarArea').disabled = false;
        document.getElementById('btnMapaOffline').disabled = false;
    }
}

// Inicializar mapas offline al cargar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarSistemaMapasOffline);
} else {
    inicializarSistemaMapasOffline();
}

// 🧪 v1.72: Función de validación de filtrado de visitas completadas
window.validarFiltradoCompletadas = async function() {
    console.log('🧪 [VALIDACIÓN] Iniciando validación del sistema de filtrado...');

    try {
        // 1. Verificar que offlineManager esté disponible
        if (!window.offlineManager) {
            console.error('❌ [VALIDACIÓN] offlineManager no está disponible');
            return false;
        }

        // 2. Obtener visitas completadas
        const completadas = await window.offlineManager.obtenerVisitasCompletadas();
        console.log(`✅ [VALIDACIÓN] ${completadas.length} visitas en historial de completadas`);

        // 3. Verificar que sean números
        const todosNumeros = completadas.every(id => typeof id === 'number');
        console.log(`${todosNumeros ? '✅' : '❌'} [VALIDACIÓN] Todos los IDs son números: ${todosNumeros}`);

        // 4. Verificar que no haya duplicados
        const unicos = new Set(completadas);
        const sinDuplicados = unicos.size === completadas.length;
        console.log(`${sinDuplicados ? '✅' : '❌'} [VALIDACIÓN] Sin duplicados: ${sinDuplicados} (${unicos.size} únicos de ${completadas.length})`);

        // 5. Simular filtrado con visitas de prueba
        const visitasPrueba = [
            { id: 446, estado: 'asignada' },
            { id: 447, estado: 'asignada' },
            { id: 448, estado: 'asignada' },
            { id: 449, estado: 'asignada' },
            { id: 450, estado: 'asignada' }
        ];

        const completadasSet = new Set(completadas);
        const filtradas = visitasPrueba.filter(v => {
            const visitaIdNum = typeof v.id === 'string' ? parseInt(v.id, 10) : v.id;
            return !completadasSet.has(visitaIdNum) && v.estado !== 'completada';
        });

        console.log(`📊 [VALIDACIÓN] Simulación de filtrado:`);
        console.log(`   - Visitas totales: ${visitasPrueba.length}`);
        console.log(`   - Visitas después de filtrar: ${filtradas.length}`);
        console.log(`   - Visitas excluidas: ${visitasPrueba.length - filtradas.length}`);

        const excluidas = visitasPrueba.filter(v => !filtradas.includes(v));
        if (excluidas.length > 0) {
            console.log(`   - IDs excluidos: [${excluidas.map(v => v.id).join(', ')}]`);
        }

        // 6. Resultado final
        const exito = todosNumeros && sinDuplicados;
        console.log(`${exito ? '✅' : '❌'} [VALIDACIÓN] Sistema de filtrado: ${exito ? 'FUNCIONANDO CORRECTAMENTE' : 'CON ERRORES'}`);

        return exito;
    } catch (error) {
        console.error('❌ [VALIDACIÓN] Error durante validación:', error);
        return false;
    }
};

console.log('✅ [VALIDACIÓN] Función de validación cargada. Ejecuta en consola: validarFiltradoCompletadas()');

// Agregar funciones globales
window.asignarEquipoAlCompletar = asignarEquipoAlCompletar;
window.abrirPdfEnApp = abrirPdfEnApp;
window.abrirPDFConFileOpener = abrirPDFConFileOpener;
window.toggleMapaOfflineSelector = toggleMapaOfflineSelector;
window.iniciarDescargaMapaOffline = iniciarDescargaMapaOffline;

// 🆕 v1.76: Conectar WebSocket para actualizaciones en tiempo real
(async function conectarWebSocket() {
    try {
        // Esperar a que Cordova esté listo (si es APK)
        if (typeof cordova !== 'undefined') {
            await new Promise(resolve => {
                document.addEventListener('deviceready', resolve, false);
            });
        }

        // Obtener ID del técnico desde localStorage
        const userTecnico = localStorage.getItem('user_tecnico');
        if (!userTecnico) {
            console.warn('⚠️ [WEBSOCKET] No hay usuario técnico en localStorage');
            return;
        }

        const tecnico = JSON.parse(userTecnico);
        const tecnicoId = tecnico.id;

        if (!tecnicoId) {
            console.warn('⚠️ [WEBSOCKET] No se pudo obtener ID del técnico');
            return;
        }

        console.log(`🔌 [WEBSOCKET] Conectando para técnico ID: ${tecnicoId}...`);

        // Conectar al servidor WebSocket
        if (window.websocketClient) {
            await window.websocketClient.connect(tecnicoId);
        } else {
            console.warn('⚠️ [WEBSOCKET] Cliente WebSocket no disponible');
        }
    } catch (error) {
        console.error('❌ [WEBSOCKET] Error conectando:', error);
    }
})();

// 🆕 v1.79: Solicitar permisos SECUENCIALMENTE al abrir la app
(async function solicitarPermisos() {
    try {
        // Esperar a que Cordova esté listo (si es APK)
        if (typeof cordova !== 'undefined') {
            await new Promise(resolve => {
                document.addEventListener('deviceready', resolve, false);
            });
        }

        // Esperar 3 segundos después de que la app inicie
        // para que el usuario vea la interfaz primero
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('🔐 [PERMISOS] Iniciando solicitud de permisos...');

        // Verificar si ya se solicitaron antes
        if (window.permissionsManager && !window.permissionsManager.yaSeSolicitaron()) {
            console.log('🔐 [PERMISOS] Primera vez - solicitando todos los permisos');
            const resultado = await window.permissionsManager.solicitarTodosLosPermisos();
            console.log('🔐 [PERMISOS] Resultado:', resultado);
        } else {
            console.log('✅ [PERMISOS] Ya se solicitaron anteriormente');
            // Aunque ya se solicitaron, habilitar background mode si está disponible
            if (window.backgroundModeManager && !window.backgroundModeManager.isEnabled) {
                try {
                    await window.backgroundModeManager.enableManually();
                } catch (e) {
                    console.error('❌ [BACKGROUND] Error habilitando:', e);
                }
            }
        }

    } catch (error) {
        console.error('❌ [PERMISOS] Error solicitando permisos:', error);
    }
})();