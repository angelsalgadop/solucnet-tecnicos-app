/**
 * Módulo para gestionar seriales de equipos en visitas técnicas
 * Usa BarcodeDetector API NATIVA (ULTRA RÁPIDA - como apps nativas)
 */

// Configuración del servidor
// API_BASE_URL se declara en el HTML para evitar redeclaración
window.API_BASE_URL = window.API_BASE_URL || 'https://cliente.solucnet.com:3000';
const API_BASE_URL = window.API_BASE_URL;

// Log para verificar versión
console.log('🔧 serial_scanner_native.js CARGADO - Versión: 1761679244 - CON SELECTOR TV BOX/MODEM');

let stream = null;
let videoElement = null;
let barcodeDetector = null;
let scanning = false;

// Inicializar variables globales para el tipo de equipo
if (!window.tipoEquipoCapturado) {
    window.tipoEquipoCapturado = 'Onu CData'; // Por defecto: Modem
    console.log('✅ Variable tipoEquipoCapturado inicializada: Onu CData');
}

/**
 * Normaliza el serial del equipo
 */
function normalizarSerial(serial) {
    if (!serial) return '';
    serial = serial.trim().toUpperCase();
    if (serial.includes('-')) {
        const partes = serial.split('-');
        serial = partes[partes.length - 1].trim();
        console.log(`🔧 Serial normalizado: ${serial}`);
    }
    return serial;
}

/**
 * Inicializa el modal para capturar serial
 */
function abrirModalSerialEquipo(visitaId, motivoVisita) {
    console.log(`📦 Abriendo modal serial - Visita: ${visitaId}`);

    window.visitaIdActual = visitaId;
    window.motivoVisitaActual = motivoVisita;

    const modalHTML = `
        <div class="modal fade" id="modalSerialEquipo" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-barcode"></i> Capturar Serial
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" onclick="cerrarEscanerSerial()"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle"></i> Captura el serial del modem/equipo
                        </div>

                        <!-- Opciones -->
                        <div class="row g-2 mb-3" id="opcionesCaptura">
                            <div class="col-6">
                                <button type="button" class="btn btn-primary w-100" onclick="iniciarEscanerCodigo()">
                                    <i class="fas fa-camera"></i><br>
                                    <small>Escanear</small>
                                </button>
                            </div>
                            <div class="col-6">
                                <button type="button" class="btn btn-success w-100" onclick="mostrarInputManual()">
                                    <i class="fas fa-keyboard"></i><br>
                                    <small>Escribir</small>
                                </button>
                            </div>
                        </div>

                        <!-- Área del escáner -->
                        <div id="areaEscaner" class="d-none mb-3">
                            <div class="card">
                                <div class="card-body text-center p-0">
                                    <video id="videoEscaner" autoplay playsinline style="width: 100%; max-width: 100%; height: auto; border-radius: 8px; background: #000;"></video>
                                    <div class="p-3">
                                        <div class="alert alert-success mb-2">
                                            <strong><i class="fas fa-zap"></i> Escáner Nativo Activo</strong>
                                            <p class="mb-0 small mt-1">Apunta al código - Detección INSTANTÁNEA</p>
                                        </div>
                                        <button type="button" class="btn btn-danger btn-sm" onclick="detenerEscaner()">
                                            <i class="fas fa-stop"></i> Detener
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Input manual -->
                        <div id="inputManualSerial" class="d-none mb-3">
                            <label class="form-label"><i class="fas fa-barcode"></i> Serial *</label>
                            <input type="text" class="form-control form-control-lg" id="serialManual"
                                   placeholder="Ej: ABC123XYZ456"
                                   onkeyup="this.value = this.value.toUpperCase(); habilitarBotonSerial()">
                        </div>

                        <!-- Serial capturado -->
                        <div id="serialCapturado" class="d-none">
                            <div class="alert alert-success">
                                <h6><i class="fas fa-check-circle"></i> Serial Capturado</h6>
                                <p class="mb-0 fs-5 font-monospace fw-bold" id="serialTexto"
                                   onclick="copiarSerial()"
                                   style="cursor: pointer; user-select: all; padding: 10px; background: rgba(255,255,255,0.3); border-radius: 8px; position: relative;"
                                   title="Toca para copiar"></p>
                                <small class="text-muted"><i class="fas fa-copy"></i> Toca el serial para copiarlo</small>
                            </div>

                            <!-- Selector de tipo de equipo -->
                            <div class="card border-primary mb-3">
                                <div class="card-header bg-primary text-white">
                                    <h6 class="mb-0"><i class="fas fa-tag"></i> ¿Qué tipo de equipo es?</h6>
                                </div>
                                <div class="card-body">
                                    <div class="btn-group w-100" role="group">
                                        <input type="radio" class="btn-check" name="tipoEquipo" id="radioModem" value="Onu CData" checked onchange="seleccionarTipoEquipo(this.value)">
                                        <label class="btn btn-outline-primary" for="radioModem">
                                            <i class="fas fa-wifi"></i><br>
                                            <strong>MODEM</strong>
                                        </label>

                                        <input type="radio" class="btn-check" name="tipoEquipo" id="radioTvBox" value="TV BOX" onchange="seleccionarTipoEquipo(this.value)">
                                        <label class="btn btn-outline-primary" for="radioTvBox">
                                            <i class="fas fa-tv"></i><br>
                                            <strong>TV BOX</strong>
                                        </label>
                                    </div>
                                    <small class="text-muted d-block mt-2 text-center">
                                        <i class="fas fa-info-circle"></i> Selecciona el tipo de equipo que estás instalando
                                    </small>
                                </div>
                            </div>

                            <button type="button" class="btn btn-warning btn-sm" onclick="recapturarSerial()">
                                <i class="fas fa-redo"></i> Cambiar
                            </button>
                        </div>

                        <!-- Verificación -->
                        <div id="estadoVerificacion" class="mt-3"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" onclick="cerrarEscanerSerial()">Cancelar</button>
                        <button type="button" class="btn btn-secondary" id="btnConfirmarSerial" onclick="confirmarSerialEquipo()" disabled>
                            <i class="fas fa-check"></i> Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const modalAnterior = document.getElementById('modalSerialEquipo');
    if (modalAnterior) modalAnterior.remove();

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = new bootstrap.Modal(document.getElementById('modalSerialEquipo'));
    modal.show();
}

/**
 * Inicia el escáner NATIVO ultra rápido
 */
async function iniciarEscanerCodigo() {
    try {
        console.log('🚀 Iniciando BarcodeDetector NATIVO...');

        document.getElementById('opcionesCaptura').classList.add('d-none');
        document.getElementById('inputManualSerial').classList.add('d-none');
        document.getElementById('areaEscaner').classList.remove('d-none');
        document.getElementById('serialCapturado').classList.add('d-none');

        // Verificar si BarcodeDetector está disponible
        if (!('BarcodeDetector' in window)) {
            console.warn('⚠️ BarcodeDetector no disponible, usando fallback');
            alert('Tu navegador no soporta el escáner nativo. Por favor usa Chrome o escribe el serial manualmente.');
            mostrarInputManual();
            return;
        }

        // Verificar formatos soportados
        const formats = await BarcodeDetector.getSupportedFormats();
        console.log('📋 Formatos soportados:', formats);

        // Crear detector con todos los formatos disponibles
        barcodeDetector = new BarcodeDetector({ formats: formats });

        // Obtener acceso a la cámara
        videoElement = document.getElementById('videoEscaner');

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // Cámara trasera
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        videoElement.srcObject = stream;
        await videoElement.play();

        console.log('✅ Cámara iniciada');

        // Iniciar detección continua RÁPIDA
        scanning = true;
        detectarCodigo();

    } catch (error) {
        console.error('❌ Error:', error);
        alert('No se pudo acceder a la cámara. Por favor permite el acceso o usa "Escribir Serial".');
        mostrarInputManual();
    }
}

/**
 * Detecta códigos continuamente (ULTRA RÁPIDO)
 */
async function detectarCodigo() {
    if (!scanning || !videoElement || !barcodeDetector) return;

    try {
        // Detectar códigos en el frame actual
        const barcodes = await barcodeDetector.detect(videoElement);

        if (barcodes.length > 0) {
            const codigo = barcodes[0].rawValue;
            console.log(`⚡ Código detectado INSTANTÁNEAMENTE: ${codigo}`);

            // Validar longitud
            if (codigo.length >= 6 && codigo.length <= 35) {
                // Validar formato
                const formatoValido = /^[A-Z0-9\-\s]+$/i.test(codigo);
                if (formatoValido) {
                    procesarCodigoDetectado(codigo);
                    return; // Detener el loop
                } else {
                    console.log('⚠️ Caracteres inválidos, ignorando');
                }
            } else {
                console.log(`⚠️ Longitud inválida (${codigo.length}), ignorando`);
            }
        }
    } catch (error) {
        console.error('Error detectando:', error);
    }

    // Continuar escaneando (60 FPS para máxima velocidad)
    if (scanning) {
        requestAnimationFrame(detectarCodigo);
    }
}

/**
 * Procesa el código detectado
 */
function procesarCodigoDetectado(codigo) {
    scanning = false; // Detener escaneo

    // Normalizar
    const serial = normalizarSerial(codigo);
    console.log(`✅ Serial normalizado: ${serial}`);

    // Sonido de confirmación
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHw=');
        audio.play();
    } catch (e) {}

    // Detener cámara
    detenerEscaner();

    // Mostrar resultado
    document.getElementById('serialTexto').textContent = serial;
    document.getElementById('areaEscaner').classList.add('d-none');
    document.getElementById('serialCapturado').classList.remove('d-none');

    window.serialEquipoCapturado = serial;
    window.tipoEquipoCapturado = 'Onu CData'; // Reiniciar al valor por defecto (Modem)
    verificarSerialEnBD(serial);
}

/**
 * Selecciona el tipo de equipo capturado
 */
function seleccionarTipoEquipo(tipo) {
    window.tipoEquipoCapturado = tipo;
    console.log(`✅ Tipo de equipo seleccionado: ${tipo}`);
}

/**
 * Detiene el escáner y libera la cámara
 */
function detenerEscaner() {
    console.log('🛑 Deteniendo escáner...');

    scanning = false;

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    if (videoElement) {
        videoElement.srcObject = null;
    }

    const areaEscaner = document.getElementById('areaEscaner');
    const opcionesCaptura = document.getElementById('opcionesCaptura');

    if (areaEscaner) areaEscaner.classList.add('d-none');
    if (opcionesCaptura) opcionesCaptura.classList.remove('d-none');
}

/**
 * Muestra input manual
 */
function mostrarInputManual() {
    detenerEscaner();
    document.getElementById('opcionesCaptura').classList.add('d-none');
    document.getElementById('inputManualSerial').classList.remove('d-none');
    document.getElementById('serialManual').focus();
}

/**
 * Habilita botón
 */
function habilitarBotonSerial() {
    const serial = document.getElementById('serialManual').value.trim();
    const btn = document.getElementById('btnConfirmarSerial');

    if (serial.length >= 5) {
        btn.disabled = false;
        btn.classList.replace('btn-secondary', 'btn-primary');
    } else {
        btn.disabled = true;
        btn.classList.replace('btn-primary', 'btn-secondary');
    }
}

/**
 * Copia el serial al portapapeles
 */
async function copiarSerial() {
    const serialTexto = document.getElementById('serialTexto');
    const serial = serialTexto.textContent;

    try {
        // Copiar al portapapeles
        await navigator.clipboard.writeText(serial);

        // Feedback visual - Cambiar estilo temporalmente
        const estiloOriginal = serialTexto.style.background;
        serialTexto.style.background = 'rgba(40, 167, 69, 0.3)';
        serialTexto.style.transition = 'all 0.3s';

        // Mostrar mensaje de copiado
        const iconoCopiar = serialTexto.parentElement.querySelector('small');
        const textoOriginal = iconoCopiar.innerHTML;
        iconoCopiar.innerHTML = '<i class="fas fa-check-circle text-success"></i> ¡Copiado al portapapeles!';
        iconoCopiar.style.fontWeight = 'bold';

        // Vibración si está disponible
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }

        // Restaurar después de 2 segundos
        setTimeout(() => {
            serialTexto.style.background = estiloOriginal;
            iconoCopiar.innerHTML = textoOriginal;
            iconoCopiar.style.fontWeight = 'normal';
        }, 2000);

        console.log(`📋 Serial copiado: ${serial}`);

    } catch (error) {
        console.error('Error al copiar:', error);

        // Fallback: Seleccionar el texto para que el usuario pueda copiarlo manualmente
        if (window.getSelection) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(serialTexto);
            selection.removeAllRanges();
            selection.addRange(range);

            alert('Serial seleccionado. Usa Ctrl+C o mantén presionado para copiar.');
        }
    }
}

/**
 * Recaptura
 */
function recapturarSerial() {
    document.getElementById('opcionesCaptura').classList.remove('d-none');
    document.getElementById('inputManualSerial').classList.add('d-none');
    document.getElementById('serialCapturado').classList.add('d-none');
    document.getElementById('estadoVerificacion').innerHTML = '';
    document.getElementById('serialManual').value = '';

    const btn = document.getElementById('btnConfirmarSerial');
    btn.disabled = true;
    btn.classList.replace('btn-primary', 'btn-secondary');
    btn.innerHTML = '<i class="fas fa-check"></i> Confirmar';
    btn.onclick = confirmarSerialEquipo;

    window.serialEquipoCapturado = null;
    window.tipoEquipoCapturado = 'Onu CData'; // Reiniciar al valor por defecto (Modem)
}

/**
 * Confirma serial manual
 */
async function confirmarSerialEquipo() {
    const serialRaw = document.getElementById('serialManual')?.value?.trim();
    if (!serialRaw) {
        alert('Ingresa un serial válido');
        return;
    }

    const serial = normalizarSerial(serialRaw);

    document.getElementById('serialTexto').textContent = serial;
    document.getElementById('inputManualSerial').classList.add('d-none');
    document.getElementById('serialCapturado').classList.remove('d-none');

    window.serialEquipoCapturado = serial;
    window.tipoEquipoCapturado = 'Onu CData'; // Reiniciar al valor por defecto (Modem)

    await verificarSerialEnBD(serial);
}

/**
 * Verifica serial en BD
 */
async function verificarSerialEnBD(serial) {
    const div = document.getElementById('estadoVerificacion');
    div.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Verificando...</div>';

    try {
        const token = localStorage.getItem('token_tecnico');
        const response = await fetch(API_BASE_URL + '/api/verificar-serial', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                serialEquipo: serial,
                visitaId: window.visitaIdActual
            })
        });

        const data = await response.json();

        if (!data.success) {
            div.innerHTML = `<div class="alert alert-danger"><i class="fas fa-times-circle"></i> ${data.message}</div>`;
            window.serialEquipoCapturado = null;
            return;
        }

        if (data.estaAsignado && !data.esDelMismoCliente) {
            const eq = data.equipos[0];

            console.log('📋 Información del equipo asignado:', eq);

            div.innerHTML = `
                <div class="alert alert-danger">
                    <h6 class="mb-3"><i class="fas fa-ban"></i> ⛔ ERROR: MODEM YA ASIGNADO A OTRO CLIENTE</h6>

                    <div class="bg-white p-3 rounded border border-danger mb-3">
                        <h6 class="text-danger mb-2"><i class="fas fa-user"></i> Este serial pertenece a:</h6>

                        <table class="table table-sm table-borderless mb-0">
                            <tbody>
                                <tr>
                                    <td class="fw-bold" style="width: 100px;">Nombre:</td>
                                    <td class="text-danger fw-bold">${eq.cliente_nombre || 'No disponible'}</td>
                                </tr>
                                <tr>
                                    <td class="fw-bold">Cédula:</td>
                                    <td>${eq.cliente_cedula || 'No disponible'}</td>
                                </tr>
                                <tr>
                                    <td class="fw-bold">Teléfono:</td>
                                    <td>${eq.cliente_telefono || 'No disponible'}</td>
                                </tr>
                                <tr>
                                    <td class="fw-bold">Serial:</td>
                                    <td class="font-monospace">${serial}</td>
                                </tr>
                                <tr>
                                    <td class="fw-bold">Estado:</td>
                                    <td><span class="badge bg-warning">${eq.estado || 'Activo'}</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="alert alert-warning mb-0">
                        <p class="mb-1"><strong><i class="fas fa-exclamation-triangle"></i> NO PUEDES CONTINUAR CON ESTA INSTALACIÓN</strong></p>
                        <p class="mb-0 small">Este modem ya está en uso. Por favor, usa otro modem o contacta a soporte técnico.</p>
                    </div>
                </div>
            `;

            // IMPORTANTE: Limpiar serial y DESHABILITAR botón
            window.serialEquipoCapturado = null;
            const btn = document.getElementById('btnConfirmarSerial');
            btn.disabled = true;
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
            btn.textContent = 'Serial No Disponible';

            console.error(`❌ SERIAL BLOQUEADO: ${serial} está asignado a ${eq.cliente_nombre} (${eq.cliente_cedula})`);

        } else {
            div.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Serial verificado correctamente</div>';
            window.serialEquipoCapturado = serial;
            const btn = document.getElementById('btnConfirmarSerial');
            btn.disabled = false;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            btn.textContent = 'Guardar y Continuar';
            btn.onclick = guardarSerialYContinuar;

            console.log(`✅ SERIAL APROBADO: ${serial} disponible para asignar`);
        }
    } catch (error) {
        div.innerHTML = '<div class="alert alert-danger"><i class="fas fa-times-circle"></i> Error verificando</div>';
    }
}

/**
 * Guarda y cierra (CON VALIDACIÓN DE SEGURIDAD)
 */
function guardarSerialYContinuar() {
    // VALIDACIÓN DE SEGURIDAD: Verificar que hay serial capturado
    if (!window.serialEquipoCapturado) {
        alert('❌ ERROR: No hay serial capturado o el serial no está disponible.');
        console.error('❌ Intento de guardar sin serial válido');
        return;
    }

    const tipoEquipo = window.tipoEquipoCapturado || 'Onu CData';
    console.log(`✅ Guardando serial aprobado: ${window.serialEquipoCapturado}, tipo: ${tipoEquipo}`);

    const div = document.getElementById('serialCapturadoInfo');
    if (div) {
        const iconoTipo = tipoEquipo === 'TV BOX' ? '<i class="fas fa-tv text-primary"></i>' : '<i class="fas fa-wifi text-success"></i>';
        div.innerHTML = `
            <div class="alert alert-success mt-2">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <i class="fas fa-check-circle"></i> <strong>Serial capturado:</strong>
                        <span class="font-monospace fw-bold d-block mt-1">${window.serialEquipoCapturado}</span>
                        <small class="text-muted">${iconoTipo} Tipo: <strong>${tipoEquipo}</strong></small>
                    </div>
                </div>
            </div>
        `;
    }

    const modal = bootstrap.Modal.getInstance(document.getElementById('modalSerialEquipo'));
    modal.hide();
    setTimeout(() => document.getElementById('modalSerialEquipo')?.remove(), 300);
}

/**
 * Cierra modal
 */
function cerrarEscanerSerial() {
    detenerEscaner();
    window.serialEquipoCapturado = null;
}

/**
 * Asigna equipo
 */
async function asignarEquipoAlCompletar(visitaId, serialEquipo) {
    try {
        const token = localStorage.getItem('token_tecnico');
        const response = await fetch(API_BASE_URL + '/api/asignar-equipo', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                visitaId: visitaId,
                serialEquipo: serialEquipo,
                costoEquipo: 180000
            })
        });
        return await response.json();
    } catch (error) {
        return { success: false };
    }
}

// Exportar
window.abrirModalSerialEquipo = abrirModalSerialEquipo;
window.iniciarEscanerCodigo = iniciarEscanerCodigo;
window.detenerEscaner = detenerEscaner;
window.mostrarInputManual = mostrarInputManual;
window.habilitarBotonSerial = habilitarBotonSerial;
window.copiarSerial = copiarSerial;
window.recapturarSerial = recapturarSerial;
window.confirmarSerialEquipo = confirmarSerialEquipo;
window.guardarSerialYContinuar = guardarSerialYContinuar;
window.cerrarEscanerSerial = cerrarEscanerSerial;
window.asignarEquipoAlCompletar = asignarEquipoAlCompletar;

console.log('⚡ ESCÁNER NATIVO cargado - BarcodeDetector API');
console.log('🚀 Detección INSTANTÁNEA a 60 FPS');
console.log('📱 Requiere Chrome/Edge - Fallback a manual si no está disponible');
