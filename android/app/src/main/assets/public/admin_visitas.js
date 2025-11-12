// Variables globales - Actualizado 2025-09-28 00:27 BOTÓN DESASIGNAR TÉCNICO
console.log('🔄 Admin Visitas JS cargado - BOTÓN DESASIGNAR TÉCNICO AGREGADO');

// DATOS DE PRUEBA COMO FALLBACK (se cargarán datos reales desde BD)
let visitasProgramadas = [
    {
        id: 1,
        cliente_nombre: 'VICTOR ALFONOZ SUAREZ',
        cliente_cedula: '12345678',
        cliente_telefono: '3001234567',
        cliente_movil: '3001234567',
        cliente_direccion: 'Calle 123 #45-67',
        fecha_programada: '2025-01-15',
        motivo_visita: 'Instalación de servicio completo',
        notas_admin: 'Cliente nuevo, primera instalación',
        estado: 'programada',
        mikrotik_nombre: 'Server_Principal',
        usuario_ppp: 'victor.alfonoz',
        seleccionada: false
    },
    {
        id: 2,
        cliente_nombre: 'MARIA RODRIGUEZ LOPEZ',
        cliente_cedula: '87654321',
        cliente_telefono: '3009876543',
        fecha_programada: '2025-01-16',
        motivo_visita: 'Reparación de equipo averiado',
        notas_admin: 'Problema con conectividad - revisar cables',
        estado: 'asignada',
        mikrotik_nombre: 'Server_Zona2',
        usuario_ppp: 'maria.rodriguez',
        seleccionada: false
    },
    {
        id: 3,
        cliente_nombre: 'CARLOS MENDEZ TORRES',
        cliente_cedula: '11223344',
        cliente_telefono: '3005556789',
        fecha_programada: '2025-01-17',
        motivo_visita: 'Cambio de plan de servicio',
        notas_admin: 'Upgrade a plan premium',
        estado: 'programada',
        mikrotik_nombre: 'Server_Norte',
        usuario_ppp: 'carlos.mendez',
        seleccionada: false
    }
];

let clientesSeleccionados = [];
let tecnicosDisponibles = [];

console.log('✅ Datos de prueba pre-cargados:', visitasProgramadas.length, 'visitas');

// Función helper para formatear fechas sin problemas de zona horaria
function formatearFechaLocal(fechaISO) {
    if (!fechaISO) return '';
    const [año, mes, dia] = fechaISO.split('T')[0].split('-');
    return `${dia}/${mes}/${año}`;
}

// Variables para ordenamiento de tabla
let ordenActual = {
    columna: null,
    direccion: 'asc' // 'asc' o 'desc'
};

// Elementos del DOM
const inputBusqueda = document.getElementById('inputBusqueda');
const resultadosBusqueda = document.getElementById('resultadosBusqueda');
const searchSpinner = document.getElementById('searchSpinner');
const tablaVisitas = document.getElementById('tablaVisitas');
const btnEnviarNotificaciones = document.getElementById('btnEnviarNotificaciones');
const btnAsignarMasivo = document.getElementById('btnAsignarMasivo');
const btnCambioFechaMasivo = document.getElementById('btnCambioFechaMasivo');
const btnDesasignarMasivo = document.getElementById('btnDesasignarMasivo');

// Configuración de búsqueda con debounce
let timeoutBusqueda;
const DEBOUNCE_DELAY = 500;

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 DOM cargado - Forzando carga de tabla inmediatamente');

    // CARGAR DATOS REALES AL INICIALIZAR
    console.log('🔄 Inicializando carga de datos reales...');

    inicializarSistema();

    inputBusqueda.addEventListener('input', function() {
        clearTimeout(timeoutBusqueda);
        const termino = this.value.trim();

        if (termino.length >= 2) {
            searchSpinner.classList.remove('d-none');
            timeoutBusqueda = setTimeout(() => buscarClientes(termino), DEBOUNCE_DELAY);
        } else {
            resultadosBusqueda.innerHTML = '<p class="text-muted">Ingresa al menos 2 caracteres para buscar</p>';
            searchSpinner.classList.add('d-none');
        }
    });

    btnEnviarNotificaciones.addEventListener('click', enviarNotificacionesWhatsApp);
    btnAsignarMasivo.addEventListener('click', mostrarModalAsignacionMasiva);
    btnCambioFechaMasivo.addEventListener('click', mostrarModalCambioFechaMasivo);
    btnDesasignarMasivo.addEventListener('click', desasignarMasivamente);

    // Manejar cambios en formularios
    document.addEventListener('change', function(e) {
        // Manejar cambio en localidad de visita
        if (e.target && e.target.id === 'localidadVisita') {
            const localidadOtraDiv = document.getElementById('localidadOtraDiv');
            if (e.target.value === 'OTRA') {
                localidadOtraDiv.style.display = 'block';
            } else {
                localidadOtraDiv.style.display = 'none';
            }
        }

        // Manejar cambio en localidad para cliente nuevo
        if (e.target && e.target.id === 'nuevoClienteLocalidad') {
            const localidadOtraDiv = document.getElementById('nuevoClienteLocalidadOtraDiv');
            if (e.target.value === 'OTRA') {
                localidadOtraDiv.style.display = 'block';
            } else {
                localidadOtraDiv.style.display = 'none';
            }
        }

        // Manejar cambio en motivo de visita
        if (e.target && e.target.id === 'motivoVisita') {
            const motivoPersonalizadoDiv = document.getElementById('motivoPersonalizadoDiv');
            if (e.target.value === 'Otro') {
                motivoPersonalizadoDiv.style.display = 'block';
            } else {
                motivoPersonalizadoDiv.style.display = 'none';
            }
        }

        // Manejar cambio en motivo de visita para cliente nuevo
        if (e.target && e.target.id === 'nuevoClienteMotivoVisita') {
            const motivoPersonalizadoDiv = document.getElementById('nuevoClienteMotivoPersonalizadoDiv');
            if (e.target.value === 'Otro') {
                motivoPersonalizadoDiv.style.display = 'block';
            } else {
                motivoPersonalizadoDiv.style.display = 'none';
            }
        }
    });
});

// Inicializar sistema
async function inicializarSistema() {
    try {
        await cargarTecnicos();
        await cargarVisitasPendientes();
        await cargarReportesCompletados();
        await cargarVisitasNoAsignadas(); // Cargar visitas no asignadas al inicializar
        console.log('Sistema inicializado correctamente');
    } catch (error) {
        console.error('Error inicializando sistema:', error);
        mostrarAlerta('Error inicializando el sistema', 'danger');
    }
}

// Buscar clientes en las 3 bases de datos
async function buscarClientes(termino) {
    try {
        const response = await fetch('/api/buscar-clientes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ termino })
        });

        const resultado = await response.json();
        searchSpinner.classList.add('d-none');

        if (resultado.success) {
            mostrarResultadosClientes(resultado.clientes);
        } else {
            resultadosBusqueda.innerHTML = '<div class="alert alert-warning">No se encontraron clientes</div>';
        }
    } catch (error) {
        console.error('Error buscando clientes:', error);
        searchSpinner.classList.add('d-none');
        resultadosBusqueda.innerHTML = '<div class="alert alert-danger">Error en la búsqueda</div>';
    }
}

// Mostrar resultados de búsqueda de clientes
function mostrarResultadosClientes(clientes) {
    if (clientes.length === 0) {
        resultadosBusqueda.innerHTML = '<div class="alert alert-info">No se encontraron clientes con ese criterio</div>';
        return;
    }

    const html = `
        <div class="mt-3">
            <h6>Clientes encontrados (${clientes.length}):</h6>
            <div class="row">
                ${clientes.map(cliente => `
                    <div class="col-12 mb-2">
                        <div class="card cliente-card h-100" onclick="seleccionarCliente(${JSON.stringify(cliente).replace(/"/g, '&quot;')})">
                            <div class="card-body p-2">
                                <div class="d-flex justify-content-between align-items-start">
                                    <div>
                                        <h6 class="card-title mb-1">${cliente.nombre}</h6>
                                        <p class="card-text mb-1">
                                            <small class="text-muted">
                                                <i class="fas fa-id-card"></i> ${cliente.cedula}
                                                ${(() => {
                                                    // Validar teléfono
                                                    const esValidoTel = cliente.telefono && cliente.telefono.trim() &&
                                                                       cliente.telefono.trim().length >= 7 &&
                                                                       !/^[01]$/.test(cliente.telefono.trim());
                                                    const esValidoMov = cliente.movil && cliente.movil.trim() &&
                                                                       cliente.movil.trim().length >= 7 &&
                                                                       !/^[01]$/.test(cliente.movil.trim()) &&
                                                                       cliente.movil !== cliente.telefono;

                                                    let info = '';
                                                    if (esValidoTel) info += ` | <i class="fas fa-phone"></i> ${cliente.telefono}`;
                                                    if (esValidoMov) info += ` | <i class="fas fa-mobile-alt"></i> ${cliente.movil}`;
                                                    return info;
                                                })()}
                                                | <i class="fas fa-server"></i> ${cliente.bd_origen}
                                            </small>
                                        </p>
                                        <p class="card-text mb-1">
                                            <small class="text-muted">
                                                <i class="fas fa-map-marker-alt"></i> ${cliente.direccion || 'Sin dirección'}
                                            </small>
                                        </p>
                                        ${(() => {
                                            // Mostrar información de equipos y seriales
                                            let equiposInfo = '';
                                            if (cliente.mikrotik_nombre) {
                                                equiposInfo += `<p class="card-text mb-1"><small class="text-info"><i class="fas fa-router"></i> ${cliente.mikrotik_nombre}</small></p>`;
                                            }

                                            // Agregar seriales de equipos asignados
                                            const seriales = [];
                                            if (cliente.todos_los_equipos && cliente.todos_los_equipos.length > 0) {
                                                cliente.todos_los_equipos.forEach(equipo => {
                                                    seriales.push(`${equipo.tipo}: ${equipo.serial} (${equipo.estado})`);
                                                });
                                            } else if (cliente.serial_equipo_asignado) {
                                                seriales.push(`Equipo: ${cliente.serial_equipo_asignado}`);
                                                if (cliente.equipo_tipo) seriales.push(`(${cliente.equipo_tipo})`);
                                            }
                                            if (cliente.mikrotik_serial) seriales.push(`MikroTik: ${cliente.mikrotik_serial}`);
                                            if (cliente.equipo_mac) seriales.push(`MAC: ${cliente.equipo_mac}`);
                                            if (cliente.onu_serial) seriales.push(`ONU: ${cliente.onu_serial}`);

                                            if (seriales.length > 0) {
                                                equiposInfo += `<p class="card-text mb-0"><small class="text-success"><i class="fas fa-microchip"></i> <strong>Seriales:</strong> ${seriales.join(', ')}</small></p>`;
                                            }

                                            return equiposInfo;
                                        })()}
                                    </div>
                                    <span class="badge ${cliente.estado === 'Activo' ? 'bg-success' : 'bg-secondary'}">${cliente.estado}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    resultadosBusqueda.innerHTML = html;
}

// Seleccionar cliente para programar visita
function seleccionarCliente(cliente) {
    // Mostrar modal para programar visita
    document.getElementById('clienteId').value = cliente.id;
    document.getElementById('bdOrigen').value = cliente.bd_origen;
    // Construir información de contacto de forma más inteligente
    let infoContacto = `${cliente.nombre} - ${cliente.cedula}`;

    // Función para validar si un teléfono es válido
    function esNumeroTelefonoValido(numero) {
        if (!numero || numero.trim() === '') return false;
        const numeroLimpio = numero.trim();
        // Rechazar números muy cortos (menos de 7 dígitos) o que sean solo "1", "0", etc.
        if (numeroLimpio.length < 7 || /^[01]$/.test(numeroLimpio)) return false;
        return true;
    }

    // Guardar teléfono y móvil en campos ocultos para usarlos correctamente
    const telefonoValido = esNumeroTelefonoValido(cliente.telefono) ? cliente.telefono : '';
    const movilValido = esNumeroTelefonoValido(cliente.movil) && cliente.movil !== cliente.telefono ? cliente.movil : '';

    // Crear campos ocultos si no existen
    let campoTelefonoOculto = document.getElementById('clienteTelefonoOculto');
    let campoMovilOculto = document.getElementById('clienteMovilOculto');

    if (!campoTelefonoOculto) {
        campoTelefonoOculto = document.createElement('input');
        campoTelefonoOculto.type = 'hidden';
        campoTelefonoOculto.id = 'clienteTelefonoOculto';
        document.body.appendChild(campoTelefonoOculto);
    }

    if (!campoMovilOculto) {
        campoMovilOculto = document.createElement('input');
        campoMovilOculto.type = 'hidden';
        campoMovilOculto.id = 'clienteMovilOculto';
        document.body.appendChild(campoMovilOculto);
    }

    campoTelefonoOculto.value = telefonoValido;
    campoMovilOculto.value = movilValido;

    // Agregar teléfono si es válido
    if (telefonoValido) {
        infoContacto += ` - Tel: ${telefonoValido}`;
    }

    // Agregar móvil si es válido
    if (movilValido) {
        infoContacto += ` - Móvil: ${movilValido}`;
    }

    document.getElementById('clienteInfo').value = infoContacto;

    // Agregar información adicional del cliente
    document.getElementById('clienteDireccion').value = cliente.direccion || '';
    document.getElementById('mikrotikNombre').value = cliente.mikrotik_nombre || '';
    document.getElementById('usuarioPpp').value = cliente.usuario_ppp || '';
    document.getElementById('clienteCoordenadas').value = cliente.coordenadas || '';

    // Agregar información de seriales de equipos
    document.getElementById('mikrotikSerial').value = cliente.mikrotik_serial || '';
    document.getElementById('equipoMac').value = cliente.equipo_mac || '';
    document.getElementById('onuSerial').value = cliente.onu_serial || '';
    document.getElementById('serialEquipoAsignado').value = cliente.serial_equipo_asignado || '';
    document.getElementById('equipoTipo').value = cliente.equipo_tipo || '';
    document.getElementById('equipoEstado').value = cliente.equipo_estado || '';

    // Mostrar información de equipos y seriales en el modal
    const equiposContainer = document.getElementById('equiposSeriales');
    const infoEquipos = document.getElementById('infoEquipos');

    let equiposInfo = '';

    // Información de infraestructura
    if (cliente.mikrotik_nombre) {
        equiposInfo += `<p class="mb-1"><strong><i class="fas fa-router"></i> MikroTik:</strong> ${cliente.mikrotik_nombre}</p>`;
    }
    if (cliente.usuario_ppp) {
        equiposInfo += `<p class="mb-1"><strong><i class="fas fa-user"></i> Usuario PPP:</strong> ${cliente.usuario_ppp}</p>`;
    }

    // SECCIÓN DESTACADA: Equipos Asignados al Cliente
    if (cliente.todos_los_equipos && cliente.todos_los_equipos.length > 0) {
        equiposInfo += `<div class="border-start border-warning border-4 ps-3 mb-3 bg-warning-subtle rounded p-3">`;
        equiposInfo += `<p class="mb-3"><strong><i class="fas fa-microchip text-warning"></i> EQUIPOS ASIGNADOS AL CLIENTE:</strong></p>`;

        cliente.todos_los_equipos.forEach((equipo, index) => {
            equiposInfo += `
                <div class="mb-2 p-2 bg-white rounded border ${index < cliente.todos_los_equipos.length - 1 ? 'mb-3' : ''}">
                    <div class="row g-2">
                        <div class="col-md-4">
                            <p class="mb-1 small"><strong>Tipo:</strong><br><span class="text-dark">${equipo.tipo}</span></p>
                        </div>
                        <div class="col-md-5">
                            <p class="mb-1 small"><strong>Serial:</strong><br><span class="text-primary fw-bold font-monospace">${equipo.serial}</span></p>
                        </div>
                        <div class="col-md-3">
                            <p class="mb-1 small"><strong>Estado:</strong><br><span class="badge bg-info">${equipo.estado}</span></p>
                        </div>
                    </div>
                </div>
            `;
        });

        equiposInfo += `
            <div class="text-center mt-2">
                <small class="text-muted"><i class="fas fa-info-circle"></i> Total: ${cliente.todos_los_equipos.length} equipos registrados</small>
            </div>
        </div>`;
    } else if (cliente.serial_equipo_asignado) {
        equiposInfo += `<div class="border-start border-warning border-4 ps-3 mb-3 bg-warning-subtle rounded p-3">`;
        equiposInfo += `<p class="mb-2"><strong><i class="fas fa-microchip text-warning"></i> EQUIPO ASIGNADO:</strong></p>`;
        equiposInfo += `<div class="p-2 bg-white rounded border">`;
        equiposInfo += `<div class="row g-2">`;
        equiposInfo += `<div class="col-md-4"><p class="mb-1 small"><strong>Tipo:</strong><br><span class="text-dark">${cliente.equipo_tipo || 'No especificado'}</span></p></div>`;
        equiposInfo += `<div class="col-md-5"><p class="mb-1 small"><strong>Serial:</strong><br><span class="text-primary fw-bold font-monospace">${cliente.serial_equipo_asignado}</span></p></div>`;
        if (cliente.equipo_estado) {
            equiposInfo += `<div class="col-md-3"><p class="mb-1 small"><strong>Estado:</strong><br><span class="badge bg-info">${cliente.equipo_estado}</span></p></div>`;
        }
        equiposInfo += `</div></div></div>`;
    }

    // Otros seriales de infraestructura
    const otrosSeriales = [];
    if (cliente.mikrotik_serial) otrosSeriales.push(`<span class="badge bg-primary">MikroTik: ${cliente.mikrotik_serial}</span>`);
    if (cliente.equipo_mac) otrosSeriales.push(`<span class="badge bg-secondary">MAC: ${cliente.equipo_mac}</span>`);
    if (cliente.onu_serial) otrosSeriales.push(`<span class="badge bg-success">ONU Config: ${cliente.onu_serial}</span>`);

    if (otrosSeriales.length > 0) {
        equiposInfo += `<p class="mb-0"><strong><i class="fas fa-network-wired"></i> Otros Seriales:</strong><br>${otrosSeriales.join(' ')}</p>`;
    }

    if (equiposInfo) {
        infoEquipos.innerHTML = equiposInfo;
        equiposContainer.style.display = 'block';
    } else {
        equiposContainer.style.display = 'none';
    }

    // Configurar fecha mínima (mañana)
    const mañana = new Date();
    mañana.setDate(mañana.getDate() + 1);
    document.getElementById('fechaProgramada').min = mañana.toISOString().split('T')[0];

    // Resetear campos del formulario
    document.getElementById('localidadVisita').value = '';
    document.getElementById('localidadOtra').value = '';
    document.getElementById('localidadOtraDiv').style.display = 'none';
    document.getElementById('motivoVisita').value = '';
    document.getElementById('motivoPersonalizado').value = '';
    document.getElementById('motivoPersonalizadoDiv').style.display = 'none';
    document.getElementById('notasAdmin').value = '';
    document.getElementById('archivosPdf').value = '';

    const modal = new bootstrap.Modal(document.getElementById('modalAgregarVisita'));
    modal.show();
}

// Guardar nueva visita técnica
async function guardarVisita() {
    try {
        const clienteInfoParts = document.getElementById('clienteInfo').value.split(' - ');

        // Obtener teléfono y móvil desde los campos ocultos para priorizar correctamente
        const telefonoOculto = document.getElementById('clienteTelefonoOculto')?.value || '';
        const movilOculto = document.getElementById('clienteMovilOculto')?.value || '';

        // Crear FormData para manejar archivos
        const formData = new FormData();
        formData.append('cliente_id', document.getElementById('clienteId').value);
        formData.append('cliente_nombre', clienteInfoParts[0]);
        formData.append('cliente_cedula', clienteInfoParts[1]);
        formData.append('cliente_telefono', telefonoOculto);
        formData.append('cliente_movil', movilOculto);
        formData.append('cliente_direccion', document.getElementById('clienteDireccion').value);
        formData.append('cliente_coordenadas', document.getElementById('clienteCoordenadas').value);
        formData.append('mikrotik_nombre', document.getElementById('mikrotikNombre').value);
        formData.append('usuario_ppp', document.getElementById('usuarioPpp').value);

        // Obtener localidad
        const localidadValue = document.getElementById('localidadVisita').value;
        const localidad = localidadValue === 'OTRA'
            ? document.getElementById('localidadOtra').value
            : localidadValue;
        console.log('📍 Localidad seleccionada:', localidad);
        formData.append('localidad', localidad);

        const motivoVisita = document.getElementById('motivoVisita').value === 'Otro'
            ? document.getElementById('motivoPersonalizado').value
            : document.getElementById('motivoVisita').value;
        formData.append('motivo_visita', motivoVisita);
        formData.append('fecha_programada', document.getElementById('fechaProgramada').value);
        formData.append('notas_admin', document.getElementById('notasAdmin').value);
        formData.append('bd_origen', document.getElementById('bdOrigen').value);

        // Agregar archivos PDF
        const archivosPdf = document.getElementById('archivosPdf').files;
        for (let i = 0; i < archivosPdf.length; i++) {
            formData.append('archivos_pdf', archivosPdf[i]);
        }

        // Validaciones
        if (!localidad || !motivoVisita || !document.getElementById('fechaProgramada').value) {
            mostrarAlerta('Por favor completa todos los campos obligatorios', 'warning');
            return;
        }

        const response = await fetch('/api/visitas-tecnicas', {
            method: 'POST',
            body: formData
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Visita técnica programada exitosamente', 'success');

            // Recargar visitas no asignadas para mostrar la nueva visita
            await cargarVisitasNoAsignadas();

            // Cerrar modal y limpiar formulario
            bootstrap.Modal.getInstance(document.getElementById('modalAgregarVisita')).hide();
            document.getElementById('formVisita').reset();
            document.getElementById('archivosPdf').value = '';

        } else {
            mostrarAlerta(resultado.message || 'Error guardando la visita', 'danger');
        }

    } catch (error) {
        console.error('Error guardando visita:', error);
        mostrarAlerta('Error guardando la visita técnica', 'danger');
    }
}

// Cargar visitas no asignadas
async function cargarVisitasNoAsignadas() {
    console.log('🔄 Cargando visitas no asignadas desde la base de datos...');

    try {
        const response = await fetch('/api/visitas-no-asignadas', {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();
        console.log('📥 Respuesta recibida:', resultado);

        if (resultado.success) {
            visitasProgramadas = resultado.visitas.map(visita => ({
                ...visita,
                seleccionada: false
            }));
            console.log('✅ Visitas no asignadas cargadas:', visitasProgramadas.length);
            actualizarTablaVisitas();
        } else {
            console.error('❌ Error del servidor:', resultado.message);
            // Si hay error del servidor, usar datos de prueba como fallback
            console.log('🔄 Usando datos de prueba como fallback...');
            actualizarTablaVisitas();
        }
    } catch (error) {
        console.error('❌ Error cargando visitas no asignadas:', error);
        // Si hay error de red, usar datos de prueba como fallback
        console.log('🔄 Usando datos de prueba como fallback...');
        actualizarTablaVisitas();
    }
}

// Actualizar tabla de visitas programadas
function actualizarTablaVisitas() {
    console.log('📋 Actualizando tabla con', visitasProgramadas.length, 'visitas');
    console.log('📄 Datos de visitas:', visitasProgramadas);

    if (visitasProgramadas.length === 0) {
        tablaVisitas.innerHTML = `
            <div class="p-4 text-center">
                <div class="mb-3">
                    <i class="fas fa-calendar-times fa-3x text-muted"></i>
                </div>
                <h6 class="text-muted">No hay visitas sin asignar</h6>
                <p class="text-muted small mb-0">Las visitas aparecerán aquí cuando los clientes sean seleccionados</p>
            </div>
        `;
        btnEnviarNotificaciones.disabled = true;
        btnAsignarMasivo.disabled = true;
        btnCambioFechaMasivo.disabled = true;
        return;
    }

    const html = `
        <div class="tabla-scroll-container">
            <table class="table table-striped table-hover" id="tablaVisitasSinAsignar" style="width: 100%; table-layout: fixed;">
                <thead class="table-dark">
                    <tr>
                        <th style="width: 4%;">
                            <input type="checkbox" id="selectAll" onchange="toggleSelectAll()" class="form-check-input">
                        </th>
                        <th style="cursor: pointer; width: 25%;" onclick="ordenarTabla('cliente')" title="Ordenar por cliente">
                            Cliente <i class="fas fa-sort" id="sort-cliente"></i>
                        </th>
                        <th style="cursor: pointer; width: 12%;" onclick="ordenarTabla('fecha')" title="Ordenar por fecha">
                            Fecha <i class="fas fa-sort" id="sort-fecha"></i>
                        </th>
                        <th style="cursor: pointer; width: 15%;" onclick="ordenarTabla('localidad')" title="Ordenar por Localidad">
                            Localidad <i class="fas fa-sort" id="sort-localidad"></i>
                        </th>
                        <th style="cursor: pointer; width: 25%;" onclick="ordenarTabla('motivo')" title="Ordenar por Motivo de la Visita">
                            Motivo de la Visita <i class="fas fa-sort" id="sort-motivo"></i>
                        </th>
                        <th style="cursor: pointer; width: 20%;" onclick="ordenarTabla('observaciones')" title="Ordenar por Observaciones">
                            Observaciones <i class="fas fa-sort" id="sort-observaciones"></i>
                        </th>
                        <th style="width: 10%;">Estado</th>
                        <th style="width: 15%;">Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${visitasProgramadas.map((visita, index) => `
                        <tr>
                            <td class="text-center">
                                <input type="checkbox" ${visita.seleccionada ? 'checked' : ''}
                                       onchange="toggleVisitaSeleccion(${index})" class="form-check-input">
                            </td>
                            <td>
                                <div class="fw-bold text-primary">${visita.cliente_nombre || 'Sin nombre'}</div>
                                <small class="text-muted">
                                    <i class="fas fa-id-card me-1"></i>${visita.cliente_cedula || 'Sin cédula'}
                                </small>
                                ${visita.cliente_telefono ? `<br><small class="text-muted"><i class="fas fa-phone me-1"></i>${visita.cliente_telefono}</small>` : ''}
                                ${visita.cliente_movil ? `<br><small class="text-muted"><i class="fas fa-mobile-alt me-1"></i>${visita.cliente_movil}</small>` : ''}
                            </td>
                            <td>
                                ${visita.fecha_programada ? `
                                    <div class="fw-semibold">${formatearFechaLocal(visita.fecha_programada)}</div>
                                    <small class="text-muted">${new Date(visita.fecha_programada + 'T12:00:00').toLocaleDateString('es-ES', {
                                        weekday: 'short'
                                    })}</small>
                                ` : '<span class="text-muted">Sin asignar</span>'}
                            </td>
                            <td>
                                <div class="text-info">
                                    <i class="fas fa-map-marker-alt me-1"></i>
                                    <span class="small fw-semibold">${visita.localidad || 'Sin especificar'}</span>
                                </div>
                            </td>
                            <td style="word-wrap: break-word; overflow-wrap: break-word;">
                                <div class="text-wrap" style="white-space: normal; line-height: 1.2;">
                                    <span class="small" title="${(visita.motivo_visita || 'Sin motivo').replace(/"/g, '&quot;')}">${visita.motivo_visita || 'Sin motivo'}</span>
                                </div>
                            </td>
                            <td style="word-wrap: break-word; overflow-wrap: break-word;">
                                <div class="text-wrap" style="white-space: normal; line-height: 1.2;">
                                    <span class="small text-muted" title="${(visita.observacion || 'Sin observación').replace(/"/g, '&quot;')}">${visita.observacion || 'Sin observación'}</span>
                                </div>
                            </td>
                            <td class="text-center">
                                <span class="badge status-${visita.estado || 'programada'} fs-6">${(visita.estado || 'programada').replace('_', ' ')}</span>
                            </td>
                            <td style="padding: 8px 4px;">
                                <div class="d-flex flex-column gap-1 align-items-center">
                                    ${visita.estado === 'programada' ? `
                                        <button class="btn btn-primary btn-sm" onclick="asignarTecnico(${visita.id})" title="Asignar técnico">
                                            <i class="fas fa-user-plus"></i>
                                        </button>
                                    ` : ''}

                                    ${visita.estado === 'asignada' || visita.estado === 'programada' ? `
                                        <button class="btn btn-warning btn-sm" onclick="editarVisita(${visita.id})" title="Editar visita">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                    ` : ''}


                                    ${visita.estado === 'asignada' ? `
                                        <button class="btn btn-success btn-sm" onclick="marcarEnProgreso(${visita.id})" title="Marcar en progreso">
                                            <i class="fas fa-play"></i>
                                        </button>
                                    ` : ''}

                                    ${visita.estado === 'en_progreso' ? `
                                        <button class="btn btn-outline-success btn-sm" onclick="verProgreso(${visita.id})" title="Ver progreso">
                                            <i class="fas fa-clock"></i>
                                        </button>
                                    ` : ''}


                                    <div class="dropdown">
                                        <button class="btn btn-outline-secondary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" title="Más opciones">
                                            <i class="fas fa-ellipsis-v"></i>
                                        </button>
                                        <ul class="dropdown-menu">
                                            <li><a class="dropdown-item text-warning" href="#" onclick="observacionUrgente(${visita.id})">
                                                <i class="fas fa-exclamation-triangle me-2"></i>Observación urgente
                                            </a></li>
                                            <li><a class="dropdown-item" href="#" onclick="verDetallesVisita(${visita.id})">
                                                <i class="fas fa-eye me-2"></i>Ver detalles
                                            </a></li>
                                            ${visita.tecnico_asignado_id || visita.tecnico_nombre ? `
                                                <li><hr class="dropdown-divider"></li>
                                                <li><a class="dropdown-item text-info" href="#" onclick="desasignarTecnico(${visita.id})">
                                                    <i class="fas fa-user-times me-2"></i>Desasignar técnico
                                                </a></li>
                                            ` : ''}
                                            <li><hr class="dropdown-divider"></li>
                                            <li><a class="dropdown-item text-danger" href="#" onclick="eliminarVisita(${visita.id}, '${(visita.cliente_nombre || 'Cliente').replace(/'/g, '\\\'').replace(/"/g, '&quot;')}')">
                                                <i class="fas fa-trash me-2"></i>Eliminar
                                            </a></li>
                                        </ul>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    tablaVisitas.innerHTML = html;

    // Actualizar estado del checkbox "selectAll" después de regenerar la tabla
    setTimeout(() => {
        const selectAllCheckbox = document.getElementById('selectAll');
        if (selectAllCheckbox && visitasProgramadas.length > 0) {
            const todasSeleccionadas = visitasProgramadas.every(v => v.seleccionada);
            const ningunaSeleccionada = visitasProgramadas.every(v => !v.seleccionada);

            if (todasSeleccionadas) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else if (ningunaSeleccionada) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = true; // Estado intermedio cuando algunas están seleccionadas
            }
        }
    }, 0);

    // Habilitar/deshabilitar botones según visitas seleccionadas
    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada);
    const hayVisitasSeleccionadas = visitasSeleccionadas.length > 0;
    const visitasProgramadasSeleccionadas = visitasSeleccionadas.filter(v => v.estado === 'programada');

    btnEnviarNotificaciones.disabled = !hayVisitasSeleccionadas;
    btnAsignarMasivo.disabled = visitasProgramadasSeleccionadas.length === 0;
    btnCambioFechaMasivo.disabled = visitasProgramadasSeleccionadas.length === 0;
    btnDesasignarMasivo.disabled = !hayVisitasSeleccionadas;

    // Actualizar estadísticas
    actualizarEstadisticas();
}

// Seleccionar/deseleccionar todas las visitas
function toggleSelectAll() {
    const selectAll = document.getElementById('selectAll');
    visitasProgramadas.forEach(visita => {
        visita.seleccionada = selectAll.checked;
    });
    actualizarTablaVisitas();
}

// Seleccionar/deseleccionar visita individual
function toggleVisitaSeleccion(index) {
    visitasProgramadas[index].seleccionada = !visitasProgramadas[index].seleccionada;

    // Actualizar la tabla para reflejar el nuevo estado del checkbox "selectAll"
    actualizarTablaVisitas();
}

// Enviar notificaciones masivas por WhatsApp
async function enviarNotificacionesWhatsApp() {
    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada);

    if (visitasSeleccionadas.length === 0) {
        mostrarAlerta('Selecciona al menos una visita para enviar notificaciones', 'warning');
        return;
    }

    // Mostrar modal para elegir tipo de mensaje
    mostrarModalTipoMensaje(visitasSeleccionadas);
}

// Nueva función para mostrar modal de selección de mensaje
function mostrarModalTipoMensaje(visitasSeleccionadas) {
    // Crear modal dinámicamente
    const modalHTML = `
        <div class="modal fade" id="modalTipoMensaje" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-paper-plane me-2"></i>
                            Enviar Notificaciones (${visitasSeleccionadas.length} visitas)
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-3">¿Qué tipo de mensaje deseas enviar?</p>

                        <div class="mb-3">
                            <div class="form-check mb-3 p-3 border rounded">
                                <input class="form-check-input" type="radio" name="tipoMensaje" id="mensajePredeterminado" value="predeterminado" checked>
                                <label class="form-check-label w-100" for="mensajePredeterminado">
                                    <strong><i class="fas fa-check-circle text-success me-2"></i>Mensaje Predeterminado</strong>
                                    <div class="mt-2 p-2 bg-light rounded" style="font-size: 0.9em;">
                                        <em>Hola [NOMBRE],<br><br>
                                        Le informamos que el día [FECHA] será visitado por nuestro equipo técnico de *SOLUCNET SAS*.<br><br>
                                        🔧 *VISITA TÉCNICA PROGRAMADA*<br><br>
                                        Agradecemos contar con su disponibilidad para recibir la visita técnica.<br><br>
                                        ⚠️ *IMPORTANTE:* No podemos indicarle una hora precisa ya que el tiempo de los técnicos es muy rotativo por la demora en las visitas anteriores y eventos climáticos.<br><br>
                                        Nuestro técnico se comunicará con usted cuando esté cerca de su ubicación.<br><br>
                                        Gracias por su comprensión.<br>
                                        *SOLUCNET SAS*</em>
                                    </div>
                                </label>
                            </div>

                            <div class="form-check p-3 border rounded">
                                <input class="form-check-input" type="radio" name="tipoMensaje" id="mensajePersonalizado" value="personalizado">
                                <label class="form-check-label w-100" for="mensajePersonalizado">
                                    <strong><i class="fas fa-edit text-info me-2"></i>Mensaje Personalizado</strong>
                                </label>
                            </div>
                        </div>

                        <div id="areaPersonalizado" style="display: none;" class="mt-3">
                            <label class="form-label fw-bold">Escribe tu mensaje personalizado:</label>
                            <textarea class="form-control" id="mensajePersonalizadoTexto" rows="8"
                                placeholder="Escribe aquí tu mensaje personalizado...&#10;&#10;Puedes usar:&#10;{NOMBRE} - Se reemplazará con el nombre del cliente&#10;{FECHA} - Se reemplazará con la fecha de la visita"></textarea>
                            <small class="text-muted">
                                💡 <strong>Variables disponibles:</strong> {NOMBRE} y {FECHA}
                            </small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="fas fa-times me-2"></i>Cancelar
                        </button>
                        <button type="button" class="btn btn-primary" onclick="confirmarEnvioNotificaciones()">
                            <i class="fas fa-paper-plane me-2"></i>Enviar Notificaciones
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Eliminar modal anterior si existe
    const modalAntiguo = document.getElementById('modalTipoMensaje');
    if (modalAntiguo) {
        modalAntiguo.remove();
    }

    // Agregar modal al body
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Event listener para mostrar/ocultar área de texto personalizado
    document.getElementById('mensajePersonalizado').addEventListener('change', function() {
        document.getElementById('areaPersonalizado').style.display = 'block';
    });

    document.getElementById('mensajePredeterminado').addEventListener('change', function() {
        document.getElementById('areaPersonalizado').style.display = 'none';
    });

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalTipoMensaje'));
    modal.show();
}

// Nueva función para confirmar y enviar
async function confirmarEnvioNotificaciones() {
    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada);
    const tipoMensaje = document.querySelector('input[name="tipoMensaje"]:checked').value;
    let mensajePersonalizado = null;

    if (tipoMensaje === 'personalizado') {
        mensajePersonalizado = document.getElementById('mensajePersonalizadoTexto').value.trim();
        if (!mensajePersonalizado) {
            mostrarAlerta('Por favor escribe un mensaje personalizado', 'warning');
            return;
        }
    }

    // Cerrar modal
    bootstrap.Modal.getInstance(document.getElementById('modalTipoMensaje')).hide();

    btnEnviarNotificaciones.disabled = true;
    btnEnviarNotificaciones.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

    try {
        const response = await fetch('/api/enviar-notificaciones-visitas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                mensajePersonalizado: mensajePersonalizado,
                visitas: visitasSeleccionadas.map(v => {
                    // Función para validar si un teléfono es válido
                    function esNumeroTelefonoValido(numero) {
                        if (!numero || numero.trim() === '') return false;
                        const numeroLimpio = numero.trim();
                        // Rechazar números muy cortos (menos de 7 dígitos) o que sean solo "1", "0", etc.
                        if (numeroLimpio.length < 7 || /^[01]$/.test(numeroLimpio)) return false;
                        return true;
                    }

                    // Priorizar móvil, usar teléfono fijo como alternativa (igual que backend)
                    let numeroContacto = '';
                    if (esNumeroTelefonoValido(v.cliente_movil)) {
                        numeroContacto = v.cliente_movil;
                    } else if (esNumeroTelefonoValido(v.cliente_telefono)) {
                        numeroContacto = v.cliente_telefono;
                    } else {
                        numeroContacto = ''; // No enviar si no hay teléfonos válidos
                    }

                    return {
                        id: v.id,
                        cliente_nombre: v.cliente_nombre,
                        cliente_movil: esNumeroTelefonoValido(v.cliente_movil) ? v.cliente_movil : '',
                        cliente_telefono: esNumeroTelefonoValido(v.cliente_telefono) ? v.cliente_telefono : '',
                        cliente_cedula: v.cliente_cedula,
                        telefono: numeroContacto, // Campo de respaldo
                        fecha_programada: v.fecha_programada
                    };
                })
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(`Notificaciones enviadas exitosamente a ${resultado.enviados} clientes`, 'success');

            // Marcar visitas como notificadas (pero mantener la selección)
            visitasSeleccionadas.forEach(visita => {
                const index = visitasProgramadas.findIndex(v => v.id === visita.id);
                if (index !== -1) {
                    visitasProgramadas[index].notificada = true;
                    // No cambiar el estado de seleccionada, mantenerla como está
                }
            });

            actualizarTablaVisitas();
        } else {
            mostrarAlerta(resultado.message || 'Error enviando notificaciones', 'danger');
        }

    } catch (error) {
        console.error('Error enviando notificaciones:', error);
        mostrarAlerta('Error enviando notificaciones de WhatsApp', 'danger');
    } finally {
        btnEnviarNotificaciones.disabled = false;
        btnEnviarNotificaciones.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Notificaciones';
    }
}

// Cargar técnicos disponibles
async function cargarTecnicos() {
    try {
        const response = await fetch('/api/tecnicos', {
            method: 'GET'
        });

        const resultado = await response.json();

        if (resultado.success) {
            tecnicosDisponibles = resultado.tecnicos;
            actualizarSelectTecnicos();
        }
    } catch (error) {
        console.error('Error cargando técnicos:', error);
    }
}

// Actualizar select de técnicos
function actualizarSelectTecnicos() {
    const select = document.getElementById('tecnicoAsignar');
    select.innerHTML = '<option value="">Seleccionar técnico...</option>' +
        tecnicosDisponibles.map(tecnico =>
            `<option value="${tecnico.id}">${tecnico.nombre} - ${tecnico.especialidad}</option>`
        ).join('');
}

// Asignar técnico a visita
function asignarTecnico(visitaId) {
    document.getElementById('visitaIdAsignar').value = visitaId;
    const modal = new bootstrap.Modal(document.getElementById('modalAsignarTecnico'));
    modal.show();
}

// Confirmar asignación de técnico
async function confirmarAsignacion() {
    try {
        const visitaId = document.getElementById('visitaIdAsignar').value;
        const tecnicoId = document.getElementById('tecnicoAsignar').value;

        if (!tecnicoId) {
            mostrarAlerta('Selecciona un técnico', 'warning');
            return;
        }

        const response = await fetch(`/api/visitas-tecnicas/${visitaId}/asignar`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tecnicoId })
        });

        const resultado = await response.json();

        if (resultado.success) {
            // Mostrar mensaje según si se envió notificación
            if (resultado.notificacionEnviada) {
                mostrarAlerta(`✅ Técnico asignado y cliente ${resultado.clienteNombre} notificado exitosamente`, 'success');
            } else {
                mostrarAlerta(`⚠️ Técnico asignado exitosamente, pero NO se pudo notificar al cliente: ${resultado.clienteNombre}\n\nPor favor notifica manualmente al cliente.`, 'warning');
            }

            // Recargar visitas no asignadas (la visita asignada ya no aparecerá)
            await cargarVisitasNoAsignadas();

            bootstrap.Modal.getInstance(document.getElementById('modalAsignarTecnico')).hide();

        } else {
            mostrarAlerta(resultado.message || 'Error asignando técnico', 'danger');
        }

    } catch (error) {
        console.error('Error asignando técnico:', error);
        mostrarAlerta('Error asignando técnico', 'danger');
    }
}

// Desasignar técnico de una visita
async function desasignarTecnico(visitaId, clienteNombre) {
    if (!confirm(`¿Estás seguro de que quieres desasignar el técnico de la visita de ${clienteNombre}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/visitas-tecnicas/${visitaId}/desasignar`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Técnico desasignado exitosamente', 'success');
            await cargarVisitasPendientes();
        } else {
            mostrarAlerta(resultado.message || 'Error desasignando técnico', 'danger');
        }

    } catch (error) {
        console.error('Error desasignando técnico:', error);
        mostrarAlerta('Error desasignando técnico', 'danger');
    }
}

// Cargar visitas pendientes
async function cargarVisitasPendientes() {
    try {
        const response = await fetch('/api/visitas-pendientes', {
            method: 'GET'
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarVisitasPendientes(resultado.visitas);
        }
    } catch (error) {
        console.error('Error cargando visitas pendientes:', error);
    }
}

// Mostrar visitas pendientes en la pestaña gestionar
function mostrarVisitasPendientes(visitas) {
    const contenedor = document.getElementById('visitasPendientes');

    // Si el contenedor no existe en la página, salir silenciosamente
    if (!contenedor) {
        console.log('⚠️ Contenedor visitasPendientes no encontrado en esta página');
        return;
    }

    if (visitas.length === 0) {
        contenedor.innerHTML = '<div class="alert alert-info">No hay visitas pendientes</div>';
        return;
    }

    const html = visitas.map(visita => `
        <div class="card visita-card">
            <div class="card-body">
                <div class="row">
                    <div class="col-md-8">
                        <h6 class="card-title">${visita.cliente_nombre}</h6>
                        <p class="card-text mb-1">
                            <i class="fas fa-id-card"></i> ${visita.cliente_cedula} |
                            <i class="fas fa-phone"></i> ${visita.cliente_telefono} |
                            <i class="fas fa-calendar"></i> ${new Date(visita.fecha_programada).toLocaleDateString()}
                        </p>
                        <p class="card-text mb-1"><strong>Motivo:</strong> ${visita.motivo_visita}</p>
                        ${visita.notas_admin ? `<p class="card-text mb-1"><strong>Notas:</strong> ${visita.notas_admin}</p>` : ''}
                        ${visita.tecnico_nombre ? `<p class="card-text mb-0"><strong>Técnico:</strong> ${visita.tecnico_nombre}</p>` : ''}
                    </div>
                    <div class="col-md-4 text-end">
                        <span class="badge status-${visita.estado} mb-2">${visita.estado}</span><br>
                        <div class="d-flex flex-column gap-1">
                            ${!visita.tecnico_asignado_id ?
                                `<button class="btn btn-sm btn-primary" onclick="asignarTecnico(${visita.id})">
                                    <i class="fas fa-user-plus"></i> Asignar Técnico
                                </button>` :
                                `<button class="btn btn-sm btn-warning" onclick="desasignarTecnico(${visita.id}, '${visita.cliente_nombre}')">
                                    <i class="fas fa-user-minus"></i> Desasignar Técnico
                                </button>`
                            }
                            <button class="btn btn-sm btn-info" onclick="agregarObservacionUltimaHora(${visita.id}, '${visita.cliente_nombre}')">
                                <i class="fas fa-exclamation-triangle"></i> Observación Urgente
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="eliminarVisita(${visita.id}, '${visita.cliente_nombre}')">
                                <i class="fas fa-trash"></i> Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    contenedor.innerHTML = html;
}

// Variables para filtros de reportes
let todosLosReportes = [];

// Función para validar reportes en el frontend (completa pero balanceada)
function validarReporteFrontend(reporte) {
    // Verificar que no sea null o undefined
    if (!reporte) return false;

    // Verificar que tenga al menos algún trabajo documentado (OBLIGATORIO)
    const tieneTrabajoValido = (
        (reporte.trabajo_realizado && reporte.trabajo_realizado.trim() !== '') ||
        (reporte.solucion_aplicada && reporte.solucion_aplicada.trim() !== '') ||
        (reporte.notas && reporte.notas.trim() !== '') ||
        (reporte.problemas_encontrados && reporte.problemas_encontrados.trim() !== '')
    );

    if (!tieneTrabajoValido) {
        return false; // Sin trabajo documentado = inválido
    }

    // Si tiene trabajo, verificar que no sea N/A
    const trabajos = [
        reporte.trabajo_realizado,
        reporte.solucion_aplicada,
        reporte.notas,
        reporte.problemas_encontrados
    ].filter(t => t && t.trim() !== '');

    const tieneTrabajoReal = trabajos.some(trabajo =>
        !['n/a', 'na', 'sin especificar', 'no especificado'].includes(trabajo.toLowerCase())
    );

    if (!tieneTrabajoReal) return false;

    // Cliente válido es OPCIONAL (los backups pueden no tenerlo)
    // Si existe, validarlo, si no existe, permitir el reporte
    if (reporte.cliente_nombre) {
        const esClienteValido = typeof reporte.cliente_nombre === 'string' &&
            reporte.cliente_nombre.trim() !== '' &&
            !['n/a', 'na', 'sin especificar', 'no especificado'].includes(reporte.cliente_nombre.toLowerCase());

        if (!esClienteValido) return false;
    }

    return true; // Si tiene trabajo válido, aceptar el reporte
}

// Cargar reportes completados
async function cargarReportesCompletados() {
    try {
        const response = await fetch('/api/reportes-completados', {
            method: 'GET'
        });

        const resultado = await response.json();

        if (resultado.success) {
            // Filtrar reportes en el frontend como capa adicional de seguridad
            const reportesValidos = resultado.reportes.filter(reporte => {
                const esValido = validarReporteFrontend(reporte);
                if (!esValido) {
                    console.warn('🚫 Reporte filtrado en frontend:', reporte.cliente_nombre);
                }
                return esValido;
            });

            console.log(`📊 Reportes recibidos: ${resultado.reportes.length}, válidos: ${reportesValidos.length}`);

            // Debug: Ver si los reportes traen coordenadas
            if (resultado.reportes.length > 0) {
                const primerReporte = resultado.reportes[0];
                console.log('🗺️ Primer reporte del servidor:', {
                    cliente: primerReporte.cliente_nombre,
                    latitud: primerReporte.latitud,
                    longitud: primerReporte.longitud,
                    precision_gps: primerReporte.precision_gps,
                    tiene_coordenadas: !!(primerReporte.latitud && primerReporte.longitud)
                });

                // Debug: Ver si después del filtro se mantienen las coordenadas
                const primerValido = reportesValidos[0];
                if (primerValido) {
                    console.log('🔍 Primer reporte DESPUÉS del filtro:', {
                        cliente: primerValido.cliente_nombre,
                        latitud: primerValido.latitud,
                        longitud: primerValido.longitud,
                        precision_gps: primerValido.precision_gps,
                        tiene_coordenadas: !!(primerValido.latitud && primerValido.longitud)
                    });
                }
            }

            todosLosReportes = reportesValidos;
            mostrarReportesCompletados(reportesValidos);
        }
    } catch (error) {
        console.error('Error cargando reportes:', error);
    }
}

// Mostrar reportes completados
function mostrarReportesCompletados(reportes) {
    const contenedor = document.getElementById('reportesCompletados');

    if (reportes.length === 0) {
        contenedor.innerHTML = '<div class="alert alert-info">No hay reportes completados</div>';
        return;
    }

    // Crear tabla responsiva y compacta
    const html = `
        <div class="table-responsive">
            <table class="table table-hover table-striped">
                <thead class="table-dark">
                    <tr>
                        <th width="15%"><i class="fas fa-user"></i> Cliente</th>
                        <th width="12%"><i class="fas fa-tools"></i> Técnico</th>
                        <th width="12%"><i class="fas fa-calendar"></i> Fecha</th>
                        <th width="15%"><i class="fas fa-wrench"></i> Motivo</th>
                        <th width="10%"><i class="fas fa-clock"></i> Tiempo</th>
                        <th width="8%"><i class="fas fa-thumbs-up"></i> Satisfecho</th>
                        <th width="8%"><i class="fas fa-flag"></i> Seguimiento</th>
                        <th width="20%"><i class="fas fa-info-circle"></i> Detalles</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportes.map(reporte => `
                        <tr class="align-middle">
                            <td>
                                <div class="d-flex flex-column">
                                    <strong class="text-primary">${reporte.cliente_nombre || 'N/A'}</strong>
                                    <small class="text-muted">${reporte.cliente_cedula || 'N/A'}</small>
                                </div>
                            </td>
                            <td>
                                <span class="badge bg-info text-dark">${reporte.tecnico_nombre || 'N/A'}</span>
                            </td>
                            <td>
                                <div class="d-flex flex-column">
                                    <small><strong>${new Date(reporte.fecha_reporte).toLocaleDateString()}</strong></small>
                                    <small class="text-muted">${new Date(reporte.fecha_reporte).toLocaleTimeString()}</small>
                                </div>
                            </td>
                            <td>
                                <span class="text-truncate d-inline-block" style="max-width: 120px;" title="${reporte.motivo_visita || 'N/A'}">
                                    ${reporte.motivo_visita || 'N/A'}
                                </span>
                            </td>
                            <td>
                                <span class="badge bg-secondary">${reporte.tiempo_trabajo || 'N/A'}</span>
                            </td>
                            <td>
                                <span class="badge ${
                                    reporte.cliente_satisfecho === 'si' ? 'bg-success' :
                                    reporte.cliente_satisfecho === 'no' ? 'bg-danger' : 'bg-warning'
                                }">
                                    ${reporte.cliente_satisfecho === 'si' ? '✓ Sí' :
                                      reporte.cliente_satisfecho === 'no' ? '✗ No' : '? N/A'}
                                </span>
                            </td>
                            <td>
                                <span class="badge ${reporte.requiere_seguimiento ? 'bg-warning text-dark' : 'bg-success'}">
                                    ${reporte.requiere_seguimiento ? '⚠ Sí' : '✓ No'}
                                </span>
                            </td>
                            <td>
                                <button class="btn btn-outline-primary btn-sm" onclick="verDetallesReporte(${reporte.id || reporte.visita_id || 'null'}, '${(reporte.cliente_nombre || '').replace(/'/g, "\\'")}')"
                                        title="Ver detalles completos">
                                    <i class="fas fa-eye"></i> Ver
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <!-- Modal para detalles del reporte -->
        <div class="modal fade" id="modalDetallesReporte" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="fas fa-file-alt"></i> Detalles del Reporte</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body" id="detallesReporteContent">
                        <!-- Contenido se carga dinámicamente -->
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    contenedor.innerHTML = html;
}

// Función para mostrar alertas
function mostrarAlerta(mensaje, tipo = 'info') {
    // Crear el elemento de alerta
    const alerta = document.createElement('div');
    alerta.className = `alert alert-${tipo} alert-dismissible fade show position-fixed`;
    alerta.style.cssText = 'top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
    alerta.innerHTML = `
        ${mensaje}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(alerta);

    // Auto-eliminar después de 5 segundos
    setTimeout(() => {
        if (document.body.contains(alerta)) {
            alerta.remove();
        }
    }, 5000);
}

// Filtrar reportes por búsqueda y rango de fechas
function filtrarReportes() {
    const busqueda = document.getElementById('busquedaReportes').value.toLowerCase().trim();
    const fechaDesde = document.getElementById('fechaDesde').value;
    const fechaHasta = document.getElementById('fechaHasta').value;

    // Aplicar validación adicional a todos los reportes antes de filtrar
    let reportesFiltrados = todosLosReportes.filter(reporte => validarReporteFrontend(reporte));

    // Filtrar por búsqueda (nombre o cédula del cliente)
    if (busqueda) {
        reportesFiltrados = reportesFiltrados.filter(reporte =>
            reporte.cliente_nombre.toLowerCase().includes(busqueda) ||
            reporte.cliente_cedula.toLowerCase().includes(busqueda)
        );
    }

    // Filtrar por rango de fechas
    if (fechaDesde) {
        const fechaDesdeObj = new Date(fechaDesde);
        reportesFiltrados = reportesFiltrados.filter(reporte => {
            const fechaReporte = new Date(reporte.fecha_reporte);
            return fechaReporte >= fechaDesdeObj;
        });
    }

    if (fechaHasta) {
        const fechaHastaObj = new Date(fechaHasta);
        fechaHastaObj.setHours(23, 59, 59, 999); // Final del día
        reportesFiltrados = reportesFiltrados.filter(reporte => {
            const fechaReporte = new Date(reporte.fecha_reporte);
            return fechaReporte <= fechaHastaObj;
        });
    }

    mostrarReportesCompletados(reportesFiltrados);

    // Mostrar mensaje si no hay resultados
    if (reportesFiltrados.length === 0 && todosLosReportes.length > 0) {
        document.getElementById('reportesCompletados').innerHTML =
            '<div class="alert alert-warning">No se encontraron reportes que coincidan con los filtros aplicados</div>';
    }
}

// Ver detalles completos del reporte en modal
async function verDetallesReporte(reporteId, clienteNombre) {
    // Buscar reporte por ID primero, luego por nombre de cliente
    let reporte = null;

    if (reporteId && reporteId !== 'null') {
        // Buscar por ID de reporte
        reporte = todosLosReportes.find(r => r.id == reporteId);

        // Si no se encuentra por id, buscar por visita_id
        if (!reporte) {
            reporte = todosLosReportes.find(r => r.visita_id == reporteId);
        }
    }

    // Si aún no se encuentra, buscar por nombre de cliente (fallback)
    if (!reporte && clienteNombre) {
        reporte = todosLosReportes.find(r => r.cliente_nombre === clienteNombre);
    }

    if (!reporte) {
        mostrarAlerta('No se encontró el reporte', 'warning');
        console.error('❌ Reporte no encontrado. ID:', reporteId, 'Cliente:', clienteNombre);
        return;
    }

    // Debug: verificar coordenadas
    console.log('📍 Coordenadas del reporte:', {
        id: reporte.id,
        visita_id: reporte.visita_id,
        cliente: reporte.cliente_nombre,
        latitud: reporte.latitud,
        longitud: reporte.longitud,
        precision_gps: reporte.precision_gps
    });

    // Cargar fotos del reporte si tenemos un ID válido
    let fotosHtml = '';
    if (reporteId && reporteId !== 'null') {
        try {
            const responseFotos = await fetch(`/api/reportes/${reporteId}/fotos`);
            const resultadoFotos = await responseFotos.json();

            if (resultadoFotos.success && resultadoFotos.fotos.length > 0) {
                fotosHtml = `
                    <div class="row mt-3">
                        <div class="col-12">
                            <div class="card">
                                <div class="card-header bg-primary text-white">
                                    <h6 class="mb-0"><i class="fas fa-camera"></i> Fotos del Técnico (${resultadoFotos.fotos.length})</h6>
                                </div>
                                <div class="card-body">
                                    <div class="row">
                                        ${resultadoFotos.fotos.map(foto => `
                                            <div class="col-md-4 mb-3">
                                                <div class="card">
                                                    <img src="${foto.ruta_archivo}" class="card-img-top" alt="${foto.descripcion || 'Foto del reporte'}"
                                                         style="height: 200px; object-fit: cover; cursor: pointer;"
                                                         onclick="mostrarFotoCompleta('${foto.ruta_archivo}', '${foto.descripcion || 'Foto del reporte'}')">
                                                    ${foto.descripcion ? `
                                                        <div class="card-body p-2">
                                                            <small class="text-muted">${foto.descripcion}</small>
                                                        </div>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Error cargando fotos:', error);
        }
    }

    const detallesHtml = `
        <div class="row">
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-header bg-info text-white">
                        <h6 class="mb-0"><i class="fas fa-user"></i> Información del Cliente</h6>
                    </div>
                    <div class="card-body">
                        <p><strong>Nombre:</strong> ${reporte.cliente_nombre || 'N/A'}</p>
                        <p><strong>Cédula:</strong> ${reporte.cliente_cedula || 'N/A'}</p>
                        <p><strong>Teléfono:</strong> ${reporte.cliente_telefono || 'No especificado'}</p>
                        <p><strong>Móvil:</strong> ${reporte.cliente_movil || 'No especificado'}</p>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card h-100">
                    <div class="card-header bg-success text-white">
                        <h6 class="mb-0"><i class="fas fa-calendar"></i> Información de la Visita</h6>
                    </div>
                    <div class="card-body">
                        <p><strong>Técnico:</strong> ${reporte.tecnico_nombre || 'N/A'}</p>
                        <p><strong>Fecha programada:</strong> ${new Date(reporte.fecha_programada).toLocaleDateString()}</p>
                        <p><strong>Fecha completada:</strong> ${new Date(reporte.fecha_reporte).toLocaleString()}</p>
                        <p><strong>Tiempo de trabajo:</strong> ${reporte.tiempo_trabajo || 'No especificado'}</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="row mt-3">
            <div class="col-12">
                <div class="card">
                    <div class="card-header bg-warning text-dark">
                        <h6 class="mb-0"><i class="fas fa-clipboard-list"></i> Detalles del Trabajo</h6>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-4">
                                <p><strong>Motivo original:</strong></p>
                                <div class="alert alert-light">${reporte.motivo_visita || 'N/A'}</div>
                            </div>
                            <div class="col-md-4 text-center">
                                <p><strong>Cliente satisfecho:</strong></p>
                                <span class="badge fs-6 ${
                                    reporte.cliente_satisfecho === 'si' ? 'bg-success' :
                                    reporte.cliente_satisfecho === 'no' ? 'bg-danger' : 'bg-warning'
                                }">
                                    ${reporte.cliente_satisfecho === 'si' ? '✓ Satisfecho' :
                                      reporte.cliente_satisfecho === 'no' ? '✗ No satisfecho' : '? No especificado'}
                                </span>
                            </div>
                            <div class="col-md-4 text-center">
                                <p><strong>Requiere seguimiento:</strong></p>
                                <span class="badge fs-6 ${reporte.requiere_seguimiento ? 'bg-warning text-dark' : 'bg-success'}">
                                    ${reporte.requiere_seguimiento ? '⚠ Requiere seguimiento' : '✓ No requiere'}
                                </span>
                            </div>
                        </div>

                        <!-- Serial del Equipo Asignado -->
                        ${reporte.serial_equipo_asignado ? `
                        <hr>
                        <div class="row mt-3">
                            <div class="col-12">
                                <div class="alert alert-primary" style="background-color: #e7f3ff; border: 2px solid #007bff;">
                                    <div class="d-flex align-items-center">
                                        <i class="fas fa-barcode fs-3 me-3 text-primary"></i>
                                        <div>
                                            <p class="mb-1"><strong class="text-primary">Serial del Equipo Asignado:</strong></p>
                                            <p class="mb-0 font-monospace fw-bold text-primary fs-5">${reporte.serial_equipo_asignado}</p>
                                            ${reporte.equipo_tipo ? `<small class="text-muted">Tipo: ${reporte.equipo_tipo}</small>` : ''}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        ` : ''}

                        <!-- Coordenadas GPS -->
                        ${(reporte.latitud !== null && reporte.latitud !== undefined && reporte.longitud !== null && reporte.longitud !== undefined) ? `
                        <hr>
                        <div class="row mt-3">
                            <div class="col-12">
                                <h6 class="text-primary"><i class="fas fa-map-marker-alt"></i> Coordenadas GPS Capturadas</h6>
                            </div>
                        </div>
                        <div class="row mt-2">
                            <div class="col-md-4">
                                <p><strong><i class="fas fa-map-marker-alt"></i> Coordenadas GPS:</strong></p>
                                <div class="alert alert-info mb-0">${reporte.latitud}, ${reporte.longitud}</div>
                            </div>
                            <div class="col-md-3">
                                <p><strong><i class="fas fa-crosshairs"></i> Precisión:</strong></p>
                                <div class="alert alert-${parseFloat(reporte.precision_gps) <= 9 ? 'success' : 'warning'} mb-0">
                                    ${reporte.precision_gps ? parseFloat(reporte.precision_gps).toFixed(2) + ' metros' : 'N/A'}
                                </div>
                            </div>
                            <div class="col-md-5 text-center">
                                <p><strong>&nbsp;</strong></p>
                                <a href="https://www.google.com/maps?q=${reporte.latitud},${reporte.longitud}" target="_blank" class="btn btn-primary w-100">
                                    <i class="fas fa-map-marked-alt"></i> Ver en Google Maps
                                </a>
                            </div>
                        </div>
                        ` : '<hr><div class="alert alert-warning mt-3 mb-0"><i class="fas fa-exclamation-triangle"></i> No se capturaron coordenadas GPS en esta visita</div>'}
                    </div>
                </div>
            </div>
        </div>


        ${(reporte.problemas_encontrados || reporte.solucion_aplicada || reporte.materiales_utilizados || reporte.notas) ? `
        <div class="row mt-3">
            <div class="col-12">
                <div class="card">
                    <div class="card-header bg-secondary text-white">
                        <h6 class="mb-0"><i class="fas fa-tools"></i> Detalles Técnicos</h6>
                    </div>
                    <div class="card-body">
                        ${reporte.problemas_encontrados ? `
                            <div class="mb-3">
                                <strong class="text-danger"><i class="fas fa-exclamation-triangle"></i> Problemas encontrados:</strong>
                                <div class="alert alert-danger mt-2">${reporte.problemas_encontrados}</div>
                            </div>
                        ` : ''}

                        ${reporte.solucion_aplicada ? `
                            <div class="mb-3">
                                <strong class="text-success"><i class="fas fa-check-circle"></i> Solución aplicada:</strong>
                                <div class="alert alert-success mt-2">${reporte.solucion_aplicada}</div>
                            </div>
                        ` : ''}

                        ${reporte.materiales_utilizados ? `
                            <div class="mb-3">
                                <strong class="text-info"><i class="fas fa-box"></i> Materiales utilizados:</strong>
                                <div class="alert alert-info mt-2">${reporte.materiales_utilizados}</div>
                            </div>
                        ` : ''}

                        ${reporte.notas ? `
                            <div class="mb-0">
                                <strong class="text-secondary"><i class="fas fa-sticky-note"></i> Notas adicionales:</strong>
                                <div class="alert alert-secondary mt-2">${reporte.notas}</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
        ` : ''}

        ${fotosHtml}
    `;

    document.getElementById('detallesReporteContent').innerHTML = detallesHtml;

    // Actualizar el footer del modal para incluir botón de PDF
    const modalFooter = document.querySelector('#modalDetallesReporte .modal-footer');
    modalFooter.innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
        <button type="button" class="btn btn-danger" onclick="generarPdfReporte(${reporteId || 'null'}, '${clienteNombre.replace(/'/g, "\\'")}')">
            <i class="fas fa-file-pdf"></i> Generar PDF
        </button>
    `;

    new bootstrap.Modal(document.getElementById('modalDetallesReporte')).show();
}

// Filtrar reportes por días (1, 7, 30)
function filtrarPorDias(dias) {
    const ahora = new Date();
    const fechaLimite = new Date();
    fechaLimite.setDate(ahora.getDate() - dias);

    const reportesFiltrados = todosLosReportes
        .filter(reporte => validarReporteFrontend(reporte)) // Validar primero
        .filter(reporte => {
            const fechaReporte = new Date(reporte.fecha_reporte);
            return fechaReporte >= fechaLimite;
        });

    mostrarReportesCompletados(reportesFiltrados);

    // Limpiar campos de fecha manual
    document.getElementById('fechaDesde').value = '';
    document.getElementById('fechaHasta').value = '';
    document.getElementById('busquedaReportes').value = '';

    // Resaltar botón activo
    document.querySelectorAll('.btn-group .btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
}

// Limpiar todos los filtros
function limpiarFiltros() {
    document.getElementById('busquedaReportes').value = '';
    document.getElementById('fechaDesde').value = '';
    document.getElementById('fechaHasta').value = '';

    // Remover clases activas de botones
    document.querySelectorAll('.btn-group .btn').forEach(btn => btn.classList.remove('active'));

    // Mostrar todos los reportes válidos
    const reportesValidos = todosLosReportes.filter(reporte => validarReporteFrontend(reporte));
    mostrarReportesCompletados(reportesValidos);
}

// Eliminar visita técnica
async function eliminarVisita(visitaId, clienteNombre) {
    if (!confirm(`¿Estás seguro de que deseas eliminar la visita técnica de ${clienteNombre}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/visitas-tecnicas/${visitaId}`, {
            method: 'DELETE'
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Visita eliminada exitosamente', 'success');
            // Recargar las visitas pendientes
            await cargarVisitasPendientes();
        } else {
            mostrarAlerta(resultado.message || 'Error eliminando la visita', 'danger');
        }

    } catch (error) {
        console.error('Error eliminando visita:', error);
        mostrarAlerta('Error eliminando la visita técnica', 'danger');
    }
}

// Cerrar sesión
document.getElementById('btnCerrarSesion').addEventListener('click', function() {
    window.location.href = '/';
});

// Mostrar formulario para crear cliente nuevo
function mostrarFormularioClienteNuevo() {
    // Configurar fecha mínima (mañana)
    const mañana = new Date();
    mañana.setDate(mañana.getDate() + 1);
    document.getElementById('nuevoClienteFechaProgramada').min = mañana.toISOString().split('T')[0];

    const modal = new bootstrap.Modal(document.getElementById('modalClienteNuevo'));
    modal.show();
}

// Crear cliente nuevo y programar visita
async function crearClienteYVisita() {
    try {
        // Crear FormData para manejar archivos
        const formData = new FormData();

        // Datos del cliente
        formData.append('cliente_nombre', document.getElementById('nuevoClienteNombre').value);
        formData.append('cliente_cedula', document.getElementById('nuevoClienteCedula').value);
        formData.append('cliente_telefono', document.getElementById('nuevoClienteTelefono').value);
        formData.append('cliente_movil', document.getElementById('nuevoClienteMovil').value);
        formData.append('cliente_direccion', document.getElementById('nuevoClienteDireccion').value);
        formData.append('cliente_email', document.getElementById('nuevoClienteEmail').value);
        formData.append('cliente_coordenadas', document.getElementById('nuevoClienteCoordenadas').value);

        // Obtener localidad
        const localidadValue = document.getElementById('nuevoClienteLocalidad').value;
        const localidad = localidadValue === 'OTRA'
            ? document.getElementById('nuevoClienteLocalidadOtra').value
            : localidadValue;
        formData.append('localidad', localidad);

        // Datos de la visita
        const motivoVisita = document.getElementById('nuevoClienteMotivoVisita').value === 'Otro'
            ? document.getElementById('nuevoClienteMotivoPersonalizado').value
            : document.getElementById('nuevoClienteMotivoVisita').value;
        formData.append('motivo_visita', motivoVisita);
        formData.append('fecha_programada', document.getElementById('nuevoClienteFechaProgramada').value);
        formData.append('notas_admin', document.getElementById('nuevoClienteNotas').value);

        // Marcar como cliente nuevo
        formData.append('es_cliente_nuevo', 'true');

        // Agregar archivos PDF
        const archivosPdf = document.getElementById('nuevoClienteArchivosPdf').files;
        for (let i = 0; i < archivosPdf.length; i++) {
            formData.append('archivos_pdf', archivosPdf[i]);
        }

        // Validaciones
        if (!document.getElementById('nuevoClienteNombre').value ||
            !document.getElementById('nuevoClienteCedula').value ||
            !document.getElementById('nuevoClienteTelefono').value ||
            !document.getElementById('nuevoClienteDireccion').value ||
            !localidad ||
            !motivoVisita ||
            !document.getElementById('nuevoClienteFechaProgramada').value) {
            mostrarAlerta('Por favor completa todos los campos obligatorios', 'warning');
            return;
        }

        const response = await fetch('/api/crear-cliente-y-visita', {
            method: 'POST',
            body: formData
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Cliente creado y visita programada exitosamente', 'success');

            // Recargar visitas no asignadas para mostrar la nueva visita
            await cargarVisitasNoAsignadas();

            // Cerrar modal y limpiar formulario
            bootstrap.Modal.getInstance(document.getElementById('modalClienteNuevo')).hide();
            document.getElementById('formClienteNuevo').reset();
            document.getElementById('nuevoClienteArchivosPdf').value = '';

        } else {
            mostrarAlerta(resultado.message || 'Error creando el cliente y la visita', 'danger');
        }

    } catch (error) {
        console.error('Error creando cliente y visita:', error);
        mostrarAlerta('Error creando el cliente y programando la visita', 'danger');
    }
}

// =======================================================
// FUNCIONES PARA ÓRDENES DE TÉCNICOS
// =======================================================

let ordenesTecnicos = [];
let ordenesOriginal = [];

// Variables para actualización automática
let intervalId = null;
let autoUpdate = false;

// Inicializar pestaña de órdenes cuando se seleccione
document.addEventListener('shown.bs.tab', function(e) {
    if (e.target.id === 'ordenes-tecnicos-tab') {
        actualizarOrdenesTecnicos();
        // Iniciar actualización automática cada 30 segundos
        iniciarActualizacionAutomatica();
    } else {
        // Detener actualización automática cuando se salga de la pestaña
        detenerActualizacionAutomatica();
    }
});

// Iniciar actualización automática
function iniciarActualizacionAutomatica() {
    if (!intervalId) {
        autoUpdate = true;
        intervalId = setInterval(() => {
            if (autoUpdate) {
                console.log('🔄 [AUTO-UPDATE] Actualizando órdenes automáticamente...');
                actualizarOrdenesTecnicos();
            }
        }, 30000); // 30 segundos
        console.log('✅ [AUTO-UPDATE] Actualización automática iniciada');
    }
}

// Detener actualización automática
function detenerActualizacionAutomatica() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        autoUpdate = false;
        console.log('🛑 [AUTO-UPDATE] Actualización automática detenida');
    }
}

// Actualizar órdenes de técnicos
async function actualizarOrdenesTecnicos() {
    try {
        console.log('Actualizando órdenes de técnicos...');

        const response = await fetch('/api/admin/visitas/ordenes-tecnicos');
        const resultado = await response.json();

        if (resultado.success) {
            ordenesTecnicos = resultado.ordenes;
            ordenesOriginal = [...ordenesTecnicos];

            actualizarResumenOrdenes();
            cargarTecnicosEnFiltro();
            mostrarOrdenes();
        } else {
            console.error('Error obteniendo órdenes:', resultado.message);
            document.getElementById('contenidoOrdenes').innerHTML =
                `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${resultado.message}</div>`;
        }
    } catch (error) {
        console.error('Error actualizando órdenes:', error);
        document.getElementById('contenidoOrdenes').innerHTML =
            '<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error conectando con el servidor</div>';
    }
}

// Actualizar resumen de órdenes
function actualizarResumenOrdenes() {
    const asignadas = ordenesTecnicos.filter(o => o.estado === 'asignada').length;
    const enProgreso = ordenesTecnicos.filter(o => o.estado === 'en_progreso').length;
    const completadasHoy = ordenesTecnicos.filter(o => {
        return o.estado === 'completada' &&
               new Date(o.fecha_completado).toDateString() === new Date().toDateString();
    }).length;
    const canceladas = ordenesTecnicos.filter(o => o.estado === 'cancelada').length;

    document.getElementById('totalAsignadas').textContent = asignadas;
    document.getElementById('totalEnProgreso').textContent = enProgreso;
    document.getElementById('totalCompletadas').textContent = completadasHoy;
    document.getElementById('totalCanceladas').textContent = canceladas;
}

// Cargar técnicos en filtro
function cargarTecnicosEnFiltro() {
    const tecnicos = [...new Set(ordenesTecnicos.map(o => o.tecnico_nombre))].sort();
    const filtroTecnico = document.getElementById('filtroTecnico');

    // Mantener selección actual
    const seleccionActual = filtroTecnico.value;

    filtroTecnico.innerHTML = '<option value="">Todos los técnicos</option>';

    tecnicos.forEach(tecnico => {
        if (tecnico) {
            const option = document.createElement('option');
            option.value = tecnico;
            option.textContent = tecnico;
            if (tecnico === seleccionActual) option.selected = true;
            filtroTecnico.appendChild(option);
        }
    });
}

// Mostrar órdenes según vista seleccionada
function mostrarOrdenes() {
    const vistaSeleccionada = document.querySelector('input[name="vistaOrdenes"]:checked').value;

    if (vistaSeleccionada === 'tecnicos') {
        mostrarOrdenesPorTecnico();
    } else {
        mostrarOrdenesLista();
    }
}

// Vista por técnico
function mostrarOrdenesPorTecnico() {
    const tecnicos = agruparPorTecnico(ordenesTecnicos);
    let html = '';

    if (Object.keys(tecnicos).length === 0) {
        html = '<p class="text-muted text-center py-4">No hay órdenes para mostrar</p>';
    } else {
        Object.keys(tecnicos).sort().forEach(tecnico => {
            const ordenes = tecnicos[tecnico];
            const enProgreso = ordenes.find(o => o.estado === 'en_progreso');

            html += `
                <div class="card mb-3">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h6 class="mb-0">
                            <i class="fas fa-user-cog"></i> ${tecnico || 'Sin asignar'}
                            <span class="badge bg-primary ms-2">${ordenes.length} órdenes</span>
                        </h6>
                        ${enProgreso ? `<span class="badge bg-warning">Trabajando en: ${enProgreso.cliente_nombre}</span>` : ''}
                    </div>
                    <div class="card-body">
                        <div class="row">
            `;

            ordenes.forEach(orden => {
                html += crearTarjetaOrden(orden);
            });

            html += `
                        </div>
                    </div>
                </div>
            `;
        });
    }

    document.getElementById('contenidoOrdenes').innerHTML = html;
}

// Vista de lista general
function mostrarOrdenesLista() {
    let html = '<div class="row">';

    if (ordenesTecnicos.length === 0) {
        html += '<div class="col-12"><p class="text-muted text-center py-4">No hay órdenes para mostrar</p></div>';
    } else {
        ordenesTecnicos.forEach(orden => {
            html += crearTarjetaOrden(orden);
        });
    }

    html += '</div>';
    document.getElementById('contenidoOrdenes').innerHTML = html;
}

// Crear tarjeta de orden
function crearTarjetaOrden(orden) {
    const estadoClass = {
        'programada': 'status-programada',
        'asignada': 'status-asignada',
        'en_progreso': 'status-en_progreso',
        'completada': 'status-completada',
        'cancelada': 'status-cancelada'
    };

    const estadoIcono = {
        'programada': 'fa-calendar',
        'asignada': 'fa-user-check',
        'en_progreso': 'fa-cog fa-spin',
        'completada': 'fa-check-circle',
        'cancelada': 'fa-times-circle'
    };

    const fechaCreacion = new Date(orden.fecha_creacion).toLocaleDateString('es-ES');
    const horaCreacion = new Date(orden.fecha_creacion).toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'});

    return `
        <div class="col-md-6 col-lg-4 mb-3">
            <div class="card h-100 orden-card" onclick="verDetalleOrden(${orden.id})">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <small class="text-muted">#${orden.id}</small>
                    <span class="badge ${estadoClass[orden.estado]}">
                        <i class="fas ${estadoIcono[orden.estado]}"></i> ${orden.estado.replace('_', ' ')}
                    </span>
                </div>
                <div class="card-body">
                    <h6 class="card-title">${orden.cliente_nombre}</h6>
                    <p class="card-text text-muted small">
                        <i class="fas fa-map-marker-alt"></i> ${orden.cliente_direccion || 'Sin dirección'}
                    </p>
                    <p class="card-text small">${orden.descripcion || 'Sin descripción'}</p>

                    ${orden.tecnico_nombre ? `
                        <div class="d-flex align-items-center mb-2">
                            <i class="fas fa-user-cog text-success me-2"></i>
                            <small><strong>${orden.tecnico_nombre}</strong></small>
                        </div>
                    ` : ''}

                    <small class="text-muted">
                        <i class="fas fa-calendar"></i> ${fechaCreacion} ${horaCreacion}
                    </small>
                </div>
                ${orden.estado === 'en_progreso' ? '<div class="card-footer bg-warning bg-opacity-25"><small><i class="fas fa-cog fa-spin"></i> En proceso</small></div>' : ''}
            </div>
        </div>
    `;
}

// Agrupar órdenes por técnico
function agruparPorTecnico(ordenes) {
    return ordenes.reduce((grupos, orden) => {
        const tecnico = orden.tecnico_nombre || 'Sin asignar';
        if (!grupos[tecnico]) {
            grupos[tecnico] = [];
        }
        grupos[tecnico].push(orden);
        return grupos;
    }, {});
}

// Filtrar por técnico
function filtrarPorTecnico() {
    const tecnicoSeleccionado = document.getElementById('filtroTecnico').value;

    if (tecnicoSeleccionado === '') {
        ordenesTecnicos = [...ordenesOriginal];
    } else {
        ordenesTecnicos = ordenesOriginal.filter(o => o.tecnico_nombre === tecnicoSeleccionado);
    }

    mostrarOrdenes();
    actualizarResumenOrdenes();
}

// Filtrar por estado
function filtrarPorEstado() {
    const estadoSeleccionado = document.getElementById('filtroEstadoOrden').value;

    if (estadoSeleccionado === '') {
        ordenesTecnicos = [...ordenesOriginal];
    } else {
        ordenesTecnicos = ordenesOriginal.filter(o => o.estado === estadoSeleccionado);
    }

    mostrarOrdenes();
    actualizarResumenOrdenes();
}

// Cambiar vista (por técnico o lista)
document.addEventListener('change', function(e) {
    if (e.target.name === 'vistaOrdenes') {
        mostrarOrdenes();
    }
});

// Ver detalle de una orden
async function verDetalleOrden(ordenId) {
    try {
        const response = await fetch(`/api/admin/visitas/orden/${ordenId}/detalle`);
        const resultado = await response.json();

        if (resultado.success) {
            const orden = resultado.orden;

            // Llenar datos básicos
            document.getElementById('modalOrdenId').textContent = orden.id;
            document.getElementById('modalOrdenCliente').textContent = orden.cliente_nombre;
            document.getElementById('modalOrdenDireccion').textContent = orden.cliente_direccion || 'Sin dirección';
            document.getElementById('modalOrdenDescripcion').textContent = orden.descripcion || 'Sin descripción';
            document.getElementById('modalOrdenPrioridad').textContent = orden.prioridad || 'Normal';
            document.getElementById('modalOrdenPrioridad').className = 'badge ' + (orden.prioridad === 'alta' ? 'bg-danger' : orden.prioridad === 'media' ? 'bg-warning' : 'bg-primary');

            const estadoBadge = document.getElementById('modalOrdenEstado');
            estadoBadge.textContent = orden.estado.replace('_', ' ');
            estadoBadge.className = 'badge ' + {
                'programada': 'bg-secondary',
                'asignada': 'bg-primary',
                'en_progreso': 'bg-warning',
                'completada': 'bg-success',
                'cancelada': 'bg-danger'
            }[orden.estado];

            // Información del técnico
            document.getElementById('modalTecnicoNombre').textContent = orden.tecnico_nombre || 'No asignado';
            document.getElementById('modalTecnicoTelefono').textContent = orden.tecnico_telefono || 'N/A';
            document.getElementById('modalTecnicoEstado').textContent = orden.tecnico_estado || 'N/A';
            document.getElementById('modalTecnicoUbicacion').textContent = orden.tecnico_ubicacion || 'N/A';

            // Timeline y reportes se cargarían aquí si están disponibles
            document.getElementById('modalOrdenTimeline').innerHTML = '<p class="text-muted">Funcionalidad de timeline pendiente</p>';

            // Mostrar modal
            new bootstrap.Modal(document.getElementById('modalDetalleOrden')).show();

        } else {
            mostrarAlerta('Error obteniendo detalles de la orden', 'danger');
        }
    } catch (error) {
        console.error('Error obteniendo detalle:', error);
        mostrarAlerta('Error conectando con el servidor', 'danger');
    }
}

// Toggle actualización automática
function toggleAutoUpdate() {
    if (autoUpdate) {
        detenerActualizacionAutomatica();
        document.getElementById('btnAutoUpdate').innerHTML = '<i class="fas fa-play"></i>';
        document.getElementById('btnAutoUpdate').className = 'btn btn-outline-primary btn-sm';
        document.getElementById('btnAutoUpdate').title = 'Iniciar actualización automática';
    } else {
        iniciarActualizacionAutomatica();
        document.getElementById('btnAutoUpdate').innerHTML = '<i class="fas fa-pause"></i>';
        document.getElementById('btnAutoUpdate').className = 'btn btn-success btn-sm';
        document.getElementById('btnAutoUpdate').title = 'Detener actualización automática (cada 30s)';
    }
}

// Función para agregar observación de última hora
function agregarObservacionUltimaHora(visitaId, clienteNombre) {
    // Crear un modal temporal
    const modalHtml = `
        <div class="modal fade" id="modalObservacionUrgente" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title">
                            <i class="fas fa-exclamation-triangle"></i> Observación de Última Hora
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning">
                            <strong>Cliente:</strong> ${clienteNombre}<br>
                            <small>Esta observación aparecerá destacada para el técnico asignado</small>
                        </div>
                        <div class="mb-3">
                            <label for="observacionTexto" class="form-label">Observación urgente *</label>
                            <textarea class="form-control" id="observacionTexto" rows="4"
                                placeholder="Escriba la información importante que el técnico debe saber antes de realizar la visita..."
                                maxlength="500"></textarea>
                            <div class="form-text">Máximo 500 caracteres</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-warning" onclick="guardarObservacionUrgente(${visitaId})">
                            <i class="fas fa-save"></i> Guardar Observación
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Eliminar modal existente si existe
    const modalExistente = document.getElementById('modalObservacionUrgente');
    if (modalExistente) {
        modalExistente.remove();
    }

    // Agregar modal al body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalObservacionUrgente'));
    modal.show();
}

// Función para guardar la observación urgente
async function guardarObservacionUrgente(visitaId) {
    const observacion = document.getElementById('observacionTexto').value.trim();

    if (!observacion) {
        mostrarAlerta('Por favor, ingrese la observación', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/agregar-observacion-urgente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visitaId: visitaId,
                observacion: observacion
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Observación guardada exitosamente. El técnico la verá destacada.', 'success');

            // Cerrar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalObservacionUrgente'));
            modal.hide();

            // Actualizar la lista de visitas
            await cargarVisitasPendientes();

        } else {
            mostrarAlerta(resultado.message || 'Error guardando la observación', 'danger');
        }

    } catch (error) {
        console.error('Error guardando observación:', error);
        mostrarAlerta('Error conectando con el servidor', 'danger');
    }
}

// Función para editar una visita sin agendar
async function editarVisita(visitaId) {
    try {
        // Buscar la visita en el array
        const visita = visitasProgramadas.find(v => v.id === visitaId);
        if (!visita) {
            mostrarAlerta('Visita no encontrada', 'danger');
            return;
        }

        // Obtener archivos PDF existentes
        const responseArchivos = await fetch(`/api/visitas-tecnicas/${visitaId}/archivos`);
        let archivosExistentes = [];
        if (responseArchivos.ok) {
            const resultArchivos = await responseArchivos.json();
            if (resultArchivos.success) {
                archivosExistentes = resultArchivos.archivos;
            }
        }

        // Crear el modal dinámicamente
        const modalHtml = `
            <div class="modal fade" id="modalEditarVisita" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-warning text-dark">
                            <h5 class="modal-title">
                                <i class="fas fa-edit"></i> Editar Visita Sin Agendar
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="alert alert-info">
                                <strong>Cliente:</strong> ${visita.cliente_nombre}<br>
                                <small>Puedes modificar la fecha, motivo y observación de esta visita</small>
                            </div>

                            <input type="hidden" id="editVisitaId" value="${visitaId}">

                            <div class="mb-3">
                                <label for="editLocalidadVisita" class="form-label">Localidad *</label>
                                <select class="form-select" id="editLocalidadVisita" required>
                                    <option value="">Seleccione la zona de instalación...</option>
                                    <option value="REPOSO" ${visita.localidad === 'REPOSO' ? 'selected' : ''}>REPOSO</option>
                                    <option value="SALVADOR" ${visita.localidad === 'SALVADOR' ? 'selected' : ''}>SALVADOR</option>
                                    <option value="CHURIDO" ${visita.localidad === 'CHURIDO' ? 'selected' : ''}>CHURIDO</option>
                                    <option value="SALSIPUEDES" ${visita.localidad === 'SALSIPUEDES' ? 'selected' : ''}>SALSIPUEDES</option>
                                    <option value="RIO GRANDE" ${visita.localidad === 'RIO GRANDE' ? 'selected' : ''}>RIO GRANDE</option>
                                    <option value="OSITO" ${visita.localidad === 'OSITO' ? 'selected' : ''}>OSITO</option>
                                    <option value="MI LUCHA" ${visita.localidad === 'MI LUCHA' ? 'selected' : ''}>MI LUCHA</option>
                                    <option value="OTRA" ${visita.localidad && !['REPOSO','SALVADOR','CHURIDO','SALSIPUEDES','RIO GRANDE','OSITO','MI LUCHA'].includes(visita.localidad) ? 'selected' : ''}>OTRA LOCALIDAD</option>
                                </select>
                            </div>

                            <div class="mb-3" id="editLocalidadOtraDiv" style="display: ${visita.localidad && !['REPOSO','SALVADOR','CHURIDO','SALSIPUEDES','RIO GRANDE','OSITO','MI LUCHA'].includes(visita.localidad) ? 'block' : 'none'};">
                                <label for="editLocalidadOtra" class="form-label">Especificar localidad</label>
                                <input type="text" class="form-control" id="editLocalidadOtra" placeholder="Ingrese el nombre de la localidad" value="${visita.localidad && !['REPOSO','SALVADOR','CHURIDO','SALSIPUEDES','RIO GRANDE','OSITO','MI LUCHA'].includes(visita.localidad) ? visita.localidad : ''}">
                            </div>

                            <div class="mb-3">
                                <label for="editFechaVisita" class="form-label">Fecha de visita *</label>
                                <input type="date" class="form-control" id="editFechaVisita"
                                       value="${visita.fecha_programada ? visita.fecha_programada.split('T')[0] : ''}" required>
                            </div>

                            <div class="mb-3">
                                <label for="editMotivoVisita" class="form-label">Motivo de visita *</label>
                                <select class="form-select" id="editMotivoVisita" required>
                                    <option value="">Seleccione un motivo</option>
                                    <option value="Luz roja en el equipo" ${visita.motivo_visita === 'Luz roja en el equipo' ? 'selected' : ''}>Luz roja en el equipo</option>
                                    <option value="Traslado" ${visita.motivo_visita === 'Traslado' ? 'selected' : ''}>Traslado</option>
                                    <option value="Instalación" ${visita.motivo_visita === 'Instalación' ? 'selected' : ''}>Instalación</option>
                                    <option value="Cambio de equipo" ${visita.motivo_visita === 'Cambio de equipo' ? 'selected' : ''}>Cambio de equipo</option>
                                    <option value="Retiro" ${visita.motivo_visita === 'Retiro' ? 'selected' : ''}>Retiro</option>
                                    <option value="Otro" ${!['Luz roja en el equipo', 'Traslado', 'Instalación', 'Cambio de equipo', 'Retiro'].includes(visita.motivo_visita) ? 'selected' : ''}>Otro</option>
                                </select>
                            </div>

                            <div class="mb-3" id="editMotivoPersonalizadoDiv" style="display: ${!['Luz roja en el equipo', 'Traslado', 'Instalación', 'Cambio de equipo', 'Retiro'].includes(visita.motivo_visita) && visita.motivo_visita ? 'block' : 'none'};">
                                <label for="editMotivoPersonalizado" class="form-label">Especificar motivo</label>
                                <textarea class="form-control" id="editMotivoPersonalizado" rows="2" placeholder="Ingrese el motivo de la visita...">${!['Luz roja en el equipo', 'Traslado', 'Instalación', 'Cambio de equipo', 'Retiro'].includes(visita.motivo_visita) && visita.motivo_visita ? visita.motivo_visita : ''}</textarea>
                            </div>

                            <div class="mb-3">
                                <label for="editObservacion" class="form-label">Observación</label>
                                <textarea class="form-control" id="editObservacion" rows="3"
                                    placeholder="Observaciones adicionales sobre la visita...">${visita.observacion || ''}</textarea>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Archivos PDF adjuntos</label>
                                <div id="archivosExistentesContainer" class="mb-2">
                                    ${archivosExistentes.length > 0 ? archivosExistentes.map(archivo => `
                                        <div class="d-flex align-items-center justify-content-between p-2 mb-2 border rounded" data-archivo-id="${archivo.id}">
                                            <div class="d-flex align-items-center">
                                                <i class="fas fa-file-pdf text-danger me-2"></i>
                                                <div>
                                                    <a href="/uploads/visitas/${archivo.nombre_archivo}" target="_blank" class="text-decoration-none">
                                                        ${archivo.nombre_original}
                                                    </a>
                                                    <br>
                                                    <small class="text-muted">${(archivo.tamaño / 1024).toFixed(2)} KB</small>
                                                </div>
                                            </div>
                                            <button type="button" class="btn btn-sm btn-danger" onclick="eliminarArchivoPdf(${archivo.id})">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    `).join('') : '<p class="text-muted small">No hay archivos adjuntos</p>'}
                                </div>
                                <input type="file" class="form-control" id="editArchivosPdf" accept=".pdf" multiple>
                                <div class="form-text">Puedes subir archivos PDF adicionales que el técnico podrá descargar.</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-warning" onclick="guardarCambiosVisita()">
                                <i class="fas fa-save"></i> Guardar Cambios
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Eliminar modal existente si existe
        const modalExistente = document.getElementById('modalEditarVisita');
        if (modalExistente) {
            modalExistente.remove();
        }

        // Agregar modal al body
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Agregar event listener para el cambio de localidad
        document.getElementById('editLocalidadVisita').addEventListener('change', function(e) {
            const localidadOtraDiv = document.getElementById('editLocalidadOtraDiv');
            if (e.target.value === 'OTRA') {
                localidadOtraDiv.style.display = 'block';
            } else {
                localidadOtraDiv.style.display = 'none';
            }
        });

        // Agregar event listener para el cambio de motivo
        document.getElementById('editMotivoVisita').addEventListener('change', function(e) {
            const motivoPersonalizadoDiv = document.getElementById('editMotivoPersonalizadoDiv');
            if (e.target.value === 'Otro') {
                motivoPersonalizadoDiv.style.display = 'block';
            } else {
                motivoPersonalizadoDiv.style.display = 'none';
            }
        });

        // Mostrar el modal
        const modal = new bootstrap.Modal(document.getElementById('modalEditarVisita'));
        modal.show();

    } catch (error) {
        console.error('Error al abrir modal de edición:', error);
        mostrarAlerta('Error al cargar los datos de la visita', 'danger');
    }
}

