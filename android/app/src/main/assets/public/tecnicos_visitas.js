// Variables globales
let visitasAsignadas = [];
let visitasSinFiltrar = []; // Copia sin filtrar para los filtros
let tecnicoActual = null;
let fotosSeleccionadas = [];
let intervaloActualizacion = null; // Intervalo para actualización automática
let ultimaActualizacion = null; // Timestamp de última actualización
let hashVisitasAnterior = null; // Hash para detectar cambios

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
        // Limpiar datos de sesión del técnico
        localStorage.removeItem('token_tecnico');
        localStorage.removeItem('user_tecnico');
        localStorage.removeItem('remember_tecnico');
        sessionStorage.removeItem('user_tecnico');
        // Redirigir al login de técnicos
        window.location.href = '/login_tecnicos.html';
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

// Cargar visitas asignadas al técnico
async function cargarVisitasTecnico(mostrarSpinner = true) {
    try {
        const token = localStorage.getItem('token_tecnico');
        if (!token) {
            window.location.href = '/login_tecnicos.html';
            return;
        }

        // Solo mostrar spinner en la primera carga
        if (mostrarSpinner && visitasAsignadas.length === 0) {
            visitasContainer.innerHTML = `
                <div class="text-center">
                    <div class="spinner-border text-success" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                    <p class="mt-2 text-muted">Cargando visitas asignadas...</p>
                </div>
            `;
        }

        const response = await fetch('/api/mis-visitas', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-cache' // Evitar caché del navegador
        });

        const resultado = await response.json();

        if (!response.ok || !resultado.success) {
            // Token inválido o error de autorización
            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('token_tecnico');
                localStorage.removeItem('user_tecnico');
                localStorage.removeItem('remember_tecnico');
                window.location.href = '/login_tecnicos.html';
                return;
            }
            throw new Error(resultado.message || 'Error cargando visitas');
        }

        // Actualizar información del técnico en la interfaz
        if (resultado.tecnico) {
            tecnicoActual = resultado.tecnico;
            nombreTecnico.textContent = resultado.tecnico.nombre;
        }

        // Calcular hash de los datos nuevos
        const hashNuevo = hashSimple(resultado.visitas);

        // Solo actualizar si los datos han cambiado
        if (hashNuevo !== hashVisitasAnterior || visitasAsignadas.length === 0) {
            console.log('✅ Datos actualizados detectados, recargando vista');

            visitasAsignadas = resultado.visitas;
            visitasSinFiltrar = [...resultado.visitas]; // Copia para filtros
            llenarFiltroLocalidades();
            mostrarVisitasAsignadas();

            // Restaurar cronómetros activos después de mostrar las visitas
            setTimeout(restaurarCronometros, 100);

            // Guardar el hash para la próxima comparación
            hashVisitasAnterior = hashNuevo;
        } else {
            console.log('⏭️ Sin cambios en los datos, omitiendo recarga');
        }

        // Actualizar timestamp e indicador visual
        ultimaActualizacion = Date.now();
        actualizarIndicadorActualizacion();

    } catch (error) {
        console.error('Error cargando visitas:', error);
        if (visitasAsignadas.length === 0) {
            visitasContainer.innerHTML = '<div class="alert alert-danger">Error cargando visitas asignadas</div>';
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

        const response = await fetch(`/api/visitas-tecnicas/${visitaId}/iniciar`, {
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
        mostrarAlerta('Error iniciando la visita', 'danger');
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

        const formData = {
            visita_id: visitaId,
            tecnico_id: document.getElementById('tecnicoId').value,
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

            if (coordenadasCapturadas.accuracy > 9) {
                mostrarAlerta(`❌ ERROR DE COORDENADAS: La precisión actual es de ${coordenadasCapturadas.accuracy.toFixed(2)} metros. Se requiere una precisión de 9 metros o menor para completar la visita. Por favor, intenta capturar las coordenadas nuevamente en un lugar con mejor señal GPS.`, 'danger');
                return;
            }

            // Agregar coordenadas al reporte
            formData.latitud = coordenadasCapturadas.latitude;
            formData.longitud = coordenadasCapturadas.longitude;
            formData.precision_gps = coordenadasCapturadas.accuracy;
            console.log('✅ Coordenadas validadas y agregadas al reporte:', coordenadasCapturadas);
        }

        // Enviar reporte
        const response = await fetch('/api/reportes-visitas', {
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

            // Remover la visita de la lista local
            visitasAsignadas = visitasAsignadas.filter(v => v.id != formData.visita_id);
            mostrarVisitasAsignadas();

            // Cerrar modal
            bootstrap.Modal.getInstance(document.getElementById('modalCompletarVisita')).hide();

        } else {
            mostrarAlerta(resultado.message || 'Error guardando el reporte', 'danger');
        }

    } catch (error) {
        console.error('Error guardando reporte:', error);
        mostrarAlerta('Error guardando el reporte de visita', 'danger');
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

        const response = await fetch('/api/reportes-fotos', {
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
                estadoPrecision.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle"></i> <strong>Precisión insuficiente:</strong> ${coordenadas.accuracy.toFixed(2)} metros. Se requiere 9 metros o menos. Por favor, intenta nuevamente en un lugar con mejor señal GPS.
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

        const response = await fetch(`/api/visitas/${visitaId}/archivos-pdf`);
        const resultado = await response.json();

        if (resultado.success && resultado.archivos.length > 0) {
            const listaHtml = resultado.archivos.map(archivo => `
                <div class="d-flex justify-content-between align-items-center py-1 px-2 bg-light rounded mb-2">
                    <div>
                        <i class="fas fa-file-pdf text-danger me-2"></i>
                        <span class="small">${archivo.nombre_original}</span>
                        <small class="text-muted ms-2">(${(archivo.tamaño / 1024).toFixed(1)} KB)</small>
                    </div>
                    <a href="/uploads/pdfs_visitas/${archivo.nombre_archivo}"
                       target="_blank"
                       class="btn btn-sm btn-outline-primary">
                        <i class="fas fa-download"></i>
                    </a>
                </div>
            `).join('');

            document.getElementById(`lista-pdfs-${visitaId}`).innerHTML = listaHtml;
        } else {
            document.getElementById(`lista-pdfs-${visitaId}`).innerHTML =
                '<p class="text-muted small">No hay archivos adjuntos para esta visita</p>';
        }

        // Restaurar botón
        iconoBoton.className = 'fas fa-sync';
        botonActualizar.disabled = false;

    } catch (error) {
        console.error('Error cargando PDFs:', error);
        document.getElementById(`lista-pdfs-${visitaId}`).innerHTML =
            '<p class="text-danger small">Error cargando archivos</p>';

        // Restaurar botón
        const botonActualizar = document.querySelector(`#pdfs-visita-${visitaId} button`);
        const iconoBoton = botonActualizar.querySelector('i');
        iconoBoton.className = 'fas fa-sync';
        botonActualizar.disabled = false;

        mostrarAlerta('Error cargando archivos PDF', 'danger');
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
        const response = await fetch('/api/notificar-llegada-cliente', {
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
        const response = await fetch('/api/cancelar-visita-sin-contacto', {
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

    // Configurar actualización cada 10 segundos (10000 ms)
    intervaloActualizacion = setInterval(async () => {
        console.log('🔄 Actualizando visitas automáticamente...');
        await cargarVisitasTecnico(false); // No mostrar spinner en actualizaciones automáticas
    }, 10000);

    console.log('✅ Actualización automática iniciada (cada 10 segundos)');
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

                console.log('📍 [CLIENTE] Enviando ubicación al servidor...');

                // Enviar ubicación al servidor
                const response = await fetch('/api/tecnicos/ubicacion', {
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

        // Obtener ubicaciones de clientes desde el servidor
        const response = await fetch('/api/ubicaciones-clientes-asignados', {
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

        const ubicaciones = data.ubicaciones || [];
        console.log(`📍 ${ubicaciones.length} ubicaciones de clientes cargadas`);

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

        const token = localStorage.getItem('token_tecnico') || sessionStorage.getItem('token_tecnico');
        console.log('🔍 [NAP] Token encontrado:', token ? 'Sí' : 'No');

        const response = await fetch('/api/usuario-actual', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const resultado = await response.json();
        console.log('🔍 [NAP] Respuesta del servidor:', resultado);
        console.log('🔍 [NAP] puede_agregar_naps:', resultado.usuario?.puede_agregar_naps);
        console.log('🔍 [NAP] Tipo de puede_agregar_naps:', typeof resultado.usuario?.puede_agregar_naps);

        if (resultado.success && resultado.usuario.puede_agregar_naps === 1) {
            const btnNap = document.getElementById('btnNuevaNap');
            console.log('🔍 [NAP] Botón encontrado:', btnNap ? 'Sí' : 'No');

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

// Guardar nueva caja NAP
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

        const response = await fetch('/api/cajas-nap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                zona,
                puertos: parseInt(puertos),
                ubicacion,
                detalles,
                latitud: parseFloat(latitud),
                longitud: parseFloat(longitud),
                precision: parseFloat(precision)
            })
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
        console.error('Error guardando caja NAP:', error);
        mostrarAlerta('Error de conexión al guardar la caja NAP', 'danger');
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

        const response = await fetch('/api/asignar-equipo', {
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

// Agregar función global
window.asignarEquipoAlCompletar = asignarEquipoAlCompletar;