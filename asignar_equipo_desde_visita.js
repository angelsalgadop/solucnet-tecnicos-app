const mysql = require('mysql2/promise');

// Configuración de bases de datos
const basesDatos = [
    { host: '192.168.99.50', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', zonas: ['REPOSO', 'SALVADOR', 'MI LUCHA'] },
    { host: '192.168.99.11', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', zonas: ['CHURIDO'] },
    { host: '192.168.99.2', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', zonas: ['OSITO', 'RIO GRANDE', 'SALSIPUEDES'] }
];

const dbSistema = {
    host: 'localhost',
    user: 'debian-sys-maint',
    password: 'IOHcXunF7795fMRI',
    database: 'solucnet_auth_system'
};

/**
 * Determina la zona/BD correcta basándose en la localidad o dirección del cliente
 * @param {string} localidad - Localidad del cliente
 * @param {string} direccion - Dirección del cliente
 * @returns {Object|null} Configuración de la BD correspondiente
 */
function determinarZonaPorLocalidad(localidad, direccion) {
    // Texto combinado para buscar
    const textoCompleto = `${localidad || ''} ${direccion || ''}`.toUpperCase();

    console.log(`🔍 [DETERMINAR ZONA] Buscando zona en: "${textoCompleto}"`);

    // Buscar en cada base de datos
    for (const bdConfig of basesDatos) {
        for (const zona of bdConfig.zonas) {
            if (textoCompleto.includes(zona)) {
                console.log(`✅ [DETERMINAR ZONA] Encontrada zona "${zona}" -> BD: ${bdConfig.host}`);
                return bdConfig;
            }
        }
    }

    // Si no se encuentra, usar Reposo por defecto (192.168.99.50)
    console.log(`⚠️ [DETERMINAR ZONA] No se pudo determinar zona, usando Reposo (192.168.99.50) por defecto`);
    return basesDatos[0]; // Reposo
}

/**
 * Asigna un equipo (modem o tv box) a un cliente basándose en la información de la visita
 *
 * @param {number} visitaId - ID de la visita técnica
 * @param {string} serialEquipo - Serial del equipo a asignar
 * @param {number} costoEquipo - Costo del equipo (por defecto 180000)
 * @param {string} tipoEquipo - Tipo de equipo (por defecto 'Onu CData')
 * @returns {Promise<Object>} Resultado de la operación
 */
async function asignarEquipoDesdeVisita(visitaId, serialEquipo, costoEquipo = 180000, tipoEquipo = 'Onu CData') {
    let conexionSistema, conexionBD;
    let equiposLiberados = []; // Para rastrear equipos liberados

    try {
        console.log(`📦 [ASIGNAR EQUIPO] Iniciando asignación para visita ${visitaId}, serial: ${serialEquipo}`);

        // Conectar a base de datos del sistema
        conexionSistema = await mysql.createConnection(dbSistema);
        await conexionSistema.query('USE solucnet_auth_system');

        // Obtener información de la visita
        const [visitas] = await conexionSistema.execute(
            'SELECT * FROM visitas_tecnicas WHERE id = ?',
            [visitaId]
        );

        if (visitas.length === 0) {
            return {
                success: false,
                message: 'Visita no encontrada'
            };
        }

        const visita = visitas[0];
        let bdOrigen = visita.bd_origen;
        const clienteCedula = visita.cliente_cedula;

        console.log(`✅ [ASIGNAR EQUIPO] Visita encontrada: Cliente ${visita.cliente_nombre} (${clienteCedula}), BD origen: ${bdOrigen}`);

        // Buscar la configuración de la BD origen
        let bdConfig;

        // Si bd_origen es "nuevos_clientes", determinar la zona por localidad/dirección
        if (bdOrigen === 'nuevos_clientes' || bdOrigen === 'solucnet.com') {
            console.log(`🆕 [ASIGNAR EQUIPO] Cliente nuevo detectado, determinando zona por localidad...`);
            bdConfig = determinarZonaPorLocalidad(visita.localidad, visita.cliente_direccion);
            bdOrigen = bdConfig.host; // Actualizar bd_origen con la IP real
            console.log(`✅ [ASIGNAR EQUIPO] Zona determinada: ${bdOrigen}`);
        } else {
            bdConfig = basesDatos.find(bd => bd.host === bdOrigen);

            // 🔧 v1.66: Si no se encuentra la BD (ej: sistema_pruebas, null, etc), usar Reposo por defecto
            if (!bdConfig) {
                console.warn(`⚠️ [ASIGNAR EQUIPO] BD origen "${bdOrigen}" no encontrada en configuración, usando Reposo (192.168.99.50) por defecto`);
                bdConfig = basesDatos[0]; // Reposo
                bdOrigen = bdConfig.host;
            }
        }

        // Conectar a la BD externa (Mikrowisp)
        console.log(`🔗 [ASIGNAR EQUIPO] Conectando a BD externa: ${bdOrigen}`);
        conexionBD = await mysql.createConnection(bdConfig);
        await conexionBD.query(`USE ${bdConfig.database}`);

        // Buscar el cliente en la BD externa
        const [clientes] = await conexionBD.execute(
            'SELECT id FROM usuarios WHERE cedula = ? LIMIT 1',
            [clienteCedula]
        );

        if (clientes.length === 0) {
            return {
                success: false,
                message: `Cliente con cédula ${clienteCedula} no encontrado en BD ${bdOrigen}`
            };
        }

        const clienteId = clientes[0].id;
        console.log(`✅ [ASIGNAR EQUIPO] Cliente encontrado en BD externa: ID ${clienteId}`);

        // 🔄 LIBERAR EQUIPOS ANTERIORES DEL CLIENTE (SOLO DEL MISMO TIPO)
        // Determinar si el tipo es TV BOX o MODEM para liberar solo equipos del mismo tipo
        const esTvBox = tipoEquipo.toUpperCase().includes('TV') && tipoEquipo.toUpperCase().includes('BOX');
        const categoriaEquipo = esTvBox ? 'TV BOX' : 'MODEM/ONU';

        console.log(`📌 [ASIGNAR EQUIPO] Tipo de equipo a asignar: "${tipoEquipo}", Categoría: ${categoriaEquipo}, Es TV BOX: ${esTvBox}`);

        // Buscar equipos actualmente asignados al cliente
        const [equiposAnteriores] = await conexionBD.execute(
            `SELECT a.id, a.serial_producto, a.estado, p.producto as tipo_producto
             FROM almacen a
             LEFT JOIN productos p ON a.productoid = p.id
             WHERE a.userid = ?
             AND a.estado IN ('comodato', 'vendido', 'prestado')
             AND a.serial_producto IS NOT NULL
             AND a.serial_producto != ''
             AND a.serial_producto != ?`,
            [clienteId.toString().padStart(6, '0'), serialEquipo]
        );

        if (equiposAnteriores.length > 0) {
            console.log(`🔄 [ASIGNAR EQUIPO] Cliente tiene ${equiposAnteriores.length} equipo(s) asignado(s), filtrando por tipo...`);

            for (const equipoAnterior of equiposAnteriores) {
                const tipoAnterior = (equipoAnterior.tipo_producto || '').toUpperCase();
                const esAnteriorTvBox = tipoAnterior.includes('TV') && tipoAnterior.includes('BOX');

                console.log(`   🔍 Equipo anterior: "${equipoAnterior.tipo_producto}", Serial: ${equipoAnterior.serial_producto}, Es TV BOX: ${esAnteriorTvBox}`);

                // Solo liberar si es del mismo tipo:
                // - Si estoy asignando TV BOX, solo libero TV BOX anteriores
                // - Si estoy asignando MODEM, solo libero MODEMS anteriores (Onu CData, ONU ZTE, etc.)
                const deberiaLiberar = (esTvBox && esAnteriorTvBox) || (!esTvBox && !esAnteriorTvBox);

                if (deberiaLiberar) {
                    console.log(`   🔓 [LIBERAR] Liberando equipo del mismo tipo (${equipoAnterior.tipo_producto}): ${equipoAnterior.serial_producto}`);

                    await conexionBD.execute(
                        `UPDATE almacen
                         SET userid = '000000',
                             estado = 'disponible',
                             fecha_salida = NULL
                         WHERE id = ?`,
                        [equipoAnterior.id]
                    );

                    // Registrar equipo liberado
                    equiposLiberados.push(equipoAnterior.serial_producto);

                    console.log(`   ✅ [LIBERADO] ${equipoAnterior.serial_producto}`);
                } else {
                    console.log(`   ⏭️ [MANTENER] Equipo de tipo diferente (${equipoAnterior.tipo_producto}): ${equipoAnterior.serial_producto} - NO SE TOCA`);
                }
            }
        } else {
            console.log(`ℹ️ [ASIGNAR EQUIPO] Cliente no tiene equipos anteriores asignados`);
        }

        // Verificar si el producto existe (buscar por el tipo específico)
        console.log(`🔍 [ASIGNAR EQUIPO] Buscando producto tipo: ${tipoEquipo}`);

        let productoId;

        if (esTvBox) {
            // Para TV BOX, buscar cualquier producto que contenga "TV" y "BOX"
            const [productos] = await conexionBD.execute(
                "SELECT id, producto FROM productos WHERE UPPER(producto) LIKE '%TV%' AND UPPER(producto) LIKE '%BOX%' LIMIT 1"
            );

            if (productos.length === 0) {
                // Crear producto TV BOX si no existe
                console.log(`⚠️ [ASIGNAR EQUIPO] Producto TV BOX no encontrado, creando...`);
                const [resultProducto] = await conexionBD.execute(
                    `INSERT INTO productos (producto, descripcion, costo, medida, tipo, impuesto, clave_invoice)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        'TV BOX',
                        'TV BOX Serial {producto_serial}',
                        costoEquipo,
                        'unidades',
                        'producto',
                        0.00,
                        ''
                    ]
                );
                productoId = resultProducto.insertId;
                console.log(`✅ [ASIGNAR EQUIPO] Producto "TV BOX" creado con ID: ${productoId}`);
            } else {
                productoId = productos[0].id;
                console.log(`✅ [ASIGNAR EQUIPO] Producto TV BOX encontrado: "${productos[0].producto}" (ID: ${productoId})`);
            }
        } else {
            // Para MODEMS, buscar el producto específico (Onu CData)
            const [productos] = await conexionBD.execute(
                'SELECT id FROM productos WHERE producto LIKE ? LIMIT 1',
                ['%Onu CData%']
            );

            if (productos.length === 0) {
                // Crear producto Onu CData si no existe
                console.log(`⚠️ [ASIGNAR EQUIPO] Producto "Onu CData" no encontrado, creando...`);
                const [resultProducto] = await conexionBD.execute(
                    `INSERT INTO productos (producto, descripcion, costo, medida, tipo, impuesto, clave_invoice)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        'Onu CData',
                        'Producto Serial {producto_serial} con Nº mac {producto_mac}',
                        costoEquipo,
                        'unidades',
                        'producto',
                        0.00,
                        ''
                    ]
                );
                productoId = resultProducto.insertId;
                console.log(`✅ [ASIGNAR EQUIPO] Producto "Onu CData" creado con ID: ${productoId}`);
            } else {
                productoId = productos[0].id;
                console.log(`✅ [ASIGNAR EQUIPO] Producto "Onu CData" encontrado: ID ${productoId}`);
            }
        }

        // DOBLE VERIFICACIÓN: Verificar si el equipo ya existe en almacén con información completa del cliente
        const [equiposExistentes] = await conexionBD.execute(
            `SELECT a.id, a.userid, a.estado, u.nombre as cliente_nombre, u.cedula as cliente_cedula, u.telefono as cliente_telefono
             FROM almacen a
             LEFT JOIN usuarios u ON a.userid = u.id
             WHERE a.serial_producto = ?
             LIMIT 1`,
            [serialEquipo]
        );

        let equipoAsignado = false;

        if (equiposExistentes.length > 0) {
            const equipoExistente = equiposExistentes[0];
            const useridStr = String(equipoExistente.userid || '').trim();
            const estaAsignadoAOtro = useridStr &&
                                      useridStr !== '000000' &&
                                      useridStr !== '0' &&
                                      useridStr !== '' &&
                                      useridStr !== clienteId.toString().padStart(6, '0');

            console.log(`🔍 [ASIGNAR EQUIPO - DOBLE CHECK] Equipo existente (ID: ${equipoExistente.id}):`, {
                userid: useridStr,
                estado: equipoExistente.estado,
                estaAsignadoAOtro: estaAsignadoAOtro,
                cliente_nombre: equipoExistente.cliente_nombre,
                cliente_cedula: equipoExistente.cliente_cedula
            });

            // Si ya está asignado a otro cliente, retornar error CON INFORMACIÓN COMPLETA
            if (estaAsignadoAOtro) {
                const mensajeError = `⛔ El equipo con serial ${serialEquipo} ya está asignado a otro cliente: ${equipoExistente.cliente_nombre || 'Desconocido'} (Cédula: ${equipoExistente.cliente_cedula || 'N/A'})`;
                console.error(`❌ [ASIGNAR EQUIPO] ${mensajeError}`);
                return {
                    success: false,
                    message: `El equipo con serial ${serialEquipo} ya está asignado a otro cliente`,
                    equipoInfo: {
                        cliente_nombre: equipoExistente.cliente_nombre,
                        cliente_cedula: equipoExistente.cliente_cedula,
                        cliente_telefono: equipoExistente.cliente_telefono
                    }
                };
            }

            // Si está disponible o asignado al mismo cliente, actualizar
            if (equipoExistente.estado === 'disponible' || equipoExistente.userid === '000000') {
                await conexionBD.execute(
                    `UPDATE almacen
                     SET userid = ?,
                         fecha_salida = CURDATE(),
                         estado = 'comodato',
                         costo = ?
                     WHERE id = ?`,
                    [clienteId.toString().padStart(6, '0'), costoEquipo, equipoExistente.id]
                );
                console.log(`✅ [ASIGNAR EQUIPO] Equipo existente actualizado y asignado al cliente`);
                equipoAsignado = true;
            } else {
                console.log(`✅ [ASIGNAR EQUIPO] Equipo ya está asignado correctamente`);
                equipoAsignado = true;
            }
        } else {
            // Insertar nuevo equipo en almacén y asignarlo directamente
            console.log(`📦 [ASIGNAR EQUIPO] Creando nuevo registro en almacén para serial: ${serialEquipo}`);
            await conexionBD.execute(
                `INSERT INTO almacen (
                    userid, productoid, serial_producto, mac_producto,
                    fecha_ingreso, fecha_salida, estado, cantidad, catid, costo, idproveedor
                ) VALUES (?, ?, ?, ?, CURDATE(), CURDATE(), ?, 1, ?, ?, 0)`,
                [
                    clienteId.toString().padStart(6, '0'),  // Cliente
                    productoId,                              // ID producto
                    serialEquipo,                            // Serial
                    '',                                      // MAC (vacío por ahora)
                    'comodato',                              // Estado
                    'producto',                              // Categoría
                    costoEquipo                              // Costo
                ]
            );
            console.log(`✅ [ASIGNAR EQUIPO] Equipo creado y asignado exitosamente`);
            equipoAsignado = true;
        }

        if (equipoAsignado) {
            // Actualizar la visita con el serial del equipo asignado
            await conexionSistema.execute(
                `UPDATE visitas_tecnicas
                 SET serial_equipo_asignado = ?,
                     equipo_tipo = ?,
                     equipo_estado = 'comodato'
                 WHERE id = ?`,
                [serialEquipo, tipoEquipo, visitaId]
            );
            console.log(`✅ [ASIGNAR EQUIPO] Visita actualizada con serial del equipo (Tipo: ${tipoEquipo})`);
        }

        // Construir mensaje de éxito
        let mensajeExito = `Equipo ${serialEquipo} asignado exitosamente al cliente ${visita.cliente_nombre} en comodato por $${costoEquipo.toLocaleString()}`;

        if (equiposLiberados.length > 0) {
            mensajeExito += `. Se liberó${equiposLiberados.length > 1 ? 'ron' : ''} ${equiposLiberados.length} equipo(s) anterior${equiposLiberados.length > 1 ? 'es' : ''}: ${equiposLiberados.join(', ')}`;
        }

        return {
            success: true,
            message: mensajeExito,
            equipoId: equiposExistentes.length > 0 ? equiposExistentes[0].id : null,
            clienteId: clienteId,
            equiposLiberados: equiposLiberados
        };

    } catch (error) {
        console.error(`❌ [ASIGNAR EQUIPO] Error:`, error.message);
        return {
            success: false,
            message: `Error asignando equipo: ${error.message}`
        };
    } finally {
        // Cerrar conexiones
        if (conexionSistema) {
            try {
                await conexionSistema.end();
            } catch (e) {
                console.error('Error cerrando conexión sistema:', e.message);
            }
        }
        if (conexionBD) {
            try {
                await conexionBD.end();
            } catch (e) {
                console.error('Error cerrando conexión BD:', e.message);
            }
        }
    }
}

/**
 * Verifica si un serial de equipo ya está asignado en la BD del cliente de la visita
 *
 * @param {string} serialEquipo - Serial del equipo a verificar
 * @param {number} visitaId - ID de la visita (opcional, para verificar en BD específica)
 * @returns {Promise<Object>} Información del equipo si existe
 */
async function verificarSerialEquipo(serialEquipo, visitaId = null) {
    let conexionSistema, conexionBD;

    try {
        // Si se proporciona visitaId, buscar solo en la BD del cliente de esa visita
        if (visitaId) {
            console.log(`🔍 [VERIFICAR SERIAL] Verificando serial ${serialEquipo} para visita ${visitaId}`);

            // Conectar a base de datos del sistema
            conexionSistema = await mysql.createConnection(dbSistema);
            await conexionSistema.query('USE solucnet_auth_system');

            // Obtener información de la visita
            const [visitas] = await conexionSistema.execute(
                'SELECT bd_origen, cliente_cedula, cliente_nombre, localidad, cliente_direccion FROM visitas_tecnicas WHERE id = ?',
                [visitaId]
            );

            if (visitas.length === 0) {
                return {
                    success: false,
                    message: 'Visita no encontrada',
                    existe: false,
                    equipos: []
                };
            }

            const visita = visitas[0];
            let bdOrigen = visita.bd_origen;
            const clienteCedula = visita.cliente_cedula;

            console.log(`✅ [VERIFICAR SERIAL] Visita encontrada: Cliente ${visita.cliente_nombre}, BD: ${bdOrigen}`);

            // Buscar la configuración de la BD origen
            let bdConfig;

            // Si bd_origen es "nuevos_clientes", determinar la zona por localidad/dirección
            if (bdOrigen === 'nuevos_clientes' || bdOrigen === 'solucnet.com') {
                console.log(`🆕 [VERIFICAR SERIAL] Cliente nuevo detectado, determinando zona por localidad...`);
                bdConfig = determinarZonaPorLocalidad(visita.localidad, visita.cliente_direccion);
                bdOrigen = bdConfig.host; // Actualizar bd_origen con la IP real
                console.log(`✅ [VERIFICAR SERIAL] Zona determinada: ${bdOrigen}`);
            } else {
                bdConfig = basesDatos.find(bd => bd.host === bdOrigen);

                // 🔧 v1.66: Si no se encuentra la BD (ej: sistema_pruebas, null, etc), usar Reposo por defecto
                if (!bdConfig) {
                    console.warn(`⚠️ [VERIFICAR SERIAL] BD origen "${bdOrigen}" no encontrada en configuración, usando Reposo (192.168.99.50) por defecto`);
                    bdConfig = basesDatos[0]; // Reposo
                    bdOrigen = bdConfig.host;
                }
            }

            // Conectar a la BD externa
            conexionBD = await mysql.createConnection(bdConfig);
            await conexionBD.query(`USE ${bdConfig.database}`);

            // Buscar el equipo en almacén
            const [equipos] = await conexionBD.execute(
                `SELECT
                    a.id,
                    a.userid,
                    a.serial_producto,
                    a.mac_producto,
                    a.estado,
                    a.costo,
                    p.producto as tipo_producto,
                    u.nombre as cliente_nombre,
                    u.cedula as cliente_cedula,
                    u.id as cliente_id
                 FROM almacen a
                 LEFT JOIN productos p ON a.productoid = p.id
                 LEFT JOIN usuarios u ON a.userid = u.id
                 WHERE a.serial_producto = ?
                 LIMIT 1`,
                [serialEquipo]
            );

            if (equipos.length > 0) {
                const equipo = equipos[0];

                // Validar si está asignado: userid no null, no undefined, no '000000', no vacío
                const useridStr = String(equipo.userid || '').trim();
                const estaAsignado = useridStr.length > 0 &&
                                     useridStr !== '000000' &&
                                     useridStr !== '0';

                // Comparar cédulas normalizadas (convertir a string y trim)
                const cedulaEquipo = String(equipo.cliente_cedula || '').trim();
                const cedulaVisita = String(clienteCedula || '').trim();
                const esDelMismoCliente = (cedulaEquipo.length > 0 && cedulaEquipo === cedulaVisita);

                console.log(`🔍 [VERIFICAR SERIAL] Equipo encontrado:`, {
                    id: equipo.id,
                    serial: equipo.serial_producto,
                    userid: useridStr,
                    userid_length: useridStr.length,
                    estado: equipo.estado,
                    estaAsignado: estaAsignado,
                    asignado_a: equipo.cliente_nombre || 'Sin asignar',
                    cedula_equipo: cedulaEquipo,
                    cedula_visita: cedulaVisita,
                    es_del_mismo_cliente: esDelMismoCliente
                });

                // Si está asignado a otro cliente, mostrar advertencia MUY CLARA
                if (estaAsignado && !esDelMismoCliente) {
                    console.error(`⛔⛔⛔ [VERIFICAR SERIAL] BLOQUEADO - EQUIPO YA ASIGNADO ⛔⛔⛔`);
                    console.error(`   Serial: ${equipo.serial_producto}`);
                    console.error(`   Cliente actual: ${equipo.cliente_nombre || 'Desconocido'}`);
                    console.error(`   Cédula actual: ${cedulaEquipo || 'N/A'}`);
                    console.error(`   Cliente de visita: ${cedulaVisita}`);
                    console.error(`⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔⛔`);
                }

                return {
                    success: true,
                    existe: true,
                    estaAsignado: estaAsignado,
                    esDelMismoCliente: esDelMismoCliente,
                    equipos: [{
                        ...equipo,
                        bd_origen: bdConfig.host
                    }]
                };
            } else {
                console.log(`ℹ️ [VERIFICAR SERIAL] Serial no encontrado en almacén. Se creará al completar la visita.`);
                return {
                    success: true,
                    existe: false,
                    estaAsignado: false,
                    equipos: []
                };
            }
        }

        // Si no se proporciona visitaId, buscar en todas las BDs (comportamiento anterior)
        const resultados = [];

        for (const bdConfig of basesDatos) {
            try {
                const conexion = await mysql.createConnection(bdConfig);
                await conexion.query(`USE ${bdConfig.database}`);

                const [equipos] = await conexion.execute(
                    `SELECT
                        a.id,
                        a.userid,
                        a.serial_producto,
                        a.mac_producto,
                        a.estado,
                        a.costo,
                        p.producto as tipo_producto,
                        u.nombre as cliente_nombre,
                        u.cedula as cliente_cedula
                     FROM almacen a
                     LEFT JOIN productos p ON a.productoid = p.id
                     LEFT JOIN usuarios u ON a.userid = u.id
                     WHERE a.serial_producto = ?
                     LIMIT 1`,
                    [serialEquipo]
                );

                if (equipos.length > 0) {
                    resultados.push({
                        ...equipos[0],
                        bd_origen: bdConfig.host
                    });
                }

                await conexion.end();
            } catch (error) {
                console.error(`Error verificando serial en BD ${bdConfig.host}:`, error.message);
            }
        }

        const estaAsignado = resultados.length > 0 && resultados[0].userid && resultados[0].userid !== '000000';

        return {
            success: true,
            existe: resultados.length > 0,
            estaAsignado: estaAsignado,
            equipos: resultados
        };

    } catch (error) {
        console.error(`❌ [VERIFICAR SERIAL] Error:`, error.message);
        return {
            success: false,
            message: `Error verificando serial: ${error.message}`,
            existe: false,
            equipos: []
        };
    } finally {
        if (conexionSistema) {
            try {
                await conexionSistema.end();
            } catch (e) {
                console.error('Error cerrando conexión sistema:', e.message);
            }
        }
        if (conexionBD) {
            try {
                await conexionBD.end();
            } catch (e) {
                console.error('Error cerrando conexión BD:', e.message);
            }
        }
    }
}

module.exports = {
    asignarEquipoDesdeVisita,
    verificarSerialEquipo
};