// Función para guardar los cambios de la visita editada
async function guardarCambiosVisita() {
    try {
        const visitaId = document.getElementById('editVisitaId').value;
        const localidadValue = document.getElementById('editLocalidadVisita').value;
        const localidad = localidadValue === 'OTRA'
            ? document.getElementById('editLocalidadOtra').value
            : localidadValue;
        const fechaVisita = document.getElementById('editFechaVisita').value;
        const motivoVisitaSelect = document.getElementById('editMotivoVisita').value;
        const motivoVisita = motivoVisitaSelect === 'Otro'
            ? document.getElementById('editMotivoPersonalizado').value
            : motivoVisitaSelect;
        const observacion = document.getElementById('editObservacion').value;

        if (!localidad || !fechaVisita || !motivoVisita) {
            mostrarAlerta('La localidad, fecha y motivo de visita son obligatorios', 'warning');
            return;
        }

        // Crear FormData para manejar archivos
        const formData = new FormData();
        formData.append('visitaId', visitaId);
        formData.append('localidad', localidad);
        formData.append('fechaVisita', fechaVisita);
        formData.append('motivoVisita', motivoVisita);
        formData.append('observacion', observacion);

        // Agregar archivos PDF nuevos si existen
        const archivosPdf = document.getElementById('editArchivosPdf').files;
        for (let i = 0; i < archivosPdf.length; i++) {
            formData.append('archivos_pdf', archivosPdf[i]);
        }

        const response = await fetch('/api/editar-visita-sin-agendar', {
            method: 'PUT',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Visita actualizada exitosamente', 'success');

            // Cerrar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalEditarVisita'));
            modal.hide();

            // Recargar la tabla
            await cargarVisitasNoAsignadas();

        } else {
            console.error('Error del servidor:', resultado);
            mostrarAlerta(resultado.message || 'Error actualizando la visita', 'danger');
        }

    } catch (error) {
        console.error('Error guardando cambios:', error);
        mostrarAlerta('Error conectando con el servidor', 'danger');
    }
}

// Función para eliminar un archivo PDF
async function eliminarArchivoPdf(archivoId) {
    try {
        if (!confirm('¿Estás seguro de que deseas eliminar este archivo?')) {
            return;
        }

        const response = await fetch(`/api/archivos-pdf/${archivoId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Error al eliminar archivo');
        }

        const resultado = await response.json();

        if (resultado.success) {
            // Eliminar elemento del DOM
            const archivoElemento = document.querySelector(`[data-archivo-id="${archivoId}"]`);
            if (archivoElemento) {
                archivoElemento.remove();
            }

            // Verificar si quedan archivos
            const container = document.getElementById('archivosExistentesContainer');
            const archivosRestantes = container.querySelectorAll('[data-archivo-id]');
            if (archivosRestantes.length === 0) {
                container.innerHTML = '<p class="text-muted small">No hay archivos adjuntos</p>';
            }

            mostrarAlerta('Archivo eliminado exitosamente', 'success');
        } else {
            mostrarAlerta(resultado.message || 'Error al eliminar archivo', 'danger');
        }
    } catch (error) {
        console.error('Error eliminando archivo:', error);
        mostrarAlerta('Error al eliminar archivo', 'danger');
    }
}

// Mostrar foto completa en modal
function mostrarFotoCompleta(rutaFoto, descripcion) {
    // Crear modal temporal para mostrar la foto
    const modalHtml = `
        <div class="modal fade" id="modalFotoCompleta" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-camera"></i> ${descripcion}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body text-center">
                        <img src="${rutaFoto}" class="img-fluid" alt="${descripcion}" style="max-height: 70vh;">
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                        <a href="${rutaFoto}" download class="btn btn-primary">
                            <i class="fas fa-download"></i> Descargar
                        </a>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Eliminar modal existente si existe
    const modalExistente = document.getElementById('modalFotoCompleta');
    if (modalExistente) {
        modalExistente.remove();
    }

    // Agregar modal al body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalFotoCompleta'));
    modal.show();
}

// Generar PDF del reporte
async function generarPdfReporte(reporteId, clienteNombre) {
    try {
        if (!reporteId || reporteId === 'null') {
            mostrarAlerta('No se puede generar PDF: ID de reporte no válido', 'warning');
            return;
        }

        // Mostrar indicador de carga
        const btnPdf = event.target;
        const textoOriginal = btnPdf.innerHTML;
        btnPdf.disabled = true;
        btnPdf.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando PDF...';

        const response = await fetch(`/api/reportes/${reporteId}/pdf`, {
            method: 'GET'
        });

        if (response.ok) {
            // Crear un enlace temporal para descargar el PDF
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Reporte_${clienteNombre.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            mostrarAlerta('PDF generado y descargado exitosamente', 'success');
        } else {
            const error = await response.json();
            mostrarAlerta(error.message || 'Error generando el PDF', 'danger');
        }

    } catch (error) {
        console.error('Error generando PDF:', error);
        mostrarAlerta('Error conectando con el servidor', 'danger');
    } finally {
        // Restaurar botón
        const btnPdf = event.target;
        btnPdf.disabled = false;
        btnPdf.innerHTML = textoOriginal;
    }
}

// Función para ordenar la tabla de visitas sin asignar
function ordenarTabla(columna) {
    // Si se hace clic en la misma columna, cambiar dirección
    if (ordenActual.columna === columna) {
        ordenActual.direccion = ordenActual.direccion === 'asc' ? 'desc' : 'asc';
    } else {
        // Nueva columna, ordenar ascendente por defecto
        ordenActual.columna = columna;
        ordenActual.direccion = 'asc';
    }

    // Limpiar todos los íconos de ordenamiento
    document.querySelectorAll('#tablaVisitasSinAsignar .fas.fa-sort, #tablaVisitasSinAsignar .fas.fa-sort-up, #tablaVisitasSinAsignar .fas.fa-sort-down')
        .forEach(icon => {
            icon.className = 'fas fa-sort';
        });

    // Actualizar ícono de la columna actual
    const sortIcon = document.getElementById(`sort-${columna}`);
    if (sortIcon) {
        sortIcon.className = `fas fa-sort-${ordenActual.direccion === 'asc' ? 'up' : 'down'}`;
    }

    // Ordenar el array de visitas
    visitasProgramadas.sort((a, b) => {
        let valorA, valorB;

        switch (columna) {
            case 'cliente':
                valorA = a.cliente_nombre.toLowerCase();
                valorB = b.cliente_nombre.toLowerCase();
                break;
            case 'fecha':
                valorA = new Date(a.fecha_programada);
                valorB = new Date(b.fecha_programada);
                break;
            case 'localidad':
                valorA = (a.localidad || 'Sin especificar').toLowerCase();
                valorB = (b.localidad || 'Sin especificar').toLowerCase();
                break;
            case 'motivo':
                valorA = (a.motivo_visita || 'Sin especificar').toLowerCase();
                valorB = (b.motivo_visita || 'Sin especificar').toLowerCase();
                break;
            case 'observaciones':
                valorA = (a.observacion || 'Sin observación').toLowerCase();
                valorB = (b.observacion || 'Sin observación').toLowerCase();
                break;
            default:
                return 0;
        }

        if (valorA < valorB) {
            return ordenActual.direccion === 'asc' ? -1 : 1;
        }
        if (valorA > valorB) {
            return ordenActual.direccion === 'asc' ? 1 : -1;
        }
        return 0;
    });

    // Actualizar la tabla
    actualizarTablaVisitas();
}

// Función para actualizar estadísticas con datos reales de la base de datos
async function actualizarEstadisticas() {
    try {
        const response = await fetch('/api/estadisticas-visitas');
        const resultado = await response.json();

        if (resultado.success) {
            const statProgramadas = document.getElementById('statProgramadas');
            const statAsignadas = document.getElementById('statAsignadas');
            const statProgreso = document.getElementById('statProgreso');
            const statCompletadas = document.getElementById('statCompletadas');

            if (statProgramadas && statAsignadas && statProgreso && statCompletadas) {
                statProgramadas.textContent = resultado.estadisticas.programada || 0;
                statAsignadas.textContent = resultado.estadisticas.asignada || 0;
                statProgreso.textContent = resultado.estadisticas.en_progreso || 0;

                // Obtener y mostrar visitas completadas del día
                actualizarCompletadasHoy();

                console.log('📊 Estadísticas reales cargadas:', resultado.estadisticas);
            }
        } else {
            console.error('Error obteniendo estadísticas:', resultado.message);
            // Fallback a estadísticas locales
            actualizarEstadisticasLocales();
        }
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
        // Fallback a estadísticas locales
        actualizarEstadisticasLocales();
    }
}

// Función de fallback para estadísticas locales
function actualizarEstadisticasLocales() {
    const statProgramadas = document.getElementById('statProgramadas');
    const statAsignadas = document.getElementById('statAsignadas');
    const statProgreso = document.getElementById('statProgreso');
    const statCompletadas = document.getElementById('statCompletadas');

    if (statProgramadas && statAsignadas && statProgreso) {
        const programadas = visitasProgramadas.filter(v => v.estado === 'programada').length;
        const asignadas = visitasProgramadas.filter(v => v.estado === 'asignada').length;
        const enProgreso = visitasProgramadas.filter(v => v.estado === 'en_progreso').length;

        statProgramadas.textContent = programadas;
        statAsignadas.textContent = asignadas;
        statProgreso.textContent = enProgreso;

        // También actualizar completadas del día desde el servidor
        if (statCompletadas) {
            actualizarCompletadasHoy();
        }

        console.log('📊 Estadísticas locales actualizadas:', { programadas, asignadas, enProgreso });
    }
}

// Función para actualizar solo las completadas del día
async function actualizarCompletadasHoy() {
    try {
        const response = await fetch('/api/visitas-completadas-hoy');
        const resultado = await response.json();

        const statCompletadas = document.getElementById('statCompletadas');
        if (statCompletadas) {
            const completadasHoy = resultado.success ? resultado.visitas.length : 0;
            statCompletadas.textContent = completadasHoy;
            console.log('📊 Completadas hoy actualizadas:', completadasHoy);
        }
    } catch (error) {
        console.error('Error actualizando completadas del día:', error);
        const statCompletadas = document.getElementById('statCompletadas');
        if (statCompletadas) {
            statCompletadas.textContent = '0';
        }
    }
}

// ===== NUEVAS FUNCIONES PARA ACCIONES MEJORADAS =====

// Duplicar visita
async function duplicarVisita(visitaId) {
    try {
        const visita = visitasProgramadas.find(v => v.id === visitaId);
        if (!visita) {
            mostrarAlerta('Visita no encontrada', 'danger');
            return;
        }

        if (confirm(`¿Duplicar la visita de ${visita.cliente_nombre}?`)) {
            const response = await fetch('/api/visitas-tecnicas/duplicar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    visitaId: visitaId,
                    nuevaFecha: obtenerFechaSiguiente()
                })
            });

            const resultado = await response.json();
            if (resultado.success) {
                mostrarAlerta('Visita duplicada exitosamente', 'success');
                await cargarVisitasPendientes();
            } else {
                mostrarAlerta(resultado.message || 'Error duplicando visita', 'danger');
            }
        }
    } catch (error) {
        console.error('Error duplicando visita:', error);
        mostrarAlerta('Error duplicando la visita', 'danger');
    }
}

// Marcar visita en progreso
async function marcarEnProgreso(visitaId) {
    try {
        const visita = visitasProgramadas.find(v => v.id === visitaId);
        if (!visita) {
            mostrarAlerta('Visita no encontrada', 'danger');
            return;
        }

        if (confirm(`¿Marcar como "En Progreso" la visita de ${visita.cliente_nombre}?`)) {
            const response = await fetch(`/api/visitas-tecnicas/${visitaId}/progreso`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const resultado = await response.json();
            if (resultado.success) {
                mostrarAlerta('Visita marcada en progreso', 'success');
                await cargarVisitasPendientes();
            } else {
                mostrarAlerta(resultado.message || 'Error actualizando estado', 'danger');
            }
        }
    } catch (error) {
        console.error('Error marcando progreso:', error);
        mostrarAlerta('Error actualizando el estado', 'danger');
    }
}

// Ver progreso de visita
function verProgreso(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    const modal = `
        <div class="modal fade" id="modalProgreso" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-success text-white">
                        <h5 class="modal-title"><i class="fas fa-clock"></i> Progreso de Visita</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <h6><i class="fas fa-user"></i> Cliente: ${visita.cliente_nombre}</h6>
                            <p class="text-muted">${visita.cliente_direccion || 'Sin dirección'}</p>
                        </div>
                        <div class="progress mb-3">
                            <div class="progress-bar bg-success" style="width: 60%">60% Completado</div>
                        </div>
                        <div class="timeline">
                            <div class="timeline-item">
                                <i class="fas fa-check-circle text-success"></i>
                                <span>Visita asignada</span>
                                <small class="text-muted">${new Date(visita.fecha_creacion || Date.now()).toLocaleString()}</small>
                            </div>
                            <div class="timeline-item">
                                <i class="fas fa-play-circle text-info"></i>
                                <span>En progreso</span>
                                <small class="text-muted">Ahora</small>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);
    const modalElement = new bootstrap.Modal(document.getElementById('modalProgreso'));
    modalElement.show();

    // Limpiar modal al cerrar
    document.getElementById('modalProgreso').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

// Contactar cliente
function contactarCliente(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    const telefono = visita.cliente_telefono || visita.cliente_movil;
    if (!telefono) {
        mostrarAlerta('No hay número de teléfono disponible', 'warning');
        return;
    }

    const modal = `
        <div class="modal fade" id="modalContactar" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-info text-white">
                        <h5 class="modal-title"><i class="fas fa-phone"></i> Contactar Cliente</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <h6>${visita.cliente_nombre}</h6>
                            <p class="text-muted">Cédula: ${visita.cliente_cedula}</p>
                        </div>
                        <div class="d-grid gap-2">
                            ${visita.cliente_telefono ? `
                                <a href="tel:${visita.cliente_telefono}" class="btn btn-success">
                                    <i class="fas fa-phone"></i> Llamar Fijo: ${visita.cliente_telefono}
                                </a>
                            ` : ''}
                            ${visita.cliente_movil ? `
                                <a href="tel:${visita.cliente_movil}" class="btn btn-primary">
                                    <i class="fas fa-mobile-alt"></i> Llamar Móvil: ${visita.cliente_movil}
                                </a>
                                <a href="https://wa.me/${visita.cliente_movil.replace(/[^0-9]/g, '')}" target="_blank" class="btn btn-success">
                                    <i class="fab fa-whatsapp"></i> WhatsApp
                                </a>
                            ` : ''}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);
    const modalElement = new bootstrap.Modal(document.getElementById('modalContactar'));
    modalElement.show();

    // Limpiar modal al cerrar
    document.getElementById('modalContactar').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

// Observación urgente
function observacionUrgente(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    // Modal para observación urgente
    const modalHtml = `
        <div class="modal fade" id="modalObservacionUrgente" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-warning text-dark">
                        <h5 class="modal-title">
                            <i class="fas fa-exclamation-triangle me-2"></i>Observación Urgente
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning">
                            <strong>Cliente:</strong> ${visita.cliente_nombre || 'N/A'}<br>
                            <strong>Visita ID:</strong> ${visitaId}
                        </div>
                        <div class="mb-3">
                            <label class="form-label"><strong>Observación urgente:</strong></label>
                            <textarea class="form-control" id="observacionTexto" rows="4"
                                placeholder="Describe la situación urgente que requiere atención inmediata..."></textarea>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="notificarInmediato">
                            <label class="form-check-label" for="notificarInmediato">
                                Notificar inmediatamente por WhatsApp
                            </label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                        <button type="button" class="btn btn-warning" onclick="guardarObservacionUrgente(${visitaId})">
                            <i class="fas fa-save me-2"></i>Guardar Observación
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Agregar modal al DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalObservacionUrgente'));
    modal.show();

    // Limpiar modal al cerrar
    document.getElementById('modalObservacionUrgente').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}


// Ver detalles de visita
function verDetallesVisita(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    const modal = `
        <div class="modal fade" id="modalDetalles" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title"><i class="fas fa-eye"></i> Detalles de Visita</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <h6><i class="fas fa-user"></i> Información del Cliente</h6>
                                <p><strong>Nombre:</strong> ${visita.cliente_nombre}</p>
                                <p><strong>Cédula:</strong> ${visita.cliente_cedula}</p>
                                <p><strong>Teléfono:</strong> ${visita.cliente_telefono || 'No disponible'}</p>
                                <p><strong>Móvil:</strong> ${visita.cliente_movil || 'No disponible'}</p>
                                <p><strong>Dirección:</strong> ${visita.cliente_direccion || 'No disponible'}</p>
                            </div>
                            <div class="col-md-6">
                                <h6><i class="fas fa-calendar"></i> Información de la Visita</h6>
                                <p><strong>Fecha programada:</strong> ${new Date(visita.fecha_programada).toLocaleDateString()}</p>
                                <p><strong>Estado:</strong> <span class="badge status-${visita.estado}">${visita.estado.replace('_', ' ')}</span></p>
                                <p><strong>Técnico asignado:</strong> ${visita.tecnico_nombre || visita.tecnico_asignado_nombre || 'No asignado'}</p>
                                <p><strong>Motivo:</strong> ${visita.motivo_visita}</p>
                                <p><strong>MikroTik:</strong> ${visita.mikrotik_nombre || 'No especificado'}</p>
                                <p><strong>Usuario PPP:</strong> ${visita.usuario_ppp || 'No disponible'}</p>
                            </div>
                        </div>
                        ${visita.notas_admin ? `
                            <div class="mt-3">
                                <h6><i class="fas fa-sticky-note"></i> Observaciones</h6>
                                <div class="alert alert-info">${visita.notas_admin}</div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
                        <button type="button" class="btn btn-primary" onclick="editarVisita(${visitaId})">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);
    const modalElement = new bootstrap.Modal(document.getElementById('modalDetalles'));
    modalElement.show();

    // Limpiar modal al cerrar
    document.getElementById('modalDetalles').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

// Imprimir orden de trabajo
function imprimirOrden(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    const ventanaImpresion = window.open('', '_blank');
    ventanaImpresion.document.write(`
        <html>
        <head>
            <title>Orden de Trabajo - ${visita.cliente_nombre}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
                .section { margin: 20px 0; }
                .label { font-weight: bold; }
                @media print { .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>SolucNet - Orden de Trabajo</h1>
                <p>ID: ${visita.id} | Fecha: ${new Date().toLocaleDateString()}</p>
            </div>

            <div class="section">
                <h3>Cliente</h3>
                <p><span class="label">Nombre:</span> ${visita.cliente_nombre}</p>
                <p><span class="label">Cédula:</span> ${visita.cliente_cedula}</p>
                <p><span class="label">Teléfono:</span> ${visita.cliente_telefono || 'No disponible'}</p>
                <p><span class="label">Dirección:</span> ${visita.cliente_direccion || 'No disponible'}</p>
            </div>

            <div class="section">
                <h3>Trabajo a Realizar</h3>
                <p><span class="label">Motivo:</span> ${visita.motivo_visita}</p>
                <p><span class="label">Fecha programada:</span> ${new Date(visita.fecha_programada).toLocaleDateString()}</p>
                ${visita.observacion ? `<p><span class="label">Observaciones:</span> ${visita.observacion}</p>` : ''}
            </div>

            <div class="section no-print">
                <button onclick="window.print()">Imprimir</button>
                <button onclick="window.close()">Cerrar</button>
            </div>
        </body>
        </html>
    `);
    ventanaImpresion.document.close();
}

// Exportar visita
function exportarVisita(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    const datos = {
        id: visita.id,
        cliente: visita.cliente_nombre,
        cedula: visita.cliente_cedula,
        telefono: visita.cliente_telefono,
        movil: visita.cliente_movil,
        direccion: visita.cliente_direccion,
        fecha_programada: visita.fecha_programada,
        motivo: visita.motivo_visita,
        estado: visita.estado,
        mikrotik: visita.mikrotik_nombre,
        usuario_ppp: visita.usuario_ppp,
        observaciones: visita.observacion
    };

    const dataStr = JSON.stringify(datos, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `visita_${visita.id}_${visita.cliente_nombre.replace(/\s+/g, '_')}.json`;
    link.click();

    mostrarAlerta('Archivo exportado exitosamente', 'success');
}

// Función auxiliar para obtener fecha siguiente
function obtenerFechaSiguiente() {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + 1);
    return fecha.toISOString().split('T')[0];
}

// ===== FUNCIONES DE ASIGNACIÓN MASIVA DE TÉCNICO =====

// Mostrar modal de asignación masiva
function mostrarModalAsignacionMasiva() {
    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada && v.estado === 'programada');

    if (visitasSeleccionadas.length === 0) {
        mostrarAlerta('Selecciona al menos una visita programada para asignar técnico', 'warning');
        return;
    }

    // Actualizar contador y lista de visitas
    document.getElementById('contadorVisitasSeleccionadas').textContent = visitasSeleccionadas.length;

    const listaContainer = document.getElementById('listaVisitasSeleccionadas');
    const listaHtml = visitasSeleccionadas.map(visita => `
        <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-white rounded border">
            <div>
                <strong>${visita.cliente_nombre}</strong>
                <br><small class="text-muted">
                    <i class="fas fa-calendar"></i> ${formatearFechaLocal(visita.fecha_programada)}
                    | <i class="fas fa-tools"></i> ${visita.motivo_visita}
                </small>
            </div>
            <span class="badge bg-warning">Programada</span>
        </div>
    `).join('');

    listaContainer.innerHTML = listaHtml;

    // Cargar técnicos disponibles
    cargarTecnicosDisponibles('tecnicoAsignarMasivo');

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalAsignarMasivo'));
    modal.show();
}

// Cargar técnicos disponibles en un select
async function cargarTecnicosDisponibles(selectId) {
    const select = document.getElementById(selectId);

    try {
        console.log('🔄 Cargando técnicos reales para asignación masiva...');

        // FORZAR CARGA FRESCA - NO usar cache
        console.log('🔄 Forzando carga fresca de técnicos (sin cache)...');
        tecnicosDisponibles = []; // Limpiar cache

        // Obtener técnicos de la API
        console.log('📡 Obteniendo técnicos de la API...');

        // Crear timeout para evitar colgadas
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch('/api/tecnicos', {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();

        if (resultado.success && resultado.tecnicos) {
            console.log('✅ Técnicos obtenidos de la API:', resultado.tecnicos.length);
            tecnicosDisponibles = resultado.tecnicos; // Actualizar variable global

            let opciones = '<option value="">Seleccionar técnico...</option>';
            resultado.tecnicos.forEach(tecnico => {
                opciones += `<option value="${tecnico.id}" data-nombre="${tecnico.nombre}" data-telefono="${tecnico.telefono}">
                    ${tecnico.nombre} - ${tecnico.especialidad || 'Técnico'} (${tecnico.telefono})
                </option>`;
            });

            select.innerHTML = opciones;
        } else {
            console.error('❌ Error del servidor:', resultado.message);
            select.innerHTML = '<option value="">No hay técnicos disponibles</option>';
            mostrarAlerta('No se encontraron técnicos disponibles', 'warning');
        }

    } catch (error) {
        console.error('❌ Error cargando técnicos:', error);

        if (error.name === 'AbortError') {
            select.innerHTML = '<option value="">Timeout cargando técnicos</option>';
            mostrarAlerta('Timeout cargando técnicos. Verifique la conexión.', 'warning');
        } else {
            select.innerHTML = '<option value="">Error cargando técnicos</option>';
            mostrarAlerta('Error cargando técnicos disponibles: ' + error.message, 'danger');
        }
    }
}

// Confirmar asignación masiva de técnico
async function confirmarAsignacionMasiva() {
    const tecnicoId = document.getElementById('tecnicoAsignarMasivo').value;
    const notasAdicionales = document.getElementById('notasAsignacionMasiva').value;

    if (!tecnicoId) {
        mostrarAlerta('Selecciona un técnico para asignar', 'warning');
        return;
    }

    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada && v.estado === 'programada');

    if (visitasSeleccionadas.length === 0) {
        mostrarAlerta('No hay visitas programadas seleccionadas', 'warning');
        return;
    }

    const tecnicoSelect = document.getElementById('tecnicoAsignarMasivo');
    const tecnicoNombre = tecnicoSelect.options[tecnicoSelect.selectedIndex].dataset.nombre;

    const confirmacion = confirm(
        `¿Confirmas la asignación de ${visitasSeleccionadas.length} visitas al técnico ${tecnicoNombre}?`
    );

    if (!confirmacion) return;

    // Mostrar indicador de carga
    const btnConfirmar = document.querySelector('#modalAsignarMasivo .btn-warning');
    if (!btnConfirmar) {
        console.error('❌ No se pudo encontrar el botón de confirmación');
        mostrarAlerta('Error: No se encontró el botón de confirmación', 'danger');
        return;
    }
    const textoOriginal = btnConfirmar.innerHTML;
    btnConfirmar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Asignando...';
    btnConfirmar.disabled = true;

    try {
        console.log(`🔄 Iniciando asignación masiva de ${visitasSeleccionadas.length} visitas al técnico ${tecnicoNombre}`);

        let asignacionesExitosas = 0;
        let asignacionesFallidas = 0;
        let notificacionesExitosas = 0;
        let notificacionesFallidas = 0;
        const errores = [];
        const clientesNoNotificados = [];

        // Asignar cada visita individualmente SIN enviar notificación automáticamente
        for (const visita of visitasSeleccionadas) {
            try {
                console.log(`📋 Asignando visita ID ${visita.id} de ${visita.cliente_nombre}`);

                const response = await fetch(`/api/visitas-tecnicas/${visita.id}/asignar`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        tecnicoId,
                        enviarNotificacion: false // NO enviar notificación automáticamente
                    })
                });

                const resultado = await response.json();

                if (resultado.success) {
                    console.log(`✅ Visita ${visita.id} asignada exitosamente`);

                    // Rastrear si el cliente NO ha sido notificado (según BD)
                    if (!resultado.clienteNotificado) {
                        clientesNoNotificados.push({
                            id: visita.id,
                            nombre: visita.cliente_nombre,
                            telefono: visita.cliente_telefono || visita.cliente_movil,
                            fecha: visita.fecha_programada
                        });
                        console.log(`📋 Cliente NO notificado: ${visita.cliente_nombre}`);
                    } else {
                        console.log(`✅ Cliente ya había sido notificado: ${visita.cliente_nombre}`);
                    }

                    // Actualizar datos locales
                    visita.estado = 'asignada';
                    visita.tecnico_id = parseInt(tecnicoId);
                    visita.tecnico_nombre = tecnicoNombre;
                    visita.tecnico_asignado_id = parseInt(tecnicoId);
                    visita.tecnico_asignado_nombre = tecnicoNombre;
                    visita.seleccionada = false;

                    // Agregar notas adicionales si las hay
                    if (notasAdicionales) {
                        visita.notas_admin = (visita.notas_admin || '') +
                            (visita.notas_admin ? '\n' : '') +
                            `[Asignación masiva] ${notasAdicionales}`;
                    }

                    asignacionesExitosas++;
                } else {
                    console.error(`❌ Error asignando visita ${visita.id}:`, resultado.message);
                    errores.push(`${visita.cliente_nombre}: ${resultado.message}`);
                    asignacionesFallidas++;
                }

                // Pequeña pausa entre asignaciones para no sobrecargar el servidor
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`❌ Error en asignación de visita ${visita.id}:`, error);
                errores.push(`${visita.cliente_nombre}: Error de conexión`);
                asignacionesFallidas++;
            }
        }

        // Actualizar tabla con los cambios
        actualizarTablaVisitas();

        // Cerrar modal
        bootstrap.Modal.getInstance(document.getElementById('modalAsignarMasivo')).hide();

        // Limpiar formulario
        document.getElementById('formAsignarMasivo').reset();

        // Mostrar resultado
        if (asignacionesExitosas > 0 && asignacionesFallidas === 0) {
            let mensaje = `✅ ${asignacionesExitosas} visitas asignadas exitosamente al técnico ${tecnicoNombre}`;
            mostrarAlerta(mensaje, 'success');

            // Si hay clientes no notificados, preguntar si desea enviar notificaciones
            if (clientesNoNotificados.length > 0) {
                console.log(`📋 ${clientesNoNotificados.length} cliente(s) NO han sido notificados`);

                // Esperar un momento para que se muestre la alerta de éxito
                setTimeout(() => {
                    const nombresClientes = clientesNoNotificados.map(c => `• ${c.nombre}`).join('\n');
                    const confirmarEnvio = confirm(
                        `⚠️ ATENCIÓN: ${clientesNoNotificados.length} cliente(s) NO han sido notificados:\n\n${nombresClientes}\n\n` +
                        `¿Deseas enviar las notificaciones de la visita a estos clientes ahora?`
                    );

                    if (confirmarEnvio) {
                        console.log('✅ Usuario confirmó enviar notificaciones');
                        // Seleccionar solo las visitas no notificadas y enviar notificaciones
                        enviarNotificacionesClientesNoNotificados(clientesNoNotificados);
                    } else {
                        console.log('❌ Usuario canceló el envío de notificaciones');
                        mostrarAlerta(
                            `⚠️ Los clientes no fueron notificados. Recuerda notificarlos manualmente.`,
                            'warning'
                        );
                    }
                }, 500);
            }
        } else if (asignacionesExitosas > 0 && asignacionesFallidas > 0) {
            let mensaje = `⚠️ ${asignacionesExitosas} visitas asignadas exitosamente, ${asignacionesFallidas} fallaron`;

            if (errores.length > 0) {
                mensaje += `\n\n❌ Errores de asignación:\n${errores.join('\n')}`;
            }

            mostrarAlerta(mensaje, 'warning');

            // Si hay clientes no notificados, preguntar si desea enviar notificaciones
            if (clientesNoNotificados.length > 0) {
                setTimeout(() => {
                    const nombresClientes = clientesNoNotificados.map(c => `• ${c.nombre}`).join('\n');
                    const confirmarEnvio = confirm(
                        `⚠️ ATENCIÓN: ${clientesNoNotificados.length} cliente(s) NO han sido notificados:\n\n${nombresClientes}\n\n` +
                        `¿Deseas enviar las notificaciones de la visita a estos clientes ahora?`
                    );

                    if (confirmarEnvio) {
                        enviarNotificacionesClientesNoNotificados(clientesNoNotificados);
                    }
                }, 500);
            }
        } else {
            mostrarAlerta(
                `❌ No se pudo asignar ninguna visita.<br>Errores: ${errores.join(', ')}`,
                'danger'
            );
        }

        console.log(`📊 Resumen asignación masiva: ${asignacionesExitosas} exitosas, ${asignacionesFallidas} fallidas`);

    } catch (error) {
        console.error('❌ Error general en asignación masiva:', error);
        mostrarAlerta('Error al asignar técnico masivamente', 'danger');
    } finally {
        // Restaurar botón si existe
        if (btnConfirmar) {
            btnConfirmar.innerHTML = textoOriginal;
            btnConfirmar.disabled = false;
        }
    }
}

// Función para enviar notificaciones a clientes no notificados
async function enviarNotificacionesClientesNoNotificados(clientesNoNotificados) {
    console.log('📱 Iniciando envío de notificaciones a clientes no notificados:', clientesNoNotificados);

    // Buscar las visitas en visitasProgramadas que corresponden a los clientes no notificados
    const visitasANotificar = visitasProgramadas.filter(visita =>
        clientesNoNotificados.some(cliente => cliente.id === visita.id)
    );

    if (visitasANotificar.length === 0) {
        console.warn('⚠️ No se encontraron visitas para notificar');
        mostrarAlerta('No se encontraron visitas para notificar', 'warning');
        return;
    }

    console.log(`📋 ${visitasANotificar.length} visita(s) encontradas para notificar`);

    // Marcar las visitas como seleccionadas temporalmente
    visitasANotificar.forEach(visita => {
        visita.seleccionada = true;
    });

    // Mostrar el modal de tipo de mensaje
    mostrarModalTipoMensaje(visitasANotificar);
}

// ===== FUNCIONES PARA MOSTRAR VISITAS POR ESTADO =====

// Mostrar visitas programadas
async function mostrarVisitasProgramadas() {
    console.log('📋 Mostrando visitas programadas...');

    // Cambiar el título de la tabla
    const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
    if (titulo) {
        titulo.innerHTML = '<i class="fas fa-calendar-alt"></i> Visitas Programadas (Sin Asignar)';
    }

    // Cargar visitas no asignadas (que son las programadas sin técnico)
    await cargarVisitasNoAsignadas();

    mostrarAlerta('Mostrando visitas programadas sin asignar', 'info');
}

// Mostrar visitas asignadas
async function mostrarVisitasAsignadas() {
    console.log('📋 Mostrando visitas asignadas...');

    try {
        const response = await fetch('/api/visitas-asignadas');
        const resultado = await response.json();

        if (resultado.success) {
            // Cambiar el título de la tabla
            const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
            if (titulo) {
                titulo.innerHTML = '<i class="fas fa-user-check"></i> Visitas Asignadas a Técnicos';
            }

            // Actualizar datos y tabla
            visitasProgramadas = resultado.visitas.map(visita => ({
                ...visita,
                seleccionada: false
            }));

            actualizarTablaVisitas();

            // Mostrar botón de desasignar masivo solo en esta vista
            btnDesasignarMasivo.classList.remove('d-none');

            console.log('✅ Visitas asignadas cargadas:', visitasProgramadas.length);
            mostrarAlerta(`${visitasProgramadas.length} visitas asignadas encontradas`, 'success');
        } else {
            console.error('Error del servidor:', resultado.message);
            mostrarAlerta('Error cargando visitas asignadas: ' + resultado.message, 'danger');
        }
    } catch (error) {
        console.error('Error cargando visitas asignadas:', error);
        mostrarAlerta('Error cargando visitas asignadas', 'danger');
    }
}

// Mostrar visitas en progreso
async function mostrarVisitasEnProgreso() {
    console.log('📋 Mostrando visitas en progreso...');

    try {
        // Crear un AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout

        const response = await fetch('/api/visitas-en-progreso', {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();

        if (resultado.success) {
            // Cambiar el título de la tabla
            const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
            if (titulo) {
                titulo.innerHTML = '<i class="fas fa-cogs"></i> Visitas en Progreso';
            }

            // Actualizar datos y tabla
            visitasProgramadas = resultado.visitas.map(visita => ({
                ...visita,
                seleccionada: false
            }));

            actualizarTablaVisitas();

            // Ocultar botón de desasignar masivo en esta vista
            btnDesasignarMasivo.classList.add('d-none');

            console.log('✅ Visitas en progreso cargadas:', visitasProgramadas.length);
            mostrarAlerta(`${visitasProgramadas.length} visitas en progreso encontradas`, 'success');
        } else {
            console.error('Error del servidor:', resultado.message);
            mostrarAlerta('Error cargando visitas en progreso: ' + resultado.message, 'danger');
        }
    } catch (error) {
        console.error('Error cargando visitas en progreso:', error);

        if (error.name === 'AbortError') {
            mostrarAlerta('Timeout cargando visitas en progreso. Verifique la conexión.', 'warning');
        } else {
            mostrarAlerta('Error cargando visitas en progreso. Intentando método alternativo...', 'danger');

            // Método alternativo: mostrar un mensaje explicativo
            const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
            if (titulo) {
                titulo.innerHTML = '<i class="fas fa-cogs"></i> Visitas en Progreso (Error de Conectividad)';
            }

            // Limpiar tabla y mostrar mensaje
            visitasProgramadas = [];
            actualizarTablaVisitas();
        }
    }
}

// Mostrar visitas completadas del día actual
async function mostrarVisitasCompletadas() {
    console.log('📋 Mostrando visitas completadas del día actual...');

    try {
        // Crear un AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout

        const response = await fetch('/api/visitas-completadas-hoy', {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resultado = await response.json();

        if (resultado.success) {
            // Cambiar el título de la tabla
            const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
            if (titulo) {
                const hoy = new Date().toLocaleDateString('es-ES', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                titulo.innerHTML = `<i class="fas fa-check-circle"></i> Visitas Completadas Hoy (${hoy})`;
            }

            // Actualizar datos y tabla
            visitasProgramadas = resultado.visitas.map(visita => ({
                ...visita,
                seleccionada: false
            }));

            actualizarTablaVisitas();

            // Ocultar botón de desasignar masivo en esta vista
            btnDesasignarMasivo.classList.add('d-none');

            console.log('✅ Visitas completadas hoy cargadas:', visitasProgramadas.length);
            mostrarAlerta(`${visitasProgramadas.length} visitas completadas encontradas para hoy`, 'success');
        } else {
            console.error('Error del servidor:', resultado.message);
            mostrarAlerta('Error cargando visitas completadas: ' + resultado.message, 'danger');
        }
    } catch (error) {
        console.error('Error cargando visitas completadas:', error);

        if (error.name === 'AbortError') {
            mostrarAlerta('Timeout cargando visitas completadas. Verifique la conexión.', 'warning');
        } else {
            mostrarAlerta('Error cargando visitas completadas', 'danger');
        }
    }
}

// Función para volver a mostrar visitas sin asignar (vista por defecto)
async function mostrarVisitasSinAsignar() {
    console.log('📋 Regresando a vista de visitas sin asignar...');

    // Restaurar el título original
    const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
    if (titulo) {
        titulo.innerHTML = '<i class="fas fa-user-clock"></i> Visitas Sin Asignar';
    }

    // Ocultar botón de desasignar masivo en esta vista
    btnDesasignarMasivo.classList.add('d-none');

    // Cargar visitas no asignadas
    await cargarVisitasNoAsignadas();

    mostrarAlerta('Vista restaurada a visitas sin asignar', 'info');
}

// ===== FUNCIÓN PARA DESASIGNAR TÉCNICO =====

// Desasignar técnico de una visita
async function desasignarTecnico(visitaId) {
    const visita = visitasProgramadas.find(v => v.id === visitaId);
    if (!visita) {
        mostrarAlerta('Visita no encontrada', 'danger');
        return;
    }

    const tecnicoNombre = visita.tecnico_nombre || visita.tecnico_asignado_nombre || 'Técnico';
    const confirmacion = confirm(
        `¿Confirmas que deseas desasignar al técnico "${tecnicoNombre}" de la visita de ${visita.cliente_nombre}?\n\nLa visita regresará al estado "Programada" y estará disponible para ser asignada a otro técnico.`
    );

    if (!confirmacion) return;

    try {
        const response = await fetch('/api/desasignar-tecnico', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visita_id: visitaId
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(`✅ Técnico "${tecnicoNombre}" desasignado exitosamente. La visita regresó al estado "Programada".`, 'success');

            // Actualizar el estado local
            visita.estado = 'programada';
            visita.tecnico_asignado_id = null;
            visita.tecnico_asignado_nombre = null;
            visita.tecnico_nombre = null;
            visita.tecnico_telefono = null;

            // Recargar la vista actual para reflejar los cambios
            const titulo = document.querySelector('#tablaVisitas').closest('.card').querySelector('.card-header h5');
            if (titulo && titulo.innerHTML.includes('Asignadas')) {
                // Si estamos viendo visitas asignadas, recargar esa vista
                await mostrarVisitasAsignadas();
            } else {
                // Si no, actualizar la tabla actual
                actualizarTablaVisitas();
            }

            // Actualizar estadísticas
            actualizarEstadisticas();

        } else {
            mostrarAlerta(`❌ Error desasignando técnico: ${resultado.message}`, 'danger');
        }

    } catch (error) {
        console.error('Error desasignando técnico:', error);
        mostrarAlerta('❌ Error al desasignar técnico', 'danger');
    }
}

// Desasignar técnicos masivamente de visitas seleccionadas
async function desasignarMasivamente() {
    console.log('🗑️ Iniciando desasignación masiva...');

    // Obtener visitas seleccionadas
    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada);

    if (visitasSeleccionadas.length === 0) {
        mostrarAlerta('⚠️ No hay visitas seleccionadas para desasignar', 'warning');
        return;
    }

    // Confirmación
    const confirmacion = confirm(
        `¿Confirmas que deseas desasignar masivamente ${visitasSeleccionadas.length} visita(s)?\n\n` +
        `Las visitas regresarán al estado "Programada" y estarán disponibles para ser asignadas a otros técnicos.`
    );

    if (!confirmacion) return;

    try {
        // Obtener IDs de las visitas seleccionadas
        const visitasIds = visitasSeleccionadas.map(v => v.id);

        console.log('📍 Desasignando visitas:', visitasIds);

        // Enviar petición al servidor
        const response = await fetch('/api/desasignar-masivo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                visitas_ids: visitasIds
            })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(
                `✅ ${resultado.desasignadas} visita(s) desasignada(s) exitosamente.`,
                'success'
            );

            // Recargar la vista de visitas asignadas para reflejar los cambios
            await mostrarVisitasAsignadas();

            // Actualizar estadísticas
            actualizarEstadisticas();

        } else {
            mostrarAlerta(`❌ Error en desasignación masiva: ${resultado.message}`, 'danger');
        }

    } catch (error) {
        console.error('Error en desasignación masiva:', error);
        mostrarAlerta('❌ Error al desasignar visitas masivamente', 'danger');
    }
}

// ===== FUNCIONES PARA CLIENTES EXTERNOS (SOLUCNET.COM) =====

let configBDActual = null;
let clientesExternosData = []; // Array para guardar los clientes y poder ordenarlos
let ordenActualClientesExternos = { campo: 'id', direccion: 'desc' }; // Estado del ordenamiento (desc = mayor a menor)
let paginaActualClientesExternos = 1;
const clientesPorPagina = 10;

// Función para cargar la configuración de BD externa
async function cargarConfigBDExterna() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/config-bd-externa', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });
        const resultado = await response.json();

        if (resultado.success && resultado.config) {
            configBDActual = resultado.config;

            // Mostrar en la vista
            document.getElementById('viewNombre').textContent = resultado.config.nombre || '-';
            document.getElementById('viewHost').textContent = resultado.config.host || '-';
            document.getElementById('viewUsuario').textContent = resultado.config.usuario || '-';
            document.getElementById('viewBaseDatos').textContent = resultado.config.base_datos || '-';

            const ultimaSync = resultado.config.ultima_sincronizacion;
            document.getElementById('viewUltimaSync').textContent = ultimaSync
                ? new Date(ultimaSync).toLocaleString('es-CO')
                : 'Nunca';

            // Llenar el formulario de edición
            document.getElementById('configId').value = resultado.config.id || '';
            document.getElementById('inputNombre').value = resultado.config.nombre || '';
            document.getElementById('inputHost').value = resultado.config.host || '';
            document.getElementById('inputUsuario').value = resultado.config.usuario || '';
            document.getElementById('inputBaseDatos').value = resultado.config.base_datos || '';
            document.getElementById('inputPuerto').value = resultado.config.puerto || 3306;
        } else {
            // No hay configuración, preparar formulario para crear nueva
            document.getElementById('configId').value = '';
            document.getElementById('viewNombre').textContent = 'Sin configurar';
            document.getElementById('viewHost').textContent = '-';
            document.getElementById('viewUsuario').textContent = '-';
            document.getElementById('viewBaseDatos').textContent = '-';
            document.getElementById('viewUltimaSync').textContent = 'Nunca';
        }
    } catch (error) {
        console.error('Error cargando configuración BD externa:', error);
        // En caso de error, asegurar que configId esté vacío
        document.getElementById('configId').value = '';
    }
}

// Función para toggle entre vista y formulario de configuración
function toggleConfigBD() {
    const vista = document.getElementById('configBDView');
    const form = document.getElementById('configBDForm');

    if (vista.style.display === 'none') {
        vista.style.display = 'block';
        form.style.display = 'none';
    } else {
        vista.style.display = 'none';
        form.style.display = 'block';
    }
}

// Manejador del formulario de configuración BD
document.getElementById('formConfigBD')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const configId = document.getElementById('configId').value;
    const datos = {
        nombre: document.getElementById('inputNombre').value,
        host: document.getElementById('inputHost').value,
        usuario: document.getElementById('inputUsuario').value,
        base_datos: document.getElementById('inputBaseDatos').value,
        puerto: parseInt(document.getElementById('inputPuerto').value)
    };

    // Solo incluir password si se ingresó uno nuevo
    const password = document.getElementById('inputPassword').value;
    if (password) {
        datos.password = password;
    }

    try {
        // Si no hay configId o está vacío, usar una ruta sin ID para que el backend cree uno nuevo
        const url = (configId && configId !== '' && configId !== 'undefined')
            ? `/api/config-bd-externa/${configId}`
            : `/api/config-bd-externa/0`;

        const token = localStorage.getItem('token');
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include',
            body: JSON.stringify(datos)
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('✅ Configuración actualizada correctamente', 'success');
            toggleConfigBD();
            cargarConfigBDExterna();

            // Limpiar password
            document.getElementById('inputPassword').value = '';
        } else {
            mostrarAlerta(`❌ Error: ${resultado.message}`, 'danger');
        }
    } catch (error) {
        console.error('Error actualizando configuración:', error);
        mostrarAlerta('❌ Error al actualizar configuración', 'danger');
    }
});

// Función para probar la conexión a la BD externa
async function probarConexionBD() {
    const datos = {
        host: document.getElementById('inputHost').value,
        usuario: document.getElementById('inputUsuario').value,
        password: document.getElementById('inputPassword').value,
        base_datos: document.getElementById('inputBaseDatos').value,
        puerto: parseInt(document.getElementById('inputPuerto').value)
    };

    // Validar que todos los campos estén completos
    if (!datos.host || !datos.usuario || !datos.password || !datos.base_datos) {
        mostrarAlerta('❌ Por favor completa todos los campos antes de probar la conexión', 'warning');
        return;
    }

    try {
        // Mostrar mensaje de carga
        mostrarAlerta('🔄 Probando conexión a la base de datos...', 'info');

        const token = localStorage.getItem('token');
        const response = await fetch('/api/probar-conexion-bd-externa', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include',
            body: JSON.stringify(datos)
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(resultado.message, 'success');
        } else {
            mostrarAlerta(`❌ ${resultado.message}`, 'danger');
        }
    } catch (error) {
        console.error('Error probando conexión:', error);
        mostrarAlerta('❌ Error al probar la conexión', 'danger');
    }
}

// Función para sincronizar clientes externos
async function sincronizarClientesExternos() {
    const btnSync = event.target;
    const textoOriginal = btnSync.innerHTML;

    try {
        btnSync.disabled = true;
        btnSync.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';

        const token = localStorage.getItem('token');
        const response = await fetch('/api/sincronizar-clientes-externos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(
                `✅ Sincronización completada: ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados (Total: ${resultado.total})`,
                'success'
            );

            // Recargar datos
            await cargarClientesExternos();
            await cargarEstadisticasClientesExternos();
            await cargarConfigBDExterna();
        } else {
            mostrarAlerta(`❌ Error en sincronización: ${resultado.message}`, 'danger');
        }
    } catch (error) {
        console.error('Error sincronizando clientes:', error);
        mostrarAlerta('❌ Error al sincronizar clientes externos', 'danger');
    } finally {
        btnSync.disabled = false;
        btnSync.innerHTML = textoOriginal;
    }
}

// Función para cargar estadísticas de clientes externos
async function cargarEstadisticasClientesExternos() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/estadisticas-clientes-externos', {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });
        const resultado = await response.json();

        if (resultado.success && resultado.estadisticas) {
            const stats = resultado.estadisticas;

            document.getElementById('statTotalExternos').textContent = stats.total || 0;
            document.getElementById('statActivosExternos').textContent = stats.activos || 0;
            document.getElementById('statInactivosExternos').textContent = stats.inactivos || 0;

            const ultimaSync = stats.config_ultima_sync;
            document.getElementById('statUltimaSyncExternos').textContent = ultimaSync
                ? new Date(ultimaSync).toLocaleString('es-CO')
                : 'Nunca';
        }
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

// Función para cargar clientes externos
async function cargarClientesExternos(filtros = {}) {
    try {
        const params = new URLSearchParams();
        if (filtros.estado) params.append('estado', filtros.estado);
        if (filtros.busqueda) params.append('busqueda', filtros.busqueda);

        const token = localStorage.getItem('token');
        const response = await fetch(`/api/clientes-externos?${params}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });
        const resultado = await response.json();

        if (resultado.success && resultado.clientes.length > 0) {
            // Guardar los datos para poder ordenarlos
            clientesExternosData = resultado.clientes;

            // Ordenar por ID de mayor a menor al cargar
            clientesExternosData.sort((a, b) => {
                return parseInt(b.id) - parseInt(a.id); // Mayor a menor
            });

            // Actualizar los iconos para reflejar el orden inicial
            actualizarIconosOrdenamiento('id');

            // Aplicar el ordenamiento actual
            aplicarOrdenClientesExternos();
        } else {
            clientesExternosData = [];
            const tbody = document.getElementById('tablaClientesExternos');
            tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No se encontraron clientes</td></tr>';
        }
    } catch (error) {
        console.error('Error cargando clientes externos:', error);
        document.getElementById('tablaClientesExternos').innerHTML =
            '<tr><td colspan="10" class="text-center text-danger">Error al cargar clientes</td></tr>';
    }
}

// Función para aplicar el ordenamiento y renderizar la tabla
function aplicarOrdenClientesExternos() {
    const tbody = document.getElementById('tablaClientesExternos');

    if (clientesExternosData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No hay clientes para mostrar</td></tr>';
        actualizarInfoPaginacion(0, 0, 0);
        document.getElementById('paginacionClientesExternos').innerHTML = '';
        return;
    }

    // Calcular paginación
    const totalClientes = clientesExternosData.length;
    const totalPaginas = Math.ceil(totalClientes / clientesPorPagina);

    // Asegurar que la página actual es válida
    if (paginaActualClientesExternos > totalPaginas) {
        paginaActualClientesExternos = totalPaginas;
    }
    if (paginaActualClientesExternos < 1) {
        paginaActualClientesExternos = 1;
    }

    const indiceFinal = paginaActualClientesExternos * clientesPorPagina;
    const indiceInicial = indiceFinal - clientesPorPagina;

    // Obtener clientes de la página actual
    const clientesPaginaActual = clientesExternosData.slice(indiceInicial, indiceFinal);

    // Renderizar tabla
    tbody.innerHTML = clientesPaginaActual.map(cliente => `
        <tr>
            <td>${cliente.id}</td>
            <td><strong>${cliente.nombre || cliente.movil || 'Sin nombre'}</strong></td>
            <td>${cliente.cedula || '-'}</td>
            <td>${cliente.telefono || '-'}</td>
            <td>${cliente.movil || '-'}</td>
            <td style="max-width: 300px; word-wrap: break-word;">${cliente.direccion || '-'}</td>
            <td style="max-width: 200px; word-wrap: break-word;">${cliente.email || '-'}</td>
            <td><span class="badge bg-info">${cliente.plan_contratado || '-'}</span></td>
            <td><small>${cliente.fecha_registro ? new Date(cliente.fecha_registro).toLocaleString('es-CO') : '-'}</small></td>
            <td style="white-space: nowrap;">
                <div class="d-flex flex-column gap-1">
                    <button class="btn btn-primary" onclick="registrarInstalacion(${cliente.id})" title="Registrar Instalación">
                        <i class="fas fa-tools"></i>
                    </button>
                    <button class="btn btn-success" onclick="agendarInstalacion(${cliente.id})" title="Agendar Instalación">
                        <i class="fas fa-calendar-plus"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // Actualizar información de paginación
    actualizarInfoPaginacion(indiceInicial + 1, Math.min(indiceFinal, totalClientes), totalClientes);

    // Renderizar controles de paginación
    renderizarPaginacion(totalPaginas);
}

// Función para actualizar la información de paginación
function actualizarInfoPaginacion(desde, hasta, total) {
    document.getElementById('clientesDesde').textContent = desde;
    document.getElementById('clientesHasta').textContent = hasta;
    document.getElementById('clientesTotal').textContent = total;
}

// Función para renderizar los controles de paginación
function renderizarPaginacion(totalPaginas) {
    const paginacion = document.getElementById('paginacionClientesExternos');

    if (totalPaginas <= 1) {
        paginacion.innerHTML = '';
        return;
    }

    let html = '';

    // Botón anterior
    html += `
        <li class="page-item ${paginaActualClientesExternos === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="cambiarPaginaClientesExternos(${paginaActualClientesExternos - 1}); return false;">
                <i class="fas fa-chevron-left"></i> Anterior
            </a>
        </li>
    `;

    // Números de página
    const maxBotones = 5;
    let paginaInicio = Math.max(1, paginaActualClientesExternos - Math.floor(maxBotones / 2));
    let paginaFin = Math.min(totalPaginas, paginaInicio + maxBotones - 1);

    if (paginaFin - paginaInicio < maxBotones - 1) {
        paginaInicio = Math.max(1, paginaFin - maxBotones + 1);
    }

    // Primera página si no está visible
    if (paginaInicio > 1) {
        html += `
            <li class="page-item">
                <a class="page-link" href="#" onclick="cambiarPaginaClientesExternos(1); return false;">1</a>
            </li>
        `;
        if (paginaInicio > 2) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }

    // Páginas del rango visible
    for (let i = paginaInicio; i <= paginaFin; i++) {
        html += `
            <li class="page-item ${i === paginaActualClientesExternos ? 'active' : ''}">
                <a class="page-link" href="#" onclick="cambiarPaginaClientesExternos(${i}); return false;">${i}</a>
            </li>
        `;
    }

    // Última página si no está visible
    if (paginaFin < totalPaginas) {
        if (paginaFin < totalPaginas - 1) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        html += `
            <li class="page-item">
                <a class="page-link" href="#" onclick="cambiarPaginaClientesExternos(${totalPaginas}); return false;">${totalPaginas}</a>
            </li>
        `;
    }

    // Botón siguiente
    html += `
        <li class="page-item ${paginaActualClientesExternos === totalPaginas ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="cambiarPaginaClientesExternos(${paginaActualClientesExternos + 1}); return false;">
                Siguiente <i class="fas fa-chevron-right"></i>
            </a>
        </li>
    `;

    paginacion.innerHTML = html;
}

// Función para cambiar de página
function cambiarPaginaClientesExternos(nuevaPagina) {
    paginaActualClientesExternos = nuevaPagina;
    aplicarOrdenClientesExternos();
}

// Función para ordenar la tabla de clientes externos
function ordenarTablaClientesExternos(campo) {
    // Si se hace clic en el mismo campo, invertir la dirección
    if (ordenActualClientesExternos.campo === campo) {
        ordenActualClientesExternos.direccion =
            ordenActualClientesExternos.direccion === 'asc' ? 'desc' : 'asc';
    } else {
        // Si es un campo nuevo, ordenar ascendente por defecto
        ordenActualClientesExternos.campo = campo;
        ordenActualClientesExternos.direccion = 'asc';
    }

    // Ordenar los datos
    clientesExternosData.sort((a, b) => {
        let valorA, valorB;

        switch (campo) {
            case 'id':
                valorA = parseInt(a.id);
                valorB = parseInt(b.id);
                break;
            case 'nombre':
                valorA = (a.nombre || '').toLowerCase();
                valorB = (b.nombre || '').toLowerCase();
                break;
            case 'fecha':
                valorA = new Date(a.fecha_registro || 0);
                valorB = new Date(b.fecha_registro || 0);
                break;
            default:
                return 0;
        }

        // Comparar según el tipo de dato
        let comparacion;
        if (typeof valorA === 'number') {
            comparacion = valorA - valorB;
        } else if (valorA instanceof Date) {
            comparacion = valorA - valorB;
        } else {
            comparacion = valorA.localeCompare(valorB);
        }

        // Aplicar dirección del ordenamiento
        return ordenActualClientesExternos.direccion === 'asc' ? comparacion : -comparacion;
    });

    // Actualizar los iconos en los headers
    actualizarIconosOrdenamiento(campo);

    // Resetear a la primera página al ordenar
    paginaActualClientesExternos = 1;

    // Re-renderizar la tabla
    aplicarOrdenClientesExternos();
}

// Función para actualizar los iconos de ordenamiento en los headers
function actualizarIconosOrdenamiento(campoActivo) {
    // Resetear todos los iconos
    const headers = document.querySelectorAll('thead th[onclick]');
    headers.forEach(th => {
        const icono = th.querySelector('i');
        if (icono) {
            icono.className = 'fas fa-sort';
        }
    });

    // Actualizar el icono del campo activo
    headers.forEach(th => {
        if (th.onclick && th.onclick.toString().includes(`'${campoActivo}'`)) {
            const icono = th.querySelector('i');
            if (icono) {
                icono.className = ordenActualClientesExternos.direccion === 'asc'
                    ? 'fas fa-sort-up'
                    : 'fas fa-sort-down';
            }
        }
    });
}

// Función para filtrar clientes externos
function filtrarClientesExternos() {
    const busqueda = document.getElementById('busquedaClientesExternos').value;
    const estado = document.getElementById('filtroEstadoExternos').value;

    // Resetear a la primera página al filtrar
    paginaActualClientesExternos = 1;

    cargarClientesExternos({
        busqueda: busqueda,
        estado: estado
    });
}

// Event listener para el tab de clientes externos
document.getElementById('clientes-externos-tab')?.addEventListener('shown.bs.tab', function () {
    cargarConfigBDExterna();
    cargarEstadisticasClientesExternos();
    cargarClientesExternos();
});

// Event listener para buscar al presionar Enter
document.getElementById('busquedaClientesExternos')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        filtrarClientesExternos();
    }
});

// Variable global para guardar el cliente seleccionado
let clienteSeleccionadoInstalacion = null;

// Función para registrar instalación
function registrarInstalacion(clienteId) {
    const cliente = clientesExternosData.find(c => c.id === clienteId);

    if (!cliente) {
        mostrarAlerta('❌ Cliente no encontrado', 'danger');
        return;
    }

    // Guardar el cliente seleccionado
    clienteSeleccionadoInstalacion = cliente;

    // Actualizar el modal con los datos del cliente
    document.getElementById('modalClienteNombre').textContent = cliente.nombre;
    document.getElementById('modalClienteCedula').textContent = cliente.cedula || '-';

    // Mostrar el modal
    const modal = new bootstrap.Modal(document.getElementById('modalSeleccionarBD'));
    modal.show();
}

// Variable global para cliente seleccionado para agendar
let clienteSeleccionadoAgendar = null;

// Función para agendar instalación
function agendarInstalacion(clienteId) {
    const cliente = clientesExternosData.find(c => c.id === clienteId);

    if (!cliente) {
        mostrarAlerta('❌ Cliente no encontrado', 'danger');
        return;
    }

    // Guardar el cliente seleccionado
    clienteSeleccionadoAgendar = cliente;

    // Actualizar el modal con los datos del cliente
    document.getElementById('modalAgendarClienteNombre').textContent = cliente.nombre;
    document.getElementById('modalAgendarClienteCedula').textContent = cliente.cedula || '-';

    // Resetear el input de otra zona y el archivo PDF
    document.getElementById('zonaOtraInput').value = '';
    document.getElementById('zonaOtraContainer').classList.add('d-none');
    document.getElementById('pdfInstalacion').value = '';

    // Mostrar el modal
    const modal = new bootstrap.Modal(document.getElementById('modalAgendarInstalacion'));
    modal.show();
}

// Función para confirmar zona "Otra"
async function confirmarZonaOtra() {
    const zonaOtra = document.getElementById('zonaOtraInput').value.trim();

    if (!zonaOtra) {
        mostrarAlerta('❌ Por favor ingrese el nombre de la localidad', 'warning');
        return;
    }

    await procesarAgendarInstalacion(zonaOtra.toUpperCase());
}

// Función para procesar el agendamiento de instalación
async function procesarAgendarInstalacion(zona) {
    // Validar que se haya seleccionado un PDF
    const pdfInput = document.getElementById('pdfInstalacion');
    if (!pdfInput.files || pdfInput.files.length === 0) {
        mostrarAlerta('❌ Debes adjuntar un PDF antes de continuar', 'danger');
        return;
    }

    const modal = bootstrap.Modal.getInstance(document.getElementById('modalAgendarInstalacion'));
    modal.hide();

    // Confirmar
    if (!confirm(`¿Confirmar agendamiento de instalación para ${clienteSeleccionadoAgendar.nombre} en zona ${zona}?`)) {
        return;
    }

    try {
        mostrarAlerta('📅 Agendando instalación...', 'info');

        const token = localStorage.getItem('token');

        // Crear FormData para enviar el archivo
        const formData = new FormData();
        formData.append('clienteId', clienteSeleccionadoAgendar.id);
        formData.append('zona', zona);
        formData.append('pdf_instalacion', pdfInput.files[0]);

        const response = await fetch('/api/agendar-instalacion', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include',
            body: formData
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(`✅ ${resultado.message}`, 'success');
            // Limpiar el input del PDF
            pdfInput.value = '';
        } else {
            mostrarAlerta(`❌ ${resultado.message}`, 'danger');
        }
    } catch (error) {
        console.error('Error agendando instalación:', error);
        mostrarAlerta('❌ Error al agendar instalación', 'danger');
    }
}

// Event listeners para los botones de zona
document.querySelectorAll('.zona-option').forEach(btn => {
    btn.addEventListener('click', async function() {
        const zona = this.getAttribute('data-zona');

        // Si es "OTRO", mostrar el input
        if (zona === 'OTRO') {
            document.getElementById('zonaOtraContainer').classList.remove('d-none');
            document.getElementById('zonaOtraInput').focus();
            return;
        }

        // Para las demás zonas, procesar directamente
        await procesarAgendarInstalacion(zona);
    });
});

// Event listeners para los botones de base de datos
document.querySelectorAll('.bd-option').forEach(btn => {
    btn.addEventListener('click', async function() {
        const baseDatos = this.getAttribute('data-bd');
        const nombreBD = this.querySelector('h6').textContent.trim();

        // Cerrar el modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('modalSeleccionarBD'));
        modal.hide();

        // Confirmar
        if (!confirm(`¿Confirmar registro de instalación en ${nombreBD}?`)) {
            return;
        }

        try {
            mostrarAlerta('🔄 Registrando instalación...', 'info');

            const token = localStorage.getItem('token');

            // Preparar notas con el plan del cliente
            console.log('📦 Cliente seleccionado:', clienteSeleccionadoInstalacion);
            console.log('📋 Plan contratado:', clienteSeleccionadoInstalacion.plan_contratado);

            let notas = '';
            if (clienteSeleccionadoInstalacion.plan_contratado) {
                notas = `Plan contratado: ${clienteSeleccionadoInstalacion.plan_contratado}`;
            }

            console.log('📝 Notas a enviar:', notas);

            const response = await fetch('/api/registrar-instalacion', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include',
                body: JSON.stringify({
                    clienteId: clienteSeleccionadoInstalacion.id,
                    baseDatos: baseDatos,
                    notas: notas
                })
            });

            const resultado = await response.json();

            if (resultado.success) {
                mostrarAlerta(`✅ ${resultado.message}`, 'success');
            } else {
                mostrarAlerta(`❌ ${resultado.message}`, 'danger');
            }
        } catch (error) {
            console.error('Error registrando instalación:', error);
            mostrarAlerta('❌ Error al registrar instalación', 'danger');
        }
    });
});

// ==================== FUNCIONES DE UBICACIÓN DE TÉCNICOS ====================

// Variable global para el mapa de ubicaciones
let mapaUbicaciones = null;
let grupoMarcadoresTecnicos = null; // LayerGroup para marcadores
let intervaloUbicacionesTecnicos = null;
let esPrimeraCargaUbicaciones = true; // Para centrar el mapa solo la primera vez

/**
 * Muestra el modal con las ubicaciones de los técnicos
 */
async function mostrarUbicacionesTecnicos() {
    const modal = new bootstrap.Modal(document.getElementById('modalUbicacionesTecnicos'));
    modal.show();

    // Resetear bandera para centrar el mapa cada vez que se abre el modal
    esPrimeraCargaUbicaciones = true;

    // Esperar a que el modal esté completamente visible antes de inicializar el mapa
    setTimeout(async () => {
        // Inicializar el mapa si aún no existe
        if (!mapaUbicaciones) {
            inicializarMapaUbicaciones();
        }

        // Cargar las ubicaciones al abrir el modal
        await cargarUbicacionesTecnicos();

        // Limpiar intervalo anterior si existe
        if (intervaloUbicacionesTecnicos) {
            clearInterval(intervaloUbicacionesTecnicos);
        }

        // Configurar actualización automática cada 10 segundos
        intervaloUbicacionesTecnicos = setInterval(async () => {
            console.log('🔄 Actualizando ubicaciones de técnicos...');
            await cargarUbicacionesTecnicos();
        }, 10000); // 10 segundos

        console.log('✅ Actualización automática cada 10 segundos configurada');
    }, 300);

    // Limpiar intervalo cuando se cierre el modal
    const modalElement = document.getElementById('modalUbicacionesTecnicos');
    modalElement.addEventListener('hidden.bs.modal', function() {
        if (intervaloUbicacionesTecnicos) {
            clearInterval(intervaloUbicacionesTecnicos);
            intervaloUbicacionesTecnicos = null;
            console.log('⏹️ Actualización automática detenida');
        }
    }, { once: true });
}

/**
 * Inicializa el mapa de Leaflet con capas base (normal y satélite)
 */
function inicializarMapaUbicaciones() {
    // NO reinicializar si ya existe - evita resetear el zoom
    if (mapaUbicaciones) {
        console.log('⚠️ Mapa de ubicaciones ya inicializado, saltando reinicialización');
        return;
    }

    // Crear el mapa centrado en Colombia (solo la primera vez)
    mapaUbicaciones = L.map('mapaUbicaciones').setView([7.8939, -76.2958], 13);

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

    // Capa satélite con etiquetas híbrida
    const capaHibrida = L.layerGroup([
        capaSatelite,
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 22,
            maxNativeZoom: 18
        })
    ]);

    // Agregar la capa por defecto (Vista Satélite)
    capaSatelite.addTo(mapaUbicaciones);

    // Control de capas para cambiar entre vistas
    const capasBase = {
        "Vista Normal": capaOSM,
        "Vista Satélite": capaSatelite,
        "Vista Híbrida": capaHibrida
    };

    L.control.layers(capasBase, null, {
        position: 'topright'
    }).addTo(mapaUbicaciones);

    // Agregar control de ubicación actual (botón azul)
    agregarControlUbicacionActual();

    // Crear LayerGroup para manejar marcadores de técnicos
    grupoMarcadoresTecnicos = L.layerGroup().addTo(mapaUbicaciones);

    console.log('✅ Mapa de ubicaciones inicializado');
}

/**
 * Agrega un botón de ubicación actual que muestra la posición en tiempo real
 */
function agregarControlUbicacionActual() {
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
    locateControl.addTo(mapaUbicaciones);

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
                    mapaUbicaciones.removeLayer(marcadorUbicacionActual);
                }
                if (circuloPrecision) {
                    mapaUbicaciones.removeLayer(circuloPrecision);
                }

                // Crear círculo de precisión
                circuloPrecision = L.circle([lat, lng], {
                    radius: precision,
                    color: '#4285F4',
                    fillColor: '#4285F4',
                    fillOpacity: 0.1,
                    weight: 1
                }).addTo(mapaUbicaciones);

                // Crear marcador de ubicación actual (punto azul)
                marcadorUbicacionActual = L.circleMarker([lat, lng], {
                    radius: 8,
                    fillColor: '#4285F4',
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 1
                }).addTo(mapaUbicaciones);

                // Centrar mapa SOLO en la primera ubicación, después solo actualizar marcador
                if (esPrimeraUbicacion) {
                    mapaUbicaciones.setView([lat, lng], 16);
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

        console.log('✅ Seguimiento de ubicación iniciado');
    }

    function detenerSeguimiento() {
        siguiendoUbicacion = false;

        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }

        // Remover marcadores
        if (marcadorUbicacionActual) {
            mapaUbicaciones.removeLayer(marcadorUbicacionActual);
            marcadorUbicacionActual = null;
        }
        if (circuloPrecision) {
            mapaUbicaciones.removeLayer(circuloPrecision);
            circuloPrecision = null;
        }

        console.log('⏹️ Seguimiento de ubicación detenido');
    }
}

/**
 * Carga y muestra las últimas ubicaciones de todos los técnicos
 */
async function cargarUbicacionesTecnicos() {
    const container = document.getElementById('ubicacionesTecnicosContainer');

    try {
        // Mostrar loader
        container.innerHTML = `
            <div class="text-center py-3">
                <div class="spinner-border text-primary spinner-border-sm" role="status">
                    <span class="visually-hidden">Cargando ubicaciones...</span>
                </div>
                <small class="ms-2">Actualizando ubicaciones...</small>
            </div>
        `;

        const response = await fetch('/api/tecnicos/ubicaciones', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || 'Error al obtener ubicaciones');
        }

        const ubicaciones = data.ubicaciones || [];

        if (ubicaciones.length === 0) {
            container.innerHTML = `
                <div class="alert alert-warning mt-3" role="alert">
                    <i class="fas fa-info-circle"></i> No hay ubicaciones de técnicos disponibles en este momento.
                </div>
            `;
            return;
        }

        // Limpiar marcadores anteriores usando LayerGroup
        if (grupoMarcadoresTecnicos) {
            grupoMarcadoresTecnicos.clearLayers(); // Limpia sin afectar el zoom
            console.log('🧹 Marcadores de técnicos anteriores limpiados del LayerGroup');
        }

        // Grupo de coordenadas para ajustar el zoom
        const bounds = [];

        // Crear marcadores para cada técnico
        ubicaciones.forEach((ubicacion, index) => {
            const lat = parseFloat(ubicacion.latitud);
            const lng = parseFloat(ubicacion.longitud);

            if (isNaN(lat) || isNaN(lng)) {
                console.error('Coordenadas inválidas para:', ubicacion.tecnico_nombre);
                return;
            }

            bounds.push([lat, lng]);

            // Calcular tiempo transcurrido y color del marcador
            let tiempoTranscurrido = '';
            let colorMarcador = '#28a745'; // Verde por defecto

            if (ubicacion.fecha_captura) {
                const ahora = new Date();
                const fechaUbicacion = new Date(ubicacion.fecha_captura);
                const minutos = Math.floor((ahora - fechaUbicacion) / 60000);

                if (minutos < 15) {
                    tiempoTranscurrido = minutos < 5 ? 'Hace menos de 5 min' : `Hace ${minutos} min`;
                    colorMarcador = '#28a745'; // Verde
                } else if (minutos < 60) {
                    tiempoTranscurrido = `Hace ${minutos} min`;
                    colorMarcador = '#ffc107'; // Amarillo
                } else if (minutos < 1440) {
                    const horas = Math.floor(minutos / 60);
                    tiempoTranscurrido = `Hace ${horas}h`;
                    colorMarcador = '#dc3545'; // Rojo
                } else {
                    const dias = Math.floor(minutos / 1440);
                    tiempoTranscurrido = `Hace ${dias}d`;
                    colorMarcador = '#6c757d'; // Gris
                }
            }

            // Crear icono personalizado
            const iconoTecnico = L.divIcon({
                className: 'custom-marker',
                html: `<div style="
                    background-color: ${colorMarcador};
                    width: 40px;
                    height: 40px;
                    border-radius: 50% 50% 50% 0;
                    border: 3px solid white;
                    transform: rotate(-45deg);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <i class="fas fa-user" style="color: white; transform: rotate(45deg); font-size: 16px;"></i>
                </div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 40],
                popupAnchor: [0, -40]
            });

            // Crear marcador
            const marcador = L.marker([lat, lng], { icon: iconoTecnico });

            // Contenido del popup
            const fechaCaptura = ubicacion.fecha_captura ?
                new Date(ubicacion.fecha_captura).toLocaleString('es-CO', {
                    dateStyle: 'short',
                    timeStyle: 'short'
                }) : 'No disponible';

            const precisionGps = ubicacion.precision_gps ?
                `${Math.round(ubicacion.precision_gps)} m` : 'N/A';

            const visitasActivas = ubicacion.visitas_activas || 0;

            const popupContent = `
                <div class="tecnico-popup" style="min-width: 200px;">
                    <h6><i class="fas fa-user-circle"></i> ${ubicacion.tecnico_nombre || 'Sin nombre'}</h6>
                    <p><i class="fas fa-phone"></i> <strong>Tel:</strong> ${ubicacion.tecnico_telefono || 'N/A'}</p>
                    <p><i class="fas fa-clock"></i> <strong>Actualización:</strong><br>${fechaCaptura}<br>
                    <small style="color: ${colorMarcador}; font-weight: bold;">${tiempoTranscurrido}</small></p>
                    <p><i class="fas fa-crosshairs"></i> <strong>Precisión:</strong> ${precisionGps}</p>
                    <p><i class="fas fa-clipboard-list"></i> <strong>Visitas activas:</strong> ${visitasActivas}</p>
                    <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank"
                       class="btn btn-sm btn-primary w-100">
                        <i class="fas fa-external-link-alt"></i> Abrir en Google Maps
                    </a>
                </div>
            `;

            marcador.bindPopup(popupContent);
            marcador.addTo(grupoMarcadoresTecnicos); // Agregar al LayerGroup en lugar del mapa
        });

        // Centrar el mapa solo en la primera carga
        if (esPrimeraCargaUbicaciones && bounds.length > 0) {
            if (bounds.length === 1) {
                // Si solo hay un técnico, centrar en su ubicación
                mapaUbicaciones.setView(bounds[0], 16);
                console.log('📍 Mapa centrado en la ubicación del técnico');
            } else {
                // Si hay múltiples técnicos, ajustar para mostrarlos todos
                mapaUbicaciones.fitBounds(bounds, { padding: [50, 50] });
                console.log('📍 Mapa ajustado para mostrar todos los técnicos');
            }
            esPrimeraCargaUbicaciones = false; // Marcar que ya se hizo la primera carga
        }
        // En actualizaciones posteriores, solo refrescar los marcadores
        // El usuario tiene control total del zoom y posición

        // Mostrar resumen
        container.innerHTML = `
            <div class="alert alert-success mt-3" role="alert">
                <i class="fas fa-check-circle"></i> Se encontraron <strong>${ubicaciones.length}</strong> técnico(s) con ubicación activa.
                <button class="btn btn-sm btn-outline-success float-end" onclick="cargarUbicacionesTecnicos()">
                    <i class="fas fa-sync-alt"></i> Actualizar
                </button>
            </div>
        `;

        console.log(`✅ ${ubicaciones.length} marcadores agregados al mapa`);

    } catch (error) {
        console.error('Error cargando ubicaciones de técnicos:', error);
        container.innerHTML = `
            <div class="alert alert-danger mt-3" role="alert">
                <i class="fas fa-exclamation-triangle"></i>
                Error al cargar las ubicaciones: ${error.message}
                <button class="btn btn-sm btn-outline-danger float-end" onclick="cargarUbicacionesTecnicos()">
                    <i class="fas fa-redo"></i> Reintentar
                </button>
            </div>
        `;
    }
}

