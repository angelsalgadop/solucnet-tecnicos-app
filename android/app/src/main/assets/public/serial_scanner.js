/**
 * Módulo para gestionar seriales de equipos en visitas técnicas
 * Usa ZXing para detección RÁPIDA de códigos de barras (1D y 2D)
 */

// Variables globales para el escáner
let codeReader = null;
let scannerStream = null;
let scannerActive = false;
let videoElement = null;

/**
 * Normaliza el serial del equipo
 * Si contiene guion (-), toma solo la parte después del guion
 * Ejemplo: "E447B3-ZTEGCC3881E5" -> "ZTEGCC3881E5"
 */
function normalizarSerial(serial) {
    if (!serial) return '';

    // Trim y convertir a mayúsculas
    serial = serial.trim().toUpperCase();

    // Si contiene guion, tomar solo la parte después del último guion
    if (serial.includes('-')) {
        const partes = serial.split('-');
        serial = partes[partes.length - 1].trim();
        console.log(`🔧 [NORMALIZAR] Serial con guion detectado, tomando parte final: ${serial}`);
    }

    return serial;
}

/**
 * Inicializa el modal para capturar serial (escanear o escribir)
 */
function abrirModalSerialEquipo(visitaId, motivoVisita) {
    console.log(`📦 [SERIAL] Abriendo modal para capturar serial, visita: ${visitaId}, motivo: ${motivoVisita}`);

    // Guardar IDs en variables globales
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
                            <i class="fas fa-info-circle"></i> <strong>Obligatorio:</strong> Debes capturar el serial del modem/equipo antes de completar la visita.
                        </div>

                        <!-- Opciones para capturar serial -->
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

                        <!-- Área del escáner (oculta por defecto) -->
                        <div id="areaEscaner" class="d-none mb-3">
                            <div class="card">
                                <div class="card-body text-center">
                                    <div style="position: relative; width: 100%; max-width: 640px; margin: 0 auto;">
                                        <video id="videoEscaner" style="width: 100%; height: auto; border-radius: 8px; background: #000;"></video>
                                    </div>
                                    <div id="mensajeEscaner" class="mt-3">
                                        <div class="alert alert-success">
                                            <i class="fas fa-camera"></i> <strong>Escáner ZXing activo - Lectura instantánea</strong>
                                            <p class="mb-0 mt-2 small">Apunta al código de barras, la lectura es AUTOMÁTICA e INMEDIATA</p>
                                        </div>
                                    </div>
                                    <button type="button" class="btn btn-danger btn-sm mt-2" onclick="detenerEscaner()">
                                        <i class="fas fa-stop"></i> Detener Cámara
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Input manual (oculto por defecto) -->
                        <div id="inputManualSerial" class="d-none mb-3">
                            <label class="form-label"><i class="fas fa-barcode"></i> Serial del Equipo *</label>
                            <input type="text" class="form-control form-control-lg" id="serialManual"
                                   placeholder="Ej: ABC123XYZ456"
                                   onkeyup="this.value = this.value.toUpperCase(); habilitarBotonSerial()">
                            <small class="text-muted">Ingresa el serial del modem/equipo manualmente</small>
                        </div>

                        <!-- Serial capturado (oculto por defecto) -->
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

    // Eliminar modal anterior si existe
    const modalAnterior = document.getElementById('modalSerialEquipo');
    if (modalAnterior) {
        modalAnterior.remove();
    }

    // Agregar modal al DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('modalSerialEquipo'));
    modal.show();
}

/**
 * Carga la librería ZXing desde CDN
 */
function cargarZXing() {
    return new Promise((resolve, reject) => {
        if (window.ZXing) {
            console.log('✅ [ZXING] Librería ya está cargada');
            resolve();
            return;
        }

        console.log('📦 [ZXING] Cargando librería ZXing...');
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
        script.onload = () => {
            console.log('✅ [ZXING] Librería ZXing cargada correctamente');
            resolve();
        };
        script.onerror = (error) => {
            console.error('❌ [ZXING] Error cargando ZXing:', error);
            reject(error);
        };
        document.head.appendChild(script);
    });
}

/**
 * Inicia el escáner de códigos de barras usando ZXing (RÁPIDO)
 */
async function iniciarEscanerCodigo() {
    try {
        console.log('📷 [ZXING] Iniciando escáner rápido...');

        // Ocultar opciones y mostrar área del escáner
        document.getElementById('opcionesCaptura').classList.add('d-none');
        document.getElementById('inputManualSerial').classList.add('d-none');
        document.getElementById('areaEscaner').classList.remove('d-none');
        document.getElementById('serialCapturado').classList.add('d-none');

        scannerActive = true;

        // Cargar ZXing library
        await cargarZXing();

        // Iniciar ZXing
        await iniciarZXing();

    } catch (error) {
        console.error('❌ [ZXING] Error accediendo a la cámara:', error);

        const mensajeDiv = document.getElementById('mensajeEscaner');
        if (mensajeDiv) {
            mensajeDiv.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle"></i>
                    No se pudo acceder a la cámara. Por favor, verifica los permisos o usa la opción "Escribir Serial".
                </div>
            `;
        }

        setTimeout(() => {
            detenerEscaner();
            mostrarInputManual();
        }, 3000);
    }
}

/**
 * Carga la librería QuaggaJS
 */
function cargarQuagga() {
    return new Promise((resolve, reject) => {
        if (window.Quagga) {
            console.log('✅ [ESCÁNER] QuaggaJS ya está cargado');
            resolve();
            return;
        }

        console.log('📦 [ESCÁNER] Cargando librería QuaggaJS...');
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.8.4/dist/quagga.min.js';
        script.onload = () => {
            console.log('✅ [ESCÁNER] QuaggaJS cargado correctamente');
            resolve();
        };
        script.onerror = (error) => {
            console.error('❌ [ESCÁNER] Error cargando QuaggaJS:', error);
            reject(error);
        };
        document.head.appendChild(script);
    });
}

/**
 * Inicializa QuaggaJS con configuración optimizada para códigos de barras lineales
 */
function iniciarQuagga() {
    return new Promise((resolve, reject) => {
        console.log('🔄 [ESCÁNER] Configurando QuaggaJS...');

        Quagga.init({
            inputStream: {
                name: "Live",
                type: "LiveStream",
                target: document.querySelector('#videoContainer'),
                constraints: {
                    facingMode: "environment", // Cámara trasera
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    aspectRatio: { ideal: 1.777 },
                    focusMode: "continuous"
                },
                area: {
                    top: "15%",
                    right: "5%",
                    left: "5%",
                    bottom: "15%"
                },
                size: 800
            },
            frequency: 10,
            locator: {
                patchSize: "large",
                halfSample: false
            },
            numOfWorkers: 2,
            decoder: {
                readers: [
                    "code_128_reader",
                    "code_39_reader",
                    "ean_reader",
                    "ean_8_reader",
                    "code_39_vin_reader",
                    "codabar_reader",
                    "upc_reader",
                    "upc_e_reader",
                    "i2of5_reader",
                    "2of5_reader",
                    "code_93_reader"
                ],
                debug: {
                    drawBoundingBox: false,
                    showFrequency: false,
                    drawScanline: false,
                    showPattern: false
                },
                multiple: false
            },
            locate: true
        }, function(err) {
            if (err) {
                console.error('❌ [ESCÁNER] Error inicializando QuaggaJS:', err);
                reject(err);
                return;
            }

            console.log('✅ [ESCÁNER] QuaggaJS inicializado correctamente');
            quaggaIniciado = true;

            // Ajustar estilos del video y canvas para evitar zoom
            const videoContainer = document.querySelector('#videoContainer');
            if (videoContainer) {
                const video = videoContainer.querySelector('video');
                const canvas = videoContainer.querySelector('canvas');

                if (video) {
                    video.style.width = '100%';
                    video.style.height = 'auto';
                    video.style.objectFit = 'contain';
                    video.style.maxWidth = '640px';
                    console.log('📹 [ESCÁNER] Video ajustado:', video.videoWidth, 'x', video.videoHeight);
                }

                if (canvas) {
                    canvas.style.width = '100%';
                    canvas.style.height = 'auto';
                    canvas.style.objectFit = 'contain';
                    canvas.style.maxWidth = '640px';
                }
            }

            // Actualizar mensaje
            const mensajeDiv = document.getElementById('mensajeEscaner');
            if (mensajeDiv) {
                mensajeDiv.innerHTML = `
                    <div class="alert alert-success mb-2">
                        <i class="fas fa-check-circle"></i> <strong>Escáner activo - Listo para leer</strong>
                    </div>
                    <div class="alert alert-info mb-0">
                        <strong><i class="fas fa-barcode"></i> Instrucciones:</strong>
                        <ul class="mb-0 mt-2 text-start small">
                            <li>Coloca el código <strong>HORIZONTAL</strong> dentro del recuadro verde</li>
                            <li>Mantén el código <strong>COMPLETO Y ENFOCADO</strong></li>
                            <li>Se confirmará automáticamente en 1-2 segundos</li>
                        </ul>
                    </div>
                `;
            }

            // AGREGAR GUÍAS VISUALES DESPUÉS DE QUAGGA
            agregarGuiasVisuales();

            // Iniciar escaneo
            Quagga.start();
            console.log('🎬 [ESCÁNER] QuaggaJS iniciado, escaneando...');

            // Contador de detecciones para filtrar falsos positivos
            let detecciones = {};
            let ultimaDeteccion = Date.now();

            // Listener para detección con validaciones estrictas para evitar falsas lecturas
            // OBJETIVO: Solo aceptar códigos de barras completos y válidos
            Quagga.onDetected(function(result) {
                const codigo = result.codeResult.code;
                const formato = result.codeResult.format;

                // ========================================
                // VALIDACIONES PARA CÓDIGOS COMPLETOS
                // ========================================

                // VALIDACIÓN 1: Longitud mínima del código (al menos 6 caracteres para ser más flexible)
                if (!codigo || codigo.length < 6) {
                    console.log(`⚠️ [ESCÁNER] Código demasiado corto (${codigo?.length || 0} chars), ignorando: ${codigo}`);
                    return;
                }

                // VALIDACIÓN 2: Longitud máxima razonable (máximo 35 caracteres)
                if (codigo.length > 35) {
                    console.log(`⚠️ [ESCÁNER] Código demasiado largo (${codigo.length} chars), ignorando: ${codigo}`);
                    return;
                }

                // VALIDACIÓN 3: Solo permitir caracteres alfanuméricos, guiones y espacios
                const formatoValido = /^[A-Z0-9\-\s]+$/i.test(codigo);
                if (!formatoValido) {
                    console.log(`⚠️ [ESCÁNER] Código con caracteres inválidos, ignorando: ${codigo}`);
                    return;
                }

                console.log(`🔍 [ESCÁNER] Detectado: ${codigo} (${formato})`);

                // Filtrar falsos positivos: requiere al menos 3 detecciones consecutivas del mismo código
                if (!detecciones[codigo]) {
                    detecciones[codigo] = 1;
                } else {
                    detecciones[codigo]++;
                }

                // Limpiar detecciones antiguas cada 2 segundos
                const ahora = Date.now();
                if (ahora - ultimaDeteccion > 2000) {
                    console.log(`🔄 [ESCÁNER] Limpiando detecciones antiguas`);
                    detecciones = {};
                    // Ocultar progreso visual cuando se limpian detecciones
                    const progresoDiv = document.getElementById('progresoDeteccion');
                    if (progresoDiv) {
                        progresoDiv.classList.add('d-none');
                    }
                }
                ultimaDeteccion = ahora;

                // Actualizar interfaz de progreso visual
                const progresoDiv = document.getElementById('progresoDeteccion');
                const codigoActualSpan = document.getElementById('codigoActual');
                const contadorSpan = document.getElementById('contadorDeteccion');
                const barraProgreso = document.getElementById('barraProgreso');

                if (progresoDiv && codigoActualSpan && contadorSpan && barraProgreso) {
                    progresoDiv.classList.remove('d-none');
                    codigoActualSpan.textContent = codigo;
                    contadorSpan.textContent = `${detecciones[codigo]}/3`;

                    // Actualizar barra de progreso
                    const porcentaje = (detecciones[codigo] / 3) * 100;
                    barraProgreso.style.width = `${porcentaje}%`;

                    // Cambiar color según el progreso
                    if (detecciones[codigo] >= 2) {
                        barraProgreso.className = 'progress-bar progress-bar-striped progress-bar-animated bg-success';
                    } else {
                        barraProgreso.className = 'progress-bar progress-bar-striped progress-bar-animated bg-warning';
                    }
                }

                // Mostrar progreso de detección
                console.log(`📊 [ESCÁNER] Progreso: ${codigo} detectado ${detecciones[codigo]}/3 veces`);

                // Si se detectó 3 o más veces, es confiable
                if (detecciones[codigo] >= 3) {
                    console.log(`✅ [ESCÁNER] Código confirmado (${detecciones[codigo]} detecciones): ${codigo}`);

                    // Reproducir sonido de confirmación
                    try {
                        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHwtWEcBjiP1/LNeisFJHfH8N2RQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYHGWi77eWhUQ0NTqXh7K9aFQxLpeHw=');
                        audio.play();
                    } catch (e) {
                        // Ignorar si no puede reproducir audio
                    }

                    // Normalizar el serial (quitar prefijo antes del guion si existe)
                    const serial = normalizarSerial(codigo);
                    console.log(`✅ [ESCÁNER] Serial normalizado: ${serial}`);

                    // Detener escáner
                    detenerEscaner();

                    // Mostrar serial capturado
                    document.getElementById('serialTexto').textContent = serial;
                    document.getElementById('areaEscaner').classList.add('d-none');
                    document.getElementById('serialCapturado').classList.remove('d-none');

                    // Guardar serial temporalmente
                    window.serialEquipoCapturado = serial;

                    // Verificar serial en BD
                    verificarSerialEnBD(serial);
                }
            });

            // Listener para procesamiento (opcional, para feedback)
            let procesados = 0;
            Quagga.onProcessed(function(result) {
                procesados++;
                if (procesados % 30 === 0) {
                    console.log(`🔄 [ESCÁNER] Frames procesados: ${procesados}`);
                }
            });

            resolve();
        });
    });
}

/**
 * Detiene el escáner y libera la cámara
 */
function detenerEscaner() {
    console.log('🛑 [ESCÁNER] Deteniendo escáner...');

    // Detener QuaggaJS
    if (quaggaIniciado) {
        try {
            Quagga.stop();
            quaggaIniciado = false;
            console.log('🛑 [ESCÁNER] QuaggaJS detenido');
        } catch (e) {
            console.warn('⚠️ [ESCÁNER] Error deteniendo QuaggaJS:', e);
        }
    }

    scannerActive = false;

    // Eliminar guías visuales
    const videoContainer = document.getElementById('videoContainer');
    if (videoContainer) {
        const guias = videoContainer.querySelector('.guias-overlay');
        if (guias) {
            guias.remove();
            console.log('🛑 [ESCÁNER] Guías visuales eliminadas');
        }
    }

    // Ocultar progreso de detección
    const progresoDiv = document.getElementById('progresoDeteccion');
    if (progresoDiv) {
        progresoDiv.classList.add('d-none');
    }

    // Mostrar opciones nuevamente
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
 * Muestra el input para escribir el serial manualmente
 */
function mostrarInputManual() {
    // Detener escáner si está activo
    detenerEscaner();

    // Ocultar opciones y mostrar input
    document.getElementById('opcionesCaptura').classList.add('d-none');
    document.getElementById('areaEscaner').classList.add('d-none');
    document.getElementById('inputManualSerial').classList.remove('d-none');
    document.getElementById('serialCapturado').classList.add('d-none');

    const inputSerial = document.getElementById('serialManual');
    inputSerial.focus();
}

/**
 * Habilita el botón de confirmar cuando se escribe un serial válido
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
 * Permite recapturar el serial
 */
function recapturarSerial() {
    // Mostrar opciones nuevamente
    document.getElementById('opcionesCaptura').classList.remove('d-none');
    document.getElementById('inputManualSerial').classList.add('d-none');
    document.getElementById('areaEscaner').classList.add('d-none');
    document.getElementById('serialCapturado').classList.add('d-none');
    document.getElementById('estadoVerificacion').innerHTML = '';

    // Limpiar input
    const inputSerial = document.getElementById('serialManual');
    if (inputSerial) {
        inputSerial.value = '';
    }

    // Resetear botón
    const btnConfirmar = document.getElementById('btnConfirmarSerial');
    btnConfirmar.disabled = true;
    btnConfirmar.classList.remove('btn-primary');
    btnConfirmar.classList.add('btn-secondary');
    btnConfirmar.innerHTML = '<i class="fas fa-check"></i> Confirmar Serial';
    btnConfirmar.onclick = confirmarSerialEquipo;

    // Limpiar serial guardado
    window.serialEquipoCapturado = null;
}

/**
 * Confirma y verifica el serial del equipo
 */
async function confirmarSerialEquipo() {
    const serialRaw = document.getElementById('serialManual')?.value?.trim();

    if (!serialRaw) {
        alert('Por favor, ingresa un serial válido');
        return;
    }

    // Normalizar el serial (quitar prefijo antes del guion si existe)
    const serialNormalizado = normalizarSerial(serialRaw);

    console.log(`✅ [SERIAL] Serial capturado (raw): ${serialRaw}`);
    console.log(`✅ [SERIAL] Serial normalizado: ${serialNormalizado}`);

    // Mostrar serial normalizado
    document.getElementById('serialTexto').textContent = serialNormalizado;
    document.getElementById('inputManualSerial').classList.add('d-none');
    document.getElementById('serialCapturado').classList.remove('d-none');

    // Verificar serial normalizado en la base de datos
    await verificarSerialEnBD(serialNormalizado);
}

/**
 * Verifica si el serial ya existe en la BD
 */
async function verificarSerialEnBD(serial) {
    const estadoDiv = document.getElementById('estadoVerificacion');
    estadoDiv.innerHTML = `
        <div class="alert alert-info">
            <i class="fas fa-spinner fa-spin"></i> Verificando serial en base de datos...
        </div>
    `;

    try {
        const token = localStorage.getItem('token_tecnico');
        const visitaId = window.visitaIdActual; // Obtener ID de la visita actual

        console.log(`🔍 [VERIFICAR SERIAL] Enviando: serial=${serial}, visitaId=${visitaId}`);

        const response = await fetch('/api/verificar-serial', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                serialEquipo: serial,
                visitaId: visitaId  // Enviar visitaId para verificar en BD específica
            })
        });

        const data = await response.json();
        console.log('🔍 [VERIFICAR SERIAL] Resultado:', data);

        if (!data.success) {
            // Error en la verificación
            estadoDiv.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-times-circle"></i> ${data.message || 'Error verificando serial'}
                </div>
            `;
            // Limpiar serial capturado
            window.serialEquipoCapturado = null;
            // Deshabilitar botón
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = true;
            btnConfirmar.classList.remove('btn-primary');
            btnConfirmar.classList.add('btn-secondary');
            return;
        }

        if (data.estaAsignado && !data.esDelMismoCliente) {
            // Equipo asignado a OTRO cliente - BLOQUEAR
            const equipo = data.equipos[0];
            estadoDiv.innerHTML = `
                <div class="alert alert-danger">
                    <h6><i class="fas fa-ban"></i> ⛔ ERROR: MODEM YA ASIGNADO</h6>
                    <hr>
                    <p class="mb-2"><strong>Este modem ya lo tiene cargado el siguiente cliente:</strong></p>
                    <div class="bg-white p-2 rounded border border-danger mb-2">
                        <p class="mb-1"><strong>Nombre:</strong> <span class="text-danger">${equipo.cliente_nombre || 'Desconocido'}</span></p>
                        <p class="mb-0"><strong>Cédula:</strong> ${equipo.cliente_cedula || 'N/A'}</p>
                    </div>
                    <hr>
                    <p class="mb-1 text-danger fw-bold"><i class="fas fa-exclamation-triangle"></i> NO PUEDES CONTINUAR CON ESTA INSTALACIÓN</p>
                    <p class="mb-0"><strong>Por favor, comunícate con soporte técnico para que te ayuden a resolver este problema.</strong></p>
                </div>
            `;

            // Limpiar serial capturado
            window.serialEquipoCapturado = null;

            // Deshabilitar botón de continuar
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = true;
            btnConfirmar.classList.remove('btn-primary');
            btnConfirmar.classList.add('btn-secondary');
            btnConfirmar.textContent = 'No Disponible';

        } else if (data.estaAsignado && data.esDelMismoCliente) {
            // Equipo asignado al MISMO cliente - Permitir
            const equipo = data.equipos[0];
            estadoDiv.innerHTML = `
                <div class="alert alert-info">
                    <h6><i class="fas fa-info-circle"></i> Equipo Ya Asignado a Este Cliente</h6>
                    <p><strong>Cliente:</strong> ${equipo.cliente_nombre || 'Desconocido'}</p>
                    <p><strong>Estado:</strong> ${equipo.estado}</p>
                    <p class="mb-0">Este equipo ya está asignado a este cliente. Se actualizará el registro.</p>
                </div>
            `;

            // Permitir continuar
            window.serialEquipoCapturado = serial;
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = false;
            btnConfirmar.classList.remove('btn-secondary');
            btnConfirmar.classList.add('btn-primary');
            btnConfirmar.textContent = 'Guardar y Continuar';
            btnConfirmar.onclick = guardarSerialYContinuar;

        } else if (data.existe && !data.estaAsignado) {
            // Equipo existe pero NO asignado - Disponible
            estadoDiv.innerHTML = `
                <div class="alert alert-success">
                    <i class="fas fa-check-circle"></i> Serial verificado. Equipo disponible para asignar.
                </div>
            `;

            // Permitir continuar
            window.serialEquipoCapturado = serial;
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = false;
            btnConfirmar.classList.remove('btn-secondary');
            btnConfirmar.classList.add('btn-primary');
            btnConfirmar.textContent = 'Guardar y Continuar';
            btnConfirmar.onclick = guardarSerialYContinuar;

        } else {
            // Serial NO existe - Se creará nuevo
            estadoDiv.innerHTML = `
                <div class="alert alert-info">
                    <i class="fas fa-plus-circle"></i> Serial no encontrado. Se creará un nuevo registro al completar la visita.
                </div>
            `;

            // Permitir continuar
            window.serialEquipoCapturado = serial;
            const btnConfirmar = document.getElementById('btnConfirmarSerial');
            btnConfirmar.disabled = false;
            btnConfirmar.classList.remove('btn-secondary');
            btnConfirmar.classList.add('btn-primary');
            btnConfirmar.textContent = 'Guardar y Continuar';
            btnConfirmar.onclick = guardarSerialYContinuar;
        }

    } catch (error) {
        console.error('❌ [VERIFICAR SERIAL] Error:', error);
        estadoDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-times-circle"></i> Error verificando serial. Intenta nuevamente.
            </div>
        `;

        // Limpiar serial y deshabilitar botón
        window.serialEquipoCapturado = null;
        const btnConfirmar = document.getElementById('btnConfirmarSerial');
        btnConfirmar.disabled = true;
        btnConfirmar.classList.remove('btn-primary');
        btnConfirmar.classList.add('btn-secondary');
    }
}

/**
 * Guarda el serial y cierra el modal
 */
function guardarSerialYContinuar() {
    if (!window.serialEquipoCapturado) {
        alert('No se ha capturado ningún serial');
        return;
    }

    console.log(`✅ [SERIAL] Serial guardado: ${window.serialEquipoCapturado}`);

    // Mostrar el serial en la interfaz de visitas
    const infoDiv = document.getElementById('serialCapturadoInfo');
    if (infoDiv) {
        infoDiv.innerHTML = `
            <div class="alert alert-success mt-2">
                <i class="fas fa-check-circle"></i> <strong>Serial capturado:</strong>
                <span class="font-monospace fw-bold d-block fs-6 mt-1">${window.serialEquipoCapturado}</span>
            </div>
        `;
    }

    // Cerrar modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('modalSerialEquipo'));
    modal.hide();

    // Limpiar modal del DOM
    setTimeout(() => {
        document.getElementById('modalSerialEquipo')?.remove();
    }, 300);
}

/**
 * Cierra el modal y limpia recursos
 */
function cerrarEscanerSerial() {
    detenerEscaner();
    window.serialEquipoCapturado = null;
    const infoDiv = document.getElementById('serialCapturadoInfo');
    if (infoDiv) {
        infoDiv.innerHTML = '';
    }
}

/**
 * Asigna el equipo al cliente cuando se completa la visita
 */
async function asignarEquipoAlCompletar(visitaId, serialEquipo) {
    try {
        console.log(`📦 [ASIGNAR] Asignando equipo ${serialEquipo} a visita ${visitaId}`);

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
        console.log('📦 [ASIGNAR] Resultado:', data);

        if (data.success) {
            console.log(`✅ [ASIGNAR] Equipo asignado exitosamente`);
            return { success: true, message: data.message };
        } else {
            console.error(`❌ [ASIGNAR] Error:`, data.message);
            return { success: false, message: data.message };
        }

    } catch (error) {
        console.error('❌ [ASIGNAR] Error asignando equipo:', error);
        return { success: false, message: 'Error al asignar equipo' };
    }
}

// Exportar funciones globalmente
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

console.log('✅ [SERIAL SCANNER] Módulo QuaggaJS OPTIMIZADO para lectura rápida');
console.log('🔒 [VALIDACIONES]:');
console.log('   ✓ Longitud: 6-35 caracteres');
console.log('   ✓ Formato: Alfanumérico + guiones');
console.log('   ✓ Requiere 3 detecciones (1-2 segundos)');
console.log('   ✓ Área de escaneo ampliada');
console.log('   ✓ Resolución HD (1280x720)');
console.log('   ✓ Feedback visual con barra de progreso');
