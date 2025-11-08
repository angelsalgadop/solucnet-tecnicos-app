/**
 * Módulo para gestionar seriales de equipos en visitas técnicas
 * Usa html5-qrcode para detección RÁPIDA y CONFIABLE de códigos de barras
 */

// Variables globales para el escáner
let html5QrcodeScanner = null;
let scannerActive = false;

/**
 * Normaliza el serial del equipo
 */
function normalizarSerial(serial) {
    if (!serial) return '';
    serial = serial.trim().toUpperCase();
    if (serial.includes('-')) {
        const partes = serial.split('-');
        serial = partes[partes.length - 1].trim();
        console.log(`🔧 [NORMALIZAR] Serial con guion detectado, tomando parte final: ${serial}`);
    }
    return serial;
}

/**
 * Inicializa el modal para capturar serial
 */
function abrirModalSerialEquipo(visitaId, motivoVisita) {
    console.log(`📦 [SERIAL] Abriendo modal para capturar serial, visita: ${visitaId}, motivo: ${motivoVisita}`);

    window.visitaIdActual = visitaId;
    window.motivoVisitaActual = motivoVisita;

    const modalHTML = `
        <div class="modal fade" id="modalSerialEquipo" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-barcode"></i> Capturar Serial del Equipo
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" onclick="cerrarEscanerSerial()"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle"></i> <strong>Obligatorio:</strong> Debes capturar el serial del modem/equipo.
                        </div>

                        <!-- Opciones -->
                        <div class="row g-2 mb-3" id="opcionesCaptura">
                            <div class="col-6">
                                <button type="button" class="btn btn-primary w-100" onclick="iniciarEscanerCodigo()">
                                    <i class="fas fa-camera"></i><br>
                                    <small>Escanear Código</small>
                                </button>
                            </div>
                            <div class="col-6">
                                <button type="button" class="btn btn-success w-100" onclick="mostrarInputManual()">
                                    <i class="fas fa-keyboard"></i><br>
                                    <small>Escribir Serial</small>
                                </button>
                            </div>
                        </div>

                        <!-- Área del escáner -->
                        <div id="areaEscaner" class="d-none mb-3">
                            <div id="reader" style="width: 100%;"></div>
                        </div>

                        <!-- Input manual -->
                        <div id="inputManualSerial" class="d-none mb-3">
                            <label class="form-label"><i class="fas fa-barcode"></i> Serial del Equipo *</label>
                            <input type="text" class="form-control form-control-lg" id="serialManual"
                                   placeholder="Ej: ABC123XYZ456"
                                   onkeyup="this.value = this.value.toUpperCase(); habilitarBotonSerial()">
                            <small class="text-muted">Ingresa el serial manualmente</small>
                        </div>

                        <!-- Serial capturado -->
                        <div id="serialCapturado" class="d-none">
                            <div class="alert alert-success">
                                <h6><i class="fas fa-check-circle"></i> Serial Capturado</h6>
                                <p class="mb-0 fs-5 font-monospace fw-bold"><strong id="serialTexto"></strong></p>
                            </div>
                            <button type="button" class="btn btn-warning btn-sm" onclick="recapturarSerial()">
                                <i class="fas fa-redo"></i> Cambiar Serial
                            </button>
                        </div>

                        <!-- Estado de verificación -->
                        <div id="estadoVerificacion" class="mt-3"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" onclick="cerrarEscanerSerial()">Cancelar</button>
                        <button type="button" class="btn btn-secondary" id="btnConfirmarSerial" onclick="confirmarSerialEquipo()" disabled>
                            <i class="fas fa-check"></i> Confirmar Serial
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const modalAnterior = document.getElementById('modalSerialEquipo');
    if (modalAnterior) {
        modalAnterior.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = new bootstrap.Modal(document.getElementById('modalSerialEquipo'));
    modal.show();
}

/**
 * Inicia el escáner con html5-qrcode
 */
async function iniciarEscanerCodigo() {
    try {
        console.log('📷 [ESCÁNER] Iniciando escáner html5-qrcode...');

        document.getElementById('opcionesCaptura').classList.add('d-none');
        document.getElementById('inputManualSerial').classList.add('d-none');
        document.getElementById('areaEscaner').classList.remove('d-none');
        document.getElementById('serialCapturado').classList.add('d-none');

        scannerActive = true;

        // Cargar librería si no está cargada
        if (!window.Html5QrcodeScanner) {
            console.log('📦 [ESCÁNER] Cargando html5-qrcode...');
            await cargarScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
            console.log('✅ [ESCÁNER] Librería cargada');
        }

        // Configuración del escáner
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 150 },
            rememberLastUsedCamera: true,
            supportedScanTypes: [
                Html5QrcodeScanType.SCAN_TYPE_CAMERA
            ],
            formatsToSupport: [
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.CODE_93,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.ITF,
                Html5QrcodeSupportedFormats.CODABAR
            ]
        };

        html5QrcodeScanner = new Html5QrcodeScanner("reader", config, false);

        html5QrcodeScanner.render(onScanSuccess, onScanError);

        console.log('✅ [ESCÁNER] Escáner iniciado correctamente');

    } catch (error) {
        console.error('❌ [ESCÁNER] Error:', error);
        alert('Error al iniciar el escáner. Usa la opción "Escribir Serial".');
        mostrarInputManual();
    }
}

/**
 * Callback cuando se escanea exitosamente
 */
function onScanSuccess(decodedText, decodedResult) {
    console.log(`✅ [ESCÁNER] Código detectado: ${decodedText}`);

    // Validar longitud
    if (decodedText.length < 6 || decodedText.length > 35) {
        console.log(`⚠️ [ESCÁNER] Código con longitud inválida: ${decodedText.length}`);
        return;
    }

    // Validar formato
    const formatoValido = /^[A-Z0-9\-\s]+$/i.test(decodedText);
    if (!formatoValido) {
        console.log(`⚠️ [ESCÁNER] Código con caracteres inválidos: ${decodedText}`);
        return;
    }

    // Normalizar serial
    const serial = normalizarSerial(decodedText);
    console.log(`✅ [ESCÁNER] Serial normalizado: ${serial}`);

    // Reproducir sonido
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHw=');
        audio.play();
    } catch (e) {}

    // Detener escáner
    detenerEscaner();

    // Mostrar serial
    document.getElementById('serialTexto').textContent = serial;
    document.getElementById('areaEscaner').classList.add('d-none');
    document.getElementById('serialCapturado').classList.remove('d-none');

    window.serialEquipoCapturado = serial;
    verificarSerialEnBD(serial);
}

/**
 * Callback de errores (normal durante el escaneo)
 */
function onScanError(errorMessage) {
    // No hacer nada, es normal que haya errores hasta que detecte el código
}

/**
 * Carga un script dinámicamente
 */
function cargarScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Detiene el escáner
 */
function detenerEscaner() {
    console.log('🛑 [ESCÁNER] Deteniendo escáner...');

    if (html5QrcodeScanner) {
        try {
            html5QrcodeScanner.clear();
            html5QrcodeScanner = null;
            console.log('🛑 [ESCÁNER] Escáner detenido');
        } catch (e) {
            console.warn('⚠️ [ESCÁNER] Error deteniendo:', e);
        }
    }

    scannerActive = false;

    const areaEscaner = document.getElementById('areaEscaner');
    const opcionesCaptura = document.getElementById('opcionesCaptura');

    if (areaEscaner) {
        areaEscaner.classList.add('d-none');
    }
    if (opcionesCaptura) {
        opcionesCaptura.classList.remove('d-none');
    }
}

/**
 * Muestra input manual
 */
function mostrarInputManual() {
    detenerEscaner();
    document.getElementById('opcionesCaptura').classList.add('d-none');
    document.getElementById('areaEscaner').classList.add('d-none');
    document.getElementById('inputManualSerial').classList.remove('d-none');
    document.getElementById('serialCapturado').classList.add('d-none');
    document.getElementById('serialManual').focus();
}

/**
 * Habilita botón de confirmar
 */
function habilitarBotonSerial() {
    const serial = document.getElementById('serialManual').value.trim();
    const btnConfirmar = document.getElementById('btnConfirmarSerial');

    if (serial.length >= 5) {
        btnConfirmar.disabled = false;
        btnConfirmar.classList.remove('btn-secondary');
        btnConfirmar.classList.add('btn-primary');
    } else {
        btnConfirmar.disabled = true;
        btnConfirmar.classList.remove('btn-primary');
        btnConfirmar.classList.add('btn-secondary');
    }
}

/**
 * Recaptura serial
 */
function recapturarSerial() {
    document.getElementById('opcionesCaptura').classList.remove('d-none');
    document.getElementById('inputManualSerial').classList.add('d-none');
    document.getElementById('areaEscaner').classList.add('d-none');
    document.getElementById('serialCapturado').classList.add('d-none');
    document.getElementById('estadoVerificacion').innerHTML = '';

    const inputSerial = document.getElementById('serialManual');
    if (inputSerial) {
        inputSerial.value = '';
    }

    const btnConfirmar = document.getElementById('btnConfirmarSerial');
    btnConfirmar.disabled = true;
    btnConfirmar.classList.remove('btn-primary');
    btnConfirmar.classList.add('btn-secondary');
    btnConfirmar.innerHTML = '<i class="fas fa-check"></i> Confirmar Serial';
    btnConfirmar.onclick = confirmarSerialEquipo;

    window.serialEquipoCapturado = null;
}

/**
 * Confirma serial manual
 */
async function confirmarSerialEquipo() {
    const serialRaw = document.getElementById('serialManual')?.value?.trim();

    if (!serialRaw) {
        alert('Por favor, ingresa un serial válido');
        return;
    }

    const serialNormalizado = normalizarSerial(serialRaw);

    console.log(`✅ [SERIAL] Serial normalizado: ${serialNormalizado}`);

    document.getElementById('serialTexto').textContent = serialNormalizado;
    document.getElementById('inputManualSerial').classList.add('d-none');
    document.getElementById('serialCapturado').classList.remove('d-none');

    await verificarSerialEnBD(serialNormalizado);
}

/**
 * Verifica serial en BD
 */
async function verificarSerialEnBD(serial) {
    const estadoDiv = document.getElementById('estadoVerificacion');
    estadoDiv.innerHTML = `
        <div class="alert alert-info">
            <i class="fas fa-spinner fa-spin"></i> Verificando serial...
        </div>
    `;

    try {
        const token = localStorage.getItem('token_tecnico');
        const visitaId = window.visitaIdActual;

        const response = await fetch('/api/verificar-serial', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                serialEquipo: serial,
                visitaId: visitaId
            })
        });

        const data = await response.json();

        if (!data.success) {
            estadoDiv.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-times-circle"></i> ${data.message || 'Error verificando serial'}
                </div>
            `;
            window.serialEquipoCapturado = null;
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = true;
            return;
        }

        if (data.estaAsignado && !data.esDelMismoCliente) {
            const equipo = data.equipos[0];
            estadoDiv.innerHTML = `
                <div class="alert alert-danger">
                    <h6><i class="fas fa-ban"></i> ⛔ MODEM YA ASIGNADO</h6>
                    <hr>
                    <p class="mb-2"><strong>Cliente:</strong> <span class="text-danger">${equipo.cliente_nombre || 'Desconocido'}</span></p>
                    <p class="mb-0"><strong>Cédula:</strong> ${equipo.cliente_cedula || 'N/A'}</p>
                </div>
            `;
            window.serialEquipoCapturado = null;
        } else {
            estadoDiv.innerHTML = `
                <div class="alert alert-success">
                    <i class="fas fa-check-circle"></i> Serial verificado correctamente
                </div>
            `;
            window.serialEquipoCapturado = serial;
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = false;
            btnConfirmar.classList.remove('btn-secondary');
            btnConfirmar.classList.add('btn-primary');
            btnConfirmar.textContent = 'Guardar y Continuar';
            btnConfirmar.onclick = guardarSerialYContinuar;
        }

    } catch (error) {
        console.error('❌ Error:', error);
        estadoDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-times-circle"></i> Error verificando serial
            </div>
        `;
    }
}

/**
 * Guarda y cierra
 */
function guardarSerialYContinuar() {
    if (!window.serialEquipoCapturado) {
        alert('No se ha capturado ningún serial');
        return;
    }

    console.log(`✅ [SERIAL] Serial guardado: ${window.serialEquipoCapturado}`);

    const infoDiv = document.getElementById('serialCapturadoInfo');
    if (infoDiv) {
        infoDiv.innerHTML = `
            <div class="alert alert-success mt-2">
                <i class="fas fa-check-circle"></i> <strong>Serial:</strong>
                <span class="font-monospace fw-bold d-block mt-1">${window.serialEquipoCapturado}</span>
            </div>
        `;
    }

    const modal = bootstrap.Modal.getInstance(document.getElementById('modalSerialEquipo'));
    modal.hide();

    setTimeout(() => {
        document.getElementById('modalSerialEquipo')?.remove();
    }, 300);
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
        const response = await fetch('/api/asignar-equipo', {
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

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
        return { success: false };
    }
}

// Exportar funciones
window.abrirModalSerialEquipo = abrirModalSerialEquipo;
window.iniciarEscanerCodigo = iniciarEscanerCodigo;
window.detenerEscaner = detenerEscaner;
window.mostrarInputManual = mostrarInputManual;
window.habilitarBotonSerial = habilitarBotonSerial;
window.recapturarSerial = recapturarSerial;
window.confirmarSerialEquipo = confirmarSerialEquipo;
window.guardarSerialYContinuar = guardarSerialYContinuar;
window.cerrarEscanerSerial = cerrarEscanerSerial;
window.asignarEquipoAlCompletar = asignarEquipoAlCompletar;

console.log('✅ [ESCÁNER] html5-qrcode cargado - Lectura RÁPIDA y CONFIABLE');