// ===== FUNCIONES DE CAMBIO MASIVO DE FECHA =====

// Mostrar modal de cambio masivo de fecha
function mostrarModalCambioFechaMasivo() {
    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada && v.estado === 'programada');

    if (visitasSeleccionadas.length === 0) {
        mostrarAlerta('Selecciona al menos una visita programada para cambiar la fecha', 'warning');
        return;
    }

    // Actualizar contador y lista de visitas
    document.getElementById('contadorVisitasCambioFecha').textContent = visitasSeleccionadas.length;

    const listaContainer = document.getElementById('listaVisitasCambioFecha');
    const listaHtml = visitasSeleccionadas.map(visita => `
        <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-white rounded border">
            <div>
                <strong>${visita.cliente_nombre}</strong>
                <br><small class="text-muted">
                    <i class="fas fa-calendar"></i> Fecha actual: ${formatearFechaLocal(visita.fecha_programada)}
                    | <i class="fas fa-tools"></i> ${visita.motivo_visita}
                </small>
            </div>
            <span class="badge bg-warning">Programada</span>
        </div>
    `).join('');

    listaContainer.innerHTML = listaHtml;

    // Configurar fecha mínima (mañana)
    const mañana = new Date();
    mañana.setDate(mañana.getDate() + 1);
    document.getElementById('nuevaFechaProgramada').min = mañana.toISOString().split('T')[0];

    // Limpiar campos
    document.getElementById('nuevaFechaProgramada').value = '';
    document.getElementById('motivoCambioFecha').value = '';

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalCambioFechaMasivo'));
    modal.show();
}

// Confirmar cambio masivo de fecha
async function confirmarCambioFechaMasivo() {
    const nuevaFecha = document.getElementById('nuevaFechaProgramada').value;
    const motivoCambio = document.getElementById('motivoCambioFecha').value;

    if (!nuevaFecha) {
        mostrarAlerta('Selecciona una nueva fecha para las visitas', 'warning');
        return;
    }

    const visitasSeleccionadas = visitasProgramadas.filter(v => v.seleccionada && v.estado === 'programada');

    if (visitasSeleccionadas.length === 0) {
        mostrarAlerta('No hay visitas programadas seleccionadas', 'warning');
        return;
    }

    // Formatear fecha sin problema de zona horaria
    const [año, mes, dia] = nuevaFecha.split('-');
    const fechaFormateada = `${dia}/${mes}/${año}`;
    const confirmacion = confirm(
        `¿Confirmas el cambio de fecha de ${visitasSeleccionadas.length} visitas a ${fechaFormateada}?`
    );

    if (!confirmacion) return;

    // Mostrar indicador de carga
    const btnConfirmar = document.querySelector('#modalCambioFechaMasivo .btn-info');
    if (!btnConfirmar) {
        console.error('❌ No se pudo encontrar el botón de confirmación');
        mostrarAlerta('Error: No se encontró el botón de confirmación', 'danger');
        return;
    }
    const textoOriginal = btnConfirmar.innerHTML;
    btnConfirmar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cambiando fechas...';
    btnConfirmar.disabled = true;

    try {
        console.log(`🔄 Iniciando cambio masivo de fecha para ${visitasSeleccionadas.length} visitas a ${nuevaFecha}`);

        let cambiosExitosos = 0;
        let cambiosFallidos = 0;
        const errores = [];

        // Cambiar fecha de cada visita individualmente
        for (const visita of visitasSeleccionadas) {
            try {
                console.log(`📋 Cambiando fecha de visita ID ${visita.id} de ${visita.cliente_nombre}`);

                const response = await fetch(`/api/visitas-tecnicas/${visita.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fecha_programada: nuevaFecha,
                        notas_admin: (visita.notas_admin || '') +
                            (visita.notas_admin ? '\n' : '') +
                            `[Cambio masivo de fecha] Nueva fecha: ${fechaFormateada}` +
                            (motivoCambio ? `. Motivo: ${motivoCambio}` : '')
                    })
                });

                const resultado = await response.json();

                if (resultado.success) {
                    console.log(`✅ Fecha de visita ${visita.id} cambiada exitosamente`);

                    // Actualizar datos locales
                    visita.fecha_programada = nuevaFecha;
                    visita.seleccionada = false;

                    if (motivoCambio) {
                        visita.notas_admin = (visita.notas_admin || '') +
                            (visita.notas_admin ? '\n' : '') +
                            `[Cambio masivo de fecha] ${motivoCambio}`;
                    }

                    cambiosExitosos++;
                } else {
                    console.error(`❌ Error cambiando fecha de visita ${visita.id}:`, resultado.message);
                    errores.push(`${visita.cliente_nombre}: ${resultado.message}`);
                    cambiosFallidos++;
                }

                // Pequeña pausa entre cambios para no sobrecargar el servidor
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`❌ Error en cambio de fecha de visita ${visita.id}:`, error);
                errores.push(`${visita.cliente_nombre}: Error de conexión`);
                cambiosFallidos++;
            }
        }

        // Recargar tabla de visitas (esto también actualiza los botones)
        await cargarVisitasNoAsignadas();

        // Cerrar modal
        bootstrap.Modal.getInstance(document.getElementById('modalCambioFechaMasivo')).hide();

        // Mostrar resultado
        let mensaje = `Cambio de fecha completado:\n✅ ${cambiosExitosos} exitosos`;
        if (cambiosFallidos > 0) {
            mensaje += `\n❌ ${cambiosFallidos} fallidos`;
        }

        if (errores.length > 0 && errores.length <= 5) {
            mensaje += '\n\nErrores:\n' + errores.join('\n');
        }

        mostrarAlerta(mensaje, cambiosFallidos > 0 ? 'warning' : 'success');

        console.log(`✅ Cambio masivo completado: ${cambiosExitosos} exitosos, ${cambiosFallidos} fallidos`);

    } catch (error) {
        console.error('❌ Error en cambio masivo de fecha:', error);
        mostrarAlerta('Error realizando el cambio masivo de fecha', 'danger');
    } finally {
        // Restaurar botón
        btnConfirmar.innerHTML = textoOriginal;
        btnConfirmar.disabled = false;
    }
}

/**
 * ============================================
 * GESTIÓN DE PERMISOS CAJAS NAP
 * ============================================
 */

// Mostrar modal de permisos NAP
function mostrarPermisosNap() {
    const modal = new bootstrap.Modal(document.getElementById('modalPermisosNap'));
    modal.show();
    cargarTecnicosPermisosNap();
}

// Cargar técnicos con sus permisos NAP
async function cargarTecnicosPermisosNap() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/tecnicos-permisos-nap', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const resultado = await response.json();

        if (!resultado.success) {
            mostrarAlerta('Error cargando técnicos', 'danger');
            return;
        }

        const container = document.getElementById('listaTecnicosNap');

        if (resultado.tecnicos.length === 0) {
            container.innerHTML = '<p class="text-center text-muted">No hay técnicos registrados</p>';
            return;
        }

        container.innerHTML = `
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead>
                        <tr>
                            <th>Técnico</th>
                            <th>Usuario</th>
                            <th class="text-center">Puede Agregar NAPs</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${resultado.tecnicos.map(tecnico => `
                            <tr>
                                <td>
                                    <strong>${tecnico.nombre}</strong>
                                </td>
                                <td>
                                    <span class="text-muted">@${tecnico.username}</span>
                                </td>
                                <td class="text-center">
                                    <div class="form-check form-switch d-flex justify-content-center">
                                        <input
                                            class="form-check-input"
                                            type="checkbox"
                                            id="permiso_${tecnico.id}"
                                            ${tecnico.puede_agregar_naps === 1 ? 'checked' : ''}
                                            onchange="cambiarPermisoNap(${tecnico.id}, this.checked)"
                                            style="cursor: pointer; width: 3rem; height: 1.5rem;">
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        console.log(`✅ Cargados ${resultado.tecnicos.length} técnicos`);

    } catch (error) {
        console.error('Error cargando técnicos:', error);
        document.getElementById('listaTecnicosNap').innerHTML =
            '<p class="text-center text-danger">Error cargando técnicos</p>';
    }
}

// Cambiar permiso NAP de un técnico
async function cambiarPermisoNap(tecnicoId, activado) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/tecnicos/${tecnicoId}/permiso-nap`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ puede_agregar_naps: activado })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(
                `✅ Permiso ${activado ? 'activado' : 'desactivado'} exitosamente`,
                'success'
            );
            console.log(`✅ Permiso NAP ${activado ? 'activado' : 'desactivado'} para técnico ${tecnicoId}`);
        } else {
            mostrarAlerta('Error actualizando permiso', 'danger');
            // Revertir el switch
            document.getElementById(`permiso_${tecnicoId}`).checked = !activado;
        }

    } catch (error) {
        console.error('Error actualizando permiso:', error);
        mostrarAlerta('Error de conexión', 'danger');
        // Revertir el switch
        document.getElementById(`permiso_${tecnicoId}`).checked = !activado;
    }
}