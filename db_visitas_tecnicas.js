const mysql = require('mysql2/promise');
const { actualizarCoordenadasCliente } = require('./db');

// Importar configuraciones de base de datos
// 🔧 v1.83.12: Timeout de 2 segundos para conexiones a BDs externas
// Evita que requests lentos a BDs inalcanzables bloqueen la app móvil
const basesDatos = [
    { host: '192.168.99.50', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', connectTimeout: 2000 },
    { host: '192.168.99.11', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', connectTimeout: 2000 },
    { host: '192.168.99.2', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6', connectTimeout: 2000 },
    { host: '192.168.99.51', user: 'ADFZ2I', password: 'MOZ1BWZ86BRMXFW', database: 'Mikrowisp6', connectTimeout: 2000 }
];

const dbSistema = {
    host: process.env.DB_SYSTEM_HOST || 'localhost',
    user: process.env.DB_SYSTEM_USER || 'debian-sys-maint',
    password: process.env.DB_SYSTEM_PASSWORD || 'IOHcXunF7795fMRI',
    database: 'solucnet_auth_system'
};

// Función para inicializar las tablas del sistema de visitas técnicas
async function inicializarSistemaVisitas() {
    try {
        // Conectar a la base de datos del sistema
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Tabla de visitas técnicas
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS visitas_tecnicas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cliente_id INT NOT NULL,
                cliente_nombre VARCHAR(100) NOT NULL,
                cliente_cedula VARCHAR(20) NOT NULL,
                cliente_telefono VARCHAR(20) NOT NULL,
                cliente_coordenadas TEXT,
                mikrotik_nombre VARCHAR(100),
                usuario_ppp VARCHAR(50),
                motivo_visita TEXT NOT NULL,
                estado ENUM('programada', 'asignada', 'en_progreso', 'completada', 'cancelada') DEFAULT 'programada',
                tecnico_asignado_id INT NULL,
                tecnico_asignado_nombre VARCHAR(100) NULL,
                fecha_programada DATE NOT NULL,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_completada TIMESTAMP NULL,
                creado_por INT NOT NULL,
                notas_admin TEXT,
                bd_origen VARCHAR(50) NOT NULL,
                INDEX idx_estado (estado),
                INDEX idx_fecha_programada (fecha_programada),
                INDEX idx_tecnico (tecnico_asignado_id),
                INDEX idx_cliente_cedula (cliente_cedula),
                FOREIGN KEY (creado_por) REFERENCES usuarios_sistema(id)
            )
        `);

        // Agregar nuevas columnas si no existen (para compatibilidad con tablas existentes)
        try {
            // Verificar si las columnas existen y agregarlas si no
            const [columns] = await conexion.execute(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'solucnet_auth_system'
                AND TABLE_NAME = 'visitas_tecnicas'
            `);

            const columnNames = columns.map(col => col.COLUMN_NAME);

            if (!columnNames.includes('mikrotik_nombre')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN mikrotik_nombre VARCHAR(100)`);
                console.log('✅ Columna mikrotik_nombre agregada');
            }

            if (!columnNames.includes('usuario_ppp')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN usuario_ppp VARCHAR(50)`);
                console.log('✅ Columna usuario_ppp agregada');
            }

            if (!columnNames.includes('cliente_direccion')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN cliente_direccion TEXT`);
                console.log('✅ Columna cliente_direccion agregada');
            }

            if (!columnNames.includes('cliente_movil')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN cliente_movil VARCHAR(100)`);
                console.log('✅ Columna cliente_movil agregada (VARCHAR(100))');
            } else {
                // Verificar y actualizar tamaño de columna si es necesario
                try {
                    const [columnInfo] = await conexion.execute(`
                        SELECT CHARACTER_MAXIMUM_LENGTH
                        FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_NAME = 'visitas_tecnicas'
                        AND COLUMN_NAME = 'cliente_movil'
                        AND TABLE_SCHEMA = DATABASE()
                    `);

                    if (columnInfo.length > 0 && columnInfo[0].CHARACTER_MAXIMUM_LENGTH < 100) {
                        await conexion.execute(`ALTER TABLE visitas_tecnicas MODIFY cliente_movil VARCHAR(100)`);
                        console.log('✅ Columna cliente_movil actualizada a VARCHAR(100)');
                    }
                } catch (error) {
                    console.log('⚠️ No se pudo verificar/actualizar tamaño de cliente_movil:', error.message);
                }
            }

            if (!columnNames.includes('fecha_modificacion')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN fecha_modificacion TIMESTAMP NULL`);
                console.log('✅ Columna fecha_modificacion agregada');
            }

            if (!columnNames.includes('observacion')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN observacion TEXT`);
                console.log('✅ Columna observacion agregada');
            }

            if (!columnNames.includes('localidad')) {
                await conexion.execute(`ALTER TABLE visitas_tecnicas ADD COLUMN localidad VARCHAR(100)`);
                console.log('✅ Columna localidad agregada');
            }

            // Modificar fecha_programada para permitir NULL (para visitas sin asignar)
            try {
                await conexion.execute(`ALTER TABLE visitas_tecnicas MODIFY fecha_programada DATE NULL`);
                console.log('✅ Columna fecha_programada modificada para permitir NULL');
            } catch (alterError) {
                console.log('⚠️ No se pudo modificar fecha_programada (puede que ya permita NULL):', alterError.message);
            }

        } catch (error) {
            console.log('❌ Error agregando columnas:', error.message);
        }

        // Tabla de técnicos
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS tecnicos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                cedula VARCHAR(20) UNIQUE NOT NULL,
                telefono VARCHAR(20) NOT NULL,
                especialidad VARCHAR(100),
                activo BOOLEAN DEFAULT TRUE,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                creado_por INT NOT NULL,
                INDEX idx_cedula (cedula),
                INDEX idx_activo (activo),
                FOREIGN KEY (creado_por) REFERENCES usuarios_sistema(id)
            )
        `);

        // Agregar columna usuario_id a tecnicos si no existe
        try {
            const [tecnicosColumns] = await conexion.execute(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = 'solucnet_auth_system'
                AND TABLE_NAME = 'tecnicos'
            `);

            const tecnicosColumnNames = tecnicosColumns.map(col => col.COLUMN_NAME);

            if (!tecnicosColumnNames.includes('usuario_id')) {
                await conexion.execute(`
                    ALTER TABLE tecnicos
                    ADD COLUMN usuario_id INT NULL AFTER id,
                    ADD FOREIGN KEY (usuario_id) REFERENCES usuarios_sistema(id)
                `);
                console.log('✅ Columna usuario_id agregada a tecnicos');
            }
        } catch (error) {
            console.log('⚠️ Error al verificar/agregar usuario_id a tecnicos:', error.message);
        }

        // Tabla de reportes de visitas
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS reportes_visitas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                visita_id INT NOT NULL,
                tecnico_id INT NULL,
                notas TEXT,
                problemas_encontrados TEXT,
                solucion_aplicada TEXT,
                materiales_utilizados TEXT,
                tiempo_trabajo TIME,
                cliente_satisfecho ENUM('si', 'no', 'parcial'),
                requiere_seguimiento BOOLEAN DEFAULT FALSE,
                fecha_reporte TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_visita (visita_id),
                INDEX idx_tecnico (tecnico_id),
                INDEX idx_fecha (fecha_reporte),
                FOREIGN KEY (visita_id) REFERENCES visitas_tecnicas(id) ON DELETE CASCADE
            )
        `);

        // Tabla de fotos de reportes
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS fotos_reportes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                reporte_id INT NOT NULL,
                nombre_archivo VARCHAR(255) NOT NULL,
                ruta_archivo VARCHAR(500) NOT NULL,
                descripcion TEXT,
                fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_reporte (reporte_id),
                FOREIGN KEY (reporte_id) REFERENCES reportes_visitas(id) ON DELETE CASCADE
            )
        `);

        // Tabla de archivos PDF de visitas técnicas
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS archivos_pdf_visitas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                visita_id INT NOT NULL,
                nombre_original VARCHAR(255) NOT NULL,
                nombre_archivo VARCHAR(255) NOT NULL,
                ruta_archivo VARCHAR(500) NOT NULL,
                tamaño INT NOT NULL,
                fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_visita (visita_id),
                FOREIGN KEY (visita_id) REFERENCES visitas_tecnicas(id) ON DELETE CASCADE
            )
        `);

        // Tabla de clientes nuevos (para instalaciones)
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS clientes_nuevos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                cedula VARCHAR(20) NOT NULL UNIQUE,
                telefono VARCHAR(20) NOT NULL,
                movil VARCHAR(100),
                direccion TEXT NOT NULL,
                email VARCHAR(100),
                coordenadas TEXT,
                estado ENUM('Activo', 'Inactivo') DEFAULT 'Activo',
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_cedula (cedula),
                INDEX idx_nombre (nombre),
                INDEX idx_estado (estado)
            )
        `);

        // Actualizar tamaño de columna movil en clientes_nuevos si es necesario
        try {
            const [movilColumnInfo] = await conexion.execute(`
                SELECT CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'clientes_nuevos'
                AND COLUMN_NAME = 'movil'
                AND TABLE_SCHEMA = DATABASE()
            `);

            if (movilColumnInfo.length > 0 && movilColumnInfo[0].CHARACTER_MAXIMUM_LENGTH < 100) {
                await conexion.execute(`ALTER TABLE clientes_nuevos MODIFY movil VARCHAR(100)`);
                console.log('✅ Columna movil en clientes_nuevos actualizada a VARCHAR(100)');
            }
        } catch (error) {
            console.log('⚠️ No se pudo verificar/actualizar tamaño de movil en clientes_nuevos:', error.message);
        }

        console.log('✅ Tablas de técnicos inicializadas (se gestionan desde usuarios_sistema)');

        // Tabla de ubicaciones de técnicos para rastreo GPS
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS ubicaciones_tecnicos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tecnico_id INT NOT NULL,
                latitud DECIMAL(10, 8) NOT NULL,
                longitud DECIMAL(11, 8) NOT NULL,
                precision_gps DECIMAL(10, 2),
                fecha_captura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_tecnico (tecnico_id),
                INDEX idx_fecha (fecha_captura),
                FOREIGN KEY (tecnico_id) REFERENCES usuarios_sistema(id)
            )
        `);
        console.log('✅ Tabla de ubicaciones_tecnicos inicializada');

        await conexion.end();
        console.log('✅ Sistema de visitas técnicas inicializado correctamente');
        return { success: true };
    } catch (error) {
        console.error('❌ Error inicializando sistema de visitas:', error.message);
        return { success: false, message: error.message };
    }
}

// Buscar clientes en las bases de datos por cédula o nombre
async function buscarClientesPorCedulaONombre(termino) {
    const resultados = [];
    console.log(`🔍 [BÚSQUEDA] *** ARCHIVO ACTUALIZADO CON CAMPO MOVIL *** Iniciando búsqueda con término: "${termino}"`);

    for (const bd of basesDatos) {
        try {
            console.log(`🔗 [BÚSQUEDA] Conectando a BD: ${bd.host}`);
            const conexion = await mysql.createConnection(bd);

            // FORZAR INCLUSIÓN DEL CAMPO MOVIL - Ya confirmamos que existe
            console.log(`🔍 [BÚSQUEDA] BD ${bd.host} - Forzando inclusión del campo movil`);

            // Buscar por cédula o nombre usando tblservicios para información real
            const consultaSQL = `
                SELECT
                    u.id,
                    u.nombre,
                    u.cedula,
                    u.telefono,
                    u.movil,
                    COALESCE(ts.direccion, u.direccion_principal) as direccion,
                    ts.coordenadas as coordenadas,
                    COALESCE(ts.pppuser, u.codigo) as usuario_ppp,
                    u.estado,
                    ts.nodo,
                    srv.nodo as mikrotik_nombre
                FROM usuarios u
                LEFT JOIN tblservicios ts ON u.id = ts.idcliente
                LEFT JOIN server srv ON ts.nodo = srv.id
                WHERE (u.cedula LIKE ? OR u.nombre LIKE ? OR ts.pppuser LIKE ?)
                AND u.estado != 'ELIMINADO'
                LIMIT 50
            `;

            console.log(`🔍 [BÚSQUEDA] BD ${bd.host} - Ejecutando consulta con movil incluido`);
            const [clientes] = await conexion.execute(consultaSQL, [`%${termino}%`, `%${termino}%`, `%${termino}%`]);
            console.log(`🔍 [BÚSQUEDA] BD ${bd.host} - ✅ Consulta exitosa con movil`);

            console.log(`✅ [BÚSQUEDA] BD ${bd.host}: encontrados ${clientes.length} clientes`);

            // Log de debug forzado para MARQUEZA
            if (clientes.length > 0 && clientes[0].nombre && clientes[0].nombre.includes('MARQUEZA')) {
                console.log(`🔍 [DEBUG MARQUEZA] Datos encontrados:`, JSON.stringify(clientes[0], null, 2));
            }

            // Agregar información de la BD origen
            clientes.forEach(cliente => {
                cliente.bd_origen = bd.host;
                cliente.bd_info = bd;

                // Si no hay mikrotik_nombre de la tabla server, usar mapeo por ubicación
                if (!cliente.mikrotik_nombre || cliente.mikrotik_nombre.trim() === '') {
                    cliente.mikrotik_nombre = obtenerMikrotikPorDireccion(cliente.direccion);
                }

                // Debug: mostrar datos del cliente
                console.log(`🔍 [BÚSQUEDA] Cliente: ${cliente.nombre} - Tel: "${cliente.telefono}" - Móvil: "${cliente.movil}" - Estado: ${cliente.estado}`);

                // Limpiar campo temporal nodo
                delete cliente.nodo;

                resultados.push(cliente);
            });

            await conexion.end();
        } catch (error) {
            console.error(`❌ [BÚSQUEDA] Error en BD ${bd.host}:`, error.message);
        }
    }

    console.log(`📊 [BÚSQUEDA] Total encontrados: ${resultados.length} clientes`);
    return resultados;
}

// Crear nueva visita técnica
async function crearVisitaTecnica(datosVisita, usuarioCreador) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Obtener información de equipos del cliente si no está incluida
        let serialEquipo = datosVisita.serial_equipo_asignado;
        let equipoTipo = datosVisita.equipo_tipo;
        let equipoEstado = datosVisita.equipo_estado;

        if (!serialEquipo && datosVisita.cliente_cedula) {
            try {
                const equipoInfo = await obtenerSerialEquipoCliente(datosVisita.cliente_cedula);
                if (equipoInfo && equipoInfo.serial_equipo_asignado) {
                    serialEquipo = equipoInfo.serial_equipo_asignado;
                    equipoTipo = equipoInfo.equipo_tipo;
                    equipoEstado = equipoInfo.equipo_estado;
                    console.log(`📦 Equipo encontrado para cliente ${datosVisita.cliente_nombre}: ${serialEquipo}`);
                }
            } catch (error) {
                console.log(`⚠️ No se pudo obtener información de equipo para cliente ${datosVisita.cliente_cedula}`);
            }
        }

        // Función auxiliar para convertir undefined a null
        const toNull = (value) => value === undefined ? null : value;

        console.log('📍 [DB] Localidad a insertar:', datosVisita.localidad);

        const [resultado] = await conexion.execute(`
            INSERT INTO visitas_tecnicas (
                cliente_id, cliente_nombre, cliente_cedula, cliente_telefono,
                cliente_movil, cliente_direccion, cliente_coordenadas, mikrotik_nombre, usuario_ppp,
                motivo_visita, fecha_programada,
                creado_por, notas_admin, bd_origen,
                serial_equipo_asignado, equipo_tipo, equipo_estado, localidad, observacion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            toNull(datosVisita.cliente_id),
            toNull(datosVisita.cliente_nombre),
            toNull(datosVisita.cliente_cedula),
            toNull(datosVisita.cliente_telefono),
            toNull(datosVisita.cliente_movil),
            toNull(datosVisita.cliente_direccion),
            toNull(datosVisita.cliente_coordenadas),
            toNull(datosVisita.mikrotik_nombre),
            toNull(datosVisita.usuario_ppp),
            toNull(datosVisita.motivo_visita),
            toNull(datosVisita.fecha_programada),
            toNull(usuarioCreador),
            toNull(datosVisita.notas_admin),
            toNull(datosVisita.bd_origen),
            toNull(serialEquipo),
            toNull(equipoTipo),
            toNull(equipoEstado),
            toNull(datosVisita.localidad),
            toNull(datosVisita.observacion)
        ]);

        const visitaId = resultado.insertId;

        // Guardar archivos PDF si existen
        if (datosVisita.archivos_pdf && datosVisita.archivos_pdf.length > 0) {
            for (const archivo of datosVisita.archivos_pdf) {
                await conexion.execute(`
                    INSERT INTO archivos_pdf_visitas (
                        visita_id, nombre_original, nombre_archivo, ruta_archivo, tamaño
                    ) VALUES (?, ?, ?, ?, ?)
                `, [
                    visitaId,
                    archivo.nombre_original,
                    archivo.nombre_archivo,
                    archivo.ruta,
                    archivo.tamaño
                ]);
            }
            console.log(`📎 ${datosVisita.archivos_pdf.length} archivos PDF guardados para la visita ${visitaId}`);
        }

        await conexion.end();
        console.log('✅ Visita técnica creada con ID:', visitaId);
        return { success: true, visitaId: visitaId };
    } catch (error) {
        console.error('❌ Error creando visita técnica:', error.message);
        return { success: false, message: error.message };
    }
}

// Obtener visitas técnicas pendientes
async function obtenerVisitasPendientes() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [visitas] = await conexion.execute(`
            SELECT
                vt.*,
                t.nombre as tecnico_nombre,
                us.nombre as creador_nombre
            FROM visitas_tecnicas vt
            LEFT JOIN tecnicos t ON vt.tecnico_asignado_id = t.id
            LEFT JOIN usuarios_sistema us ON vt.creado_por = us.id
            WHERE vt.estado IN ('programada', 'asignada', 'en_progreso')
            ORDER BY vt.fecha_programada ASC
        `);

        await conexion.end();
        return { success: true, visitas };
    } catch (error) {
        console.error('❌ Error obteniendo visitas pendientes:', error.message);
        return { success: false, message: error.message };
    }
}

// Asignar técnico a visita
async function asignarTecnicoAVisita(visitaId, tecnicoId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Obtener datos del técnico desde la tabla usuarios_sistema
        const [tecnicoUsuario] = await conexion.execute(
            'SELECT id, nombre, username, rol FROM usuarios_sistema WHERE id = ? AND rol = "tecnico" AND activo = TRUE',
            [tecnicoId]
        );

        if (tecnicoUsuario.length === 0) {
            // Si no se encuentra en usuarios_sistema, intentar con tabla tecnicos antigua
            const [tecnicoLegacy] = await conexion.execute(
                'SELECT id, nombre FROM tecnicos WHERE id = ? AND activo = TRUE',
                [tecnicoId]
            );

            if (tecnicoLegacy.length === 0) {
                await conexion.end();
                return { success: false, message: 'Técnico no encontrado o inactivo' };
            }

            // Asignar técnico legacy
            await conexion.execute(`
                UPDATE visitas_tecnicas
                SET tecnico_asignado_id = ?, tecnico_asignado_nombre = ?, estado = 'asignada'
                WHERE id = ?
            `, [tecnicoId, tecnicoLegacy[0].nombre, visitaId]);

            await conexion.end();
            console.log(`✅ Técnico legacy ${tecnicoLegacy[0].nombre} asignado a visita ${visitaId}`);
            return { success: true, message: 'Técnico asignado exitosamente' };
        }

        // Asignar técnico de usuarios_sistema
        await conexion.execute(`
            UPDATE visitas_tecnicas
            SET tecnico_asignado_id = ?, tecnico_asignado_nombre = ?, estado = 'asignada'
            WHERE id = ?
        `, [tecnicoId, tecnicoUsuario[0].nombre, visitaId]);

        await conexion.end();
        console.log(`✅ Técnico ${tecnicoUsuario[0].nombre} asignado a visita ${visitaId}`);
        return { success: true, message: 'Técnico asignado exitosamente' };
    } catch (error) {
        console.error('❌ Error asignando técnico:', error.message);
        return { success: false, message: error.message };
    }
}

// Función auxiliar para obtener seriales de equipos de un cliente específico
async function obtenerSerialEquipoCliente(cedula) {
    for (const bd of basesDatos) {
        try {
            const conexionSerial = await mysql.createConnection(bd);

            try {
                // Primero obtener información básica del usuario
                const [usuarios] = await conexionSerial.execute(`
                    SELECT u.id,
                           COALESCE(ts.pppuser, u.codigo) as usuario_ppp,
                           srv.nodo as mikrotik_nombre
                    FROM usuarios u
                    LEFT JOIN tblservicios ts ON u.id = ts.idcliente
                    LEFT JOIN server srv ON ts.nodo = srv.id
                    WHERE u.cedula = ?
                    LIMIT 1
                `, [cedula]);

                if (usuarios.length === 0) {
                    await conexionSerial.end();
                    continue;
                }

                const usuario = usuarios[0];

                // Obtener TODOS los equipos del cliente
                const consultaEquipos = `
                    SELECT DISTINCT
                        COALESCE(mat.serial, alm.serial_producto) as serial,
                        COALESCE(mat.detalle, p.producto, 'Equipo') as tipo,
                        alm.estado
                    FROM almacen alm
                    LEFT JOIN materiales mat ON alm.id = mat.idalmacen
                    LEFT JOIN productos p ON alm.productoid = p.id
                    WHERE alm.userid = ?
                    AND alm.estado IN ('comodato', 'vendido', 'prestado')
                    AND (mat.serial IS NOT NULL OR alm.serial_producto IS NOT NULL)
                    ORDER BY alm.id
                `;

                const [clientes] = await conexionSerial.execute(consultaEquipos, [usuario.id]);

                if (clientes.length > 0) {
                    const equiposMap = new Map();

                    // Procesar todos los equipos encontrados y deduplicar
                    clientes.forEach(item => {
                        const serial = item.serial;
                        if (serial) {
                            const key = `${item.tipo || 'Equipo'}-${serial}`;
                            if (!equiposMap.has(key)) {
                                equiposMap.set(key, {
                                    serial: serial,
                                    tipo: item.tipo || 'Equipo',
                                    estado: item.estado || 'comodato'
                                });
                            }
                        }
                    });

                    const equipos = Array.from(equiposMap.values());

                    if (equipos.length > 0) {
                        await conexionSerial.end();

                        // Devolver el primer equipo como principal + todos los equipos deduplicados
                        return {
                            serial_equipo_asignado: equipos[0].serial,
                            equipo_tipo: equipos[0].tipo,
                            equipo_estado: equipos[0].estado,
                            mikrotik_nombre: usuario.mikrotik_nombre,
                            usuario_ppp: usuario.usuario_ppp,
                            todos_los_equipos: equipos // Array con todos los equipos deduplicados
                        };
                    }
                }

                await conexionSerial.end();
            } catch (err) {
                await conexionSerial.end();
                console.log(`⚠️ Error en BD ${bd.host}: ${err.message}`);
                continue;
            }
        } catch (err) {
            console.log(`⚠️ Error conectando a BD ${bd.host}: ${err.message}`);
            continue;
        }
    }

    return null;
}

// Obtener visitas asignadas a un técnico
async function obtenerVisitasTecnico(tecnicoId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [visitas] = await conexion.execute(`
            SELECT *
            FROM visitas_tecnicas
            WHERE tecnico_asignado_id = ? AND estado IN ('asignada', 'en_progreso')
            ORDER BY fecha_programada ASC
        `, [tecnicoId]);

        // Para cada visita, SIEMPRE obtener información actualizada de equipos
        for (const visita of visitas) {
            if (visita.cliente_cedula) {
                try {
                    const serialInfo = await obtenerSerialEquipoCliente(visita.cliente_cedula);
                    if (serialInfo) {
                        // Actualizar con información más reciente
                        visita.serial_equipo_asignado = serialInfo.serial_equipo_asignado;
                        visita.equipo_tipo = serialInfo.equipo_tipo;
                        visita.equipo_estado = serialInfo.equipo_estado;
                        visita.todos_los_equipos = serialInfo.todos_los_equipos; // Array completo de equipos

                        // Solo sobrescribir mikrotik y usuario_ppp si no están ya guardados
                        if (!visita.mikrotik_nombre) visita.mikrotik_nombre = serialInfo.mikrotik_nombre;
                        if (!visita.usuario_ppp) visita.usuario_ppp = serialInfo.usuario_ppp;
                    }
                } catch (err) {
                    console.log(`⚠️ No se pudieron obtener seriales para cliente ${visita.cliente_cedula}: ${err.message}`);
                }
            }
        }

        await conexion.end();
        return { success: true, visitas };
    } catch (error) {
        console.error('❌ Error obteniendo visitas del técnico:', error.message);
        return { success: false, message: error.message };
    }
}

// Crear reporte de visita
async function crearReporteVisita(datosReporte) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Crear reporte
        const [resultado] = await conexion.execute(`
            INSERT INTO reportes_visitas (
                visita_id, tecnico_id, notas, problemas_encontrados,
                solucion_aplicada, materiales_utilizados, tiempo_trabajo,
                cliente_satisfecho, requiere_seguimiento, latitud, longitud, precision_gps
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            datosReporte.visita_id,
            datosReporte.tecnico_id,
            datosReporte.notas || null,
            datosReporte.problemas_encontrados || null,
            datosReporte.solucion_aplicada || null,
            datosReporte.materiales_utilizados || null,
            datosReporte.tiempo_trabajo || null,
            datosReporte.cliente_satisfecho || null,
            datosReporte.requiere_seguimiento || null,
            datosReporte.latitud || null,
            datosReporte.longitud || null,
            datosReporte.precision_gps || null
        ]);

        // Actualizar estado de la visita a completada
        await conexion.execute(`
            UPDATE visitas_tecnicas
            SET estado = 'completada', fecha_completada = NOW()
            WHERE id = ?
        `, [datosReporte.visita_id]);

        // Si hay coordenadas, actualizar en la base de datos externa del cliente
        if (datosReporte.latitud && datosReporte.longitud) {
            // Obtener la cédula del cliente de la visita
            const [visitaInfo] = await conexion.execute(`
                SELECT cliente_cedula
                FROM visitas_tecnicas
                WHERE id = ?
            `, [datosReporte.visita_id]);

            if (visitaInfo.length > 0 && visitaInfo[0].cliente_cedula) {
                const cedula = visitaInfo[0].cliente_cedula;
                console.log(`📍 Actualizando coordenadas para cliente ${cedula}...`);

                // Actualizar coordenadas en la base de datos externa
                const resultadoCoords = await actualizarCoordenadasCliente(
                    cedula,
                    datosReporte.latitud,
                    datosReporte.longitud
                );

                if (resultadoCoords.success) {
                    console.log(`✅ Coordenadas actualizadas en BD externa: ${resultadoCoords.mensaje}`);
                } else {
                    console.log(`⚠️ No se pudieron actualizar coordenadas en BD externa: ${resultadoCoords.mensaje}`);
                }
            }
        }

        await conexion.end();
        console.log('✅ Reporte de visita creado con ID:', resultado.insertId);
        return { success: true, reporteId: resultado.insertId };
    } catch (error) {
        console.error('❌ Error creando reporte:', error.message);
        return { success: false, message: error.message };
    }
}

// Obtener todos los técnicos
async function obtenerTecnicos() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Obtener SOLO usuarios con rol 'tecnico' de usuarios_sistema (tabla de gestión de usuarios)
        const [tecnicos] = await conexion.execute(`
            SELECT
                id,
                nombre,
                username as cedula,
                '' as telefono,
                'Técnico' as especialidad,
                activo
            FROM usuarios_sistema
            WHERE rol = 'tecnico' AND activo = TRUE
            ORDER BY nombre ASC
        `);

        await conexion.end();

        console.log(`✅ Técnicos obtenidos: ${tecnicos.length} de usuarios_sistema`);

        return { success: true, tecnicos };
    } catch (error) {
        console.error('❌ Error obteniendo técnicos:', error.message);
        return { success: false, message: error.message };
    }
}

// Obtener fotos de un reporte específico
async function obtenerFotosReporte(reporteId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [fotos] = await conexion.execute(`
            SELECT id, nombre_archivo, ruta_archivo, descripcion, fecha_subida
            FROM fotos_reportes
            WHERE reporte_id = ?
            ORDER BY fecha_subida ASC
        `, [reporteId]);

        await conexion.end();
        return { success: true, fotos };
    } catch (error) {
        console.error('❌ Error obteniendo fotos del reporte:', error.message);
        return { success: false, message: error.message };
    }
}

// Guardar fotos de un reporte en la base de datos
async function guardarFotosReporte(reporteId, fotosInfo) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Preparar la consulta para insertar múltiples fotos
        const valores = fotosInfo.map(foto => [
            reporteId,
            foto.nombre_archivo,
            foto.ruta_archivo,
            foto.descripcion || null
        ]);

        const [resultado] = await conexion.execute(`
            INSERT INTO fotos_reportes (reporte_id, nombre_archivo, ruta_archivo, descripcion, fecha_subida)
            VALUES ${valores.map(() => '(?, ?, ?, ?, NOW())').join(', ')}
        `, valores.flat());

        await conexion.end();

        console.log(`📸 ${fotosInfo.length} fotos guardadas en BD para reporte ${reporteId}`);

        return {
            success: true,
            message: `${fotosInfo.length} fotos guardadas exitosamente`,
            insertedRows: resultado.affectedRows
        };
    } catch (error) {
        console.error('❌ Error guardando fotos en BD:', error.message);
        return { success: false, message: error.message };
    }
}

// Obtener reportes completados
async function obtenerReportesCompletados() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Consulta con JOIN a usuarios_sistema para obtener nombre del técnico
        const [reportes] = await conexion.execute(`
            SELECT
                rv.id,
                rv.visita_id,
                rv.tecnico_id,
                rv.notas,
                rv.problemas_encontrados,
                rv.solucion_aplicada,
                rv.materiales_utilizados,
                rv.tiempo_trabajo,
                rv.cliente_satisfecho,
                rv.requiere_seguimiento,
                rv.fecha_reporte,
                rv.latitud,
                rv.longitud,
                rv.precision_gps,
                vt.cliente_nombre,
                vt.cliente_cedula,
                vt.cliente_telefono,
                vt.cliente_movil,
                vt.motivo_visita,
                vt.fecha_programada,
                vt.estado,
                vt.serial_equipo_asignado,
                CASE
                    WHEN rv.tecnico_id IS NULL THEN 'Ninguno'
                    ELSE COALESCE(us.nombre, t.nombre, 'Técnico')
                END as tecnico_nombre,
                COALESCE(rv.solucion_aplicada, rv.notas, rv.problemas_encontrados) as trabajo_realizado
            FROM reportes_visitas rv
            JOIN visitas_tecnicas vt ON rv.visita_id = vt.id
            LEFT JOIN usuarios_sistema us ON rv.tecnico_id = us.id AND us.rol = 'tecnico'
            LEFT JOIN tecnicos t ON rv.tecnico_id = t.id
            WHERE vt.estado = 'completada'
            ORDER BY rv.fecha_reporte DESC
            LIMIT 50
        `);

        await conexion.end();
        return { success: true, reportes };
    } catch (error) {
        console.error('❌ Error obteniendo reportes:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para mapear Mikrotiks por dirección/barrio
function obtenerMikrotikPorDireccion(direccion) {
    if (!direccion) return 'Mikrotik-Desconocido';

    const direccionLower = direccion.toLowerCase();

    // Mapeo basado en direcciones/barrios reales
    if (direccionLower.includes('esmeralda') || direccionLower.includes('reposo')) {
        return 'Mikrotik_Reposo';
    } else if (direccionLower.includes('salvador')) {
        return 'Mikrotik_Salvador';
    } else if (direccionLower.includes('carepa')) {
        return 'Mikrotik_carepa';
    } else if (direccionLower.includes('nueva') && direccionLower.includes('colonia')) {
        return 'NUEVA_COLONIA';
    } else if (direccionLower.includes('uniban') || direccionLower.includes('central')) {
        return 'Uniban Central';
    } else if (direccionLower.includes('zungo')) {
        return 'Uniban Zungo';
    } else if (direccionLower.includes('centro') || direccionLower.includes('bosque') || direccionLower.includes('almendros')) {
        return 'Mikrotik_Reposo';  // Por defecto para zonas centrales
    } else {
        return 'Mikrotik_Reposo';  // Por defecto
    }
}

// Función para eliminar una visita técnica
async function eliminarVisitaTecnica(visitaId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Eliminar la visita de la base de datos
        const [resultado] = await conexion.execute(
            'DELETE FROM visitas_tecnicas WHERE id = ?',
            [visitaId]
        );

        await conexion.end();

        return {
            success: true,
            message: 'Visita técnica eliminada exitosamente',
            affected: resultado.affectedRows
        };

    } catch (error) {
        console.error('Error al eliminar visita técnica:', error);
        throw error;
    }
}

// Función para crear cliente nuevo y visita técnica
async function crearClienteYVisita(datosCliente, datosVisita, usuarioCreador) {
    let conexion;
    try {
        conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Iniciar transacción
        await conexion.beginTransaction();

        // Primero, crear el cliente nuevo
        const [resultadoCliente] = await conexion.execute(`
            INSERT INTO clientes_nuevos (
                nombre, cedula, telefono, movil, direccion, email, coordenadas, estado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            datosCliente.nombre,
            datosCliente.cedula,
            datosCliente.telefono,
            datosCliente.movil || '',
            datosCliente.direccion,
            datosCliente.email || '',
            datosCliente.coordenadas || '',
            datosCliente.estado || 'Activo'
        ]);

        const clienteId = resultadoCliente.insertId;

        // Luego, crear la visita técnica
        const [resultadoVisita] = await conexion.execute(`
            INSERT INTO visitas_tecnicas (
                cliente_id, cliente_nombre, cliente_cedula, cliente_telefono,
                cliente_movil, cliente_direccion, cliente_coordenadas,
                motivo_visita, fecha_programada,
                creado_por, notas_admin, bd_origen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            clienteId,
            datosVisita.cliente_nombre,
            datosVisita.cliente_cedula,
            datosVisita.cliente_telefono,
            datosVisita.cliente_movil || '',
            datosVisita.cliente_direccion,
            datosVisita.cliente_coordenadas || '',
            datosVisita.motivo_visita,
            datosVisita.fecha_programada,
            usuarioCreador,
            datosVisita.notas_admin || '',
            datosVisita.bd_origen
        ]);

        const visitaId = resultadoVisita.insertId;

        // Guardar archivos PDF si existen
        if (datosVisita.archivos_pdf && datosVisita.archivos_pdf.length > 0) {
            for (const archivo of datosVisita.archivos_pdf) {
                await conexion.execute(`
                    INSERT INTO archivos_pdf_visitas (
                        visita_id, nombre_original, nombre_archivo, ruta_archivo, tamaño
                    ) VALUES (?, ?, ?, ?, ?)
                `, [
                    visitaId,
                    archivo.nombre_original,
                    archivo.nombre_archivo,
                    archivo.ruta,
                    archivo.tamaño
                ]);
            }
            console.log(`📎 ${datosVisita.archivos_pdf.length} archivos PDF guardados para la visita ${visitaId}`);
        }

        // Confirmar transacción
        await conexion.commit();
        await conexion.end();

        console.log(`✅ Cliente nuevo creado con ID: ${clienteId} y visita técnica con ID: ${visitaId}`);
        return {
            success: true,
            clienteId: clienteId,
            visitaId: visitaId,
            message: 'Cliente y visita creados exitosamente'
        };

    } catch (error) {
        // Rollback en caso de error
        if (conexion) {
            await conexion.rollback();
            await conexion.end();
        }
        console.error('❌ Error creando cliente y visita:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener archivos PDF de una visita
async function obtenerArchivosPdfVisita(visitaId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [archivos] = await conexion.execute(`
            SELECT id, nombre_original, nombre_archivo, ruta_archivo, tamaño, fecha_subida
            FROM archivos_pdf_visitas
            WHERE visita_id = ?
            ORDER BY fecha_subida DESC
        `, [visitaId]);

        await conexion.end();
        return { success: true, archivos: archivos };

    } catch (error) {
        console.error('❌ Error obteniendo archivos PDF:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener todas las órdenes de técnicos para admin
async function obtenerOrdenesParaAdmin() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Obtener visitas del día actual y pendientes de asignar técnico
        const fechaHoy = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD

        const query = `
            SELECT
                v.id,
                v.fecha_creacion,
                v.fecha_programada,
                v.estado,
                v.motivo_visita as descripcion,
                v.fecha_completada as fecha_completado,
                v.cliente_nombre,
                v.cliente_cedula,
                v.cliente_telefono as cliente_direccion,
                COALESCE(v.tecnico_asignado_nombre, 'Pendiente de asignar') as tecnico_nombre,
                COALESCE(v.tecnico_asignado_id, 0) as tecnico_id,
                'normal' as prioridad,
                DATE(v.fecha_creacion) as fecha_solo
            FROM visitas_tecnicas v
            WHERE v.estado != 'archivada'
            AND (
                DATE(v.fecha_creacion) = ? OR
                DATE(v.fecha_programada) = ? OR
                v.estado IN ('en_progreso', 'asignada', 'programada')
            )
            ORDER BY
                CASE v.estado
                    WHEN 'en_progreso' THEN 1
                    WHEN 'asignada' THEN 2
                    WHEN 'programada' THEN 3
                    WHEN 'completada' THEN 4
                    ELSE 5
                END,
                v.fecha_creacion DESC
        `;

        const [rows] = await conexion.execute(query, [fechaHoy, fechaHoy]);
        await conexion.end();

        console.log(`📋 [BD] Consultando visitas del día ${fechaHoy} y pendientes de asignar`);
        console.log(`📊 [BD] Total de registros encontrados: ${rows.length}`);

        // Log de técnicos únicos encontrados
        const tecnicosUnicos = [...new Set(rows.map(r => r.tecnico_id))].filter(id => id !== null && id !== 0);
        const sinAsignar = rows.filter(r => r.tecnico_id === 0 || r.tecnico_id === null).length;
        console.log(`👥 [BD] Técnicos asignados:`, tecnicosUnicos);
        console.log(`⚠️ [BD] Visitas sin técnico asignado: ${sinAsignar}`);

        rows.forEach((row, index) => {
            if (index < 3) { // Mostrar solo los primeros 3 para no saturar logs
                console.log(`📋 [BD] Registro ${index + 1}: ID=${row.id}, Cliente=${row.cliente_nombre}, Técnico=${row.tecnico_nombre} (ID:${row.tecnico_id}), Estado=${row.estado}`);
            }
        });

        // Enriquecer datos con información adicional
        const ordenesEnriquecidas = rows.map(orden => {
            const esSinAsignar = orden.tecnico_id === 0 || orden.tecnico_id === null;

            return {
                ...orden,
                cliente_telefono: orden.cliente_telefono || 'N/A',
                tecnico_telefono: esSinAsignar ? 'Pendiente' : 'N/A',
                tecnico_especialidad: esSinAsignar ? 'Sin asignar' : 'Técnico General',
                tecnico_ocupado: 0,
                tecnico_estado: esSinAsignar ? 'sin_asignar' : (orden.estado === 'en_progreso' ? 'ocupado' : 'disponible'),
                tecnico_ubicacion: esSinAsignar ? 'Pendiente de asignación' : (orden.estado === 'en_progreso' ? 'Trabajando en campo' : 'Disponible'),
                dias_desde_creacion: Math.floor((Date.now() - new Date(orden.fecha_creacion).getTime()) / (1000 * 60 * 60 * 24)),
                requiere_asignacion: esSinAsignar
            };
        });

        return {
            success: true,
            ordenes: ordenesEnriquecidas
        };

    } catch (error) {
        console.error('Error obteniendo órdenes para admin:', error);
        return {
            success: false,
            message: 'Error obteniendo órdenes: ' + error.message
        };
    }
}

// Función para obtener detalle de una orden específica
async function obtenerDetalleOrden(ordenId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const query = `
            SELECT
                v.*,
                v.cliente_nombre,
                v.cliente_cedula,
                v.cliente_telefono as cliente_direccion,
                v.motivo_visita as descripcion,
                v.tecnico_asignado_nombre as tecnico_nombre,
                v.tecnico_asignado_id as tecnico_id,
                r.comentarios as reporte_comentarios,
                r.trabajo_realizado,
                r.materiales_utilizados,
                r.recomendaciones
            FROM visitas_tecnicas v
            LEFT JOIN reportes_visitas r ON v.id = r.visita_id
            WHERE v.id = ?
        `;

        const [rows] = await conexion.execute(query, [ordenId]);
        await conexion.end();

        if (rows.length === 0) {
            return {
                success: false,
                message: 'Orden no encontrada'
            };
        }

        const orden = rows[0];

        // Enriquecer con datos adicionales
        const ordenDetallada = {
            ...orden,
            cliente_telefono: orden.cliente_telefono || 'N/A',
            tecnico_telefono: 'N/A', // No disponible en estructura actual
            tecnico_especialidad: 'Técnico General',
            tecnico_estado: 'disponible',
            tecnico_ubicacion: orden.cliente_direccion || 'N/A',
            prioridad: 'normal'
        };

        return {
            success: true,
            orden: ordenDetallada
        };

    } catch (error) {
        console.error('Error obteniendo detalle de orden:', error);
        return {
            success: false,
            message: 'Error obteniendo detalle: ' + error.message
        };
    }
}

// Función para obtener visitas no asignadas (estado 'programada')
async function obtenerVisitasNoAsignadas() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [visitas] = await conexion.execute(`
            SELECT
                vt.*,
                us.nombre as creador_nombre
            FROM visitas_tecnicas vt
            LEFT JOIN usuarios_sistema us ON vt.creado_por = us.id
            WHERE vt.estado = 'programada'
            AND vt.tecnico_asignado_id IS NULL
            ORDER BY vt.fecha_programada ASC, vt.fecha_creacion ASC
        `);

        await conexion.end();
        return { success: true, visitas };
    } catch (error) {
        console.error('❌ Error obteniendo visitas no asignadas:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener visitas asignadas
async function obtenerVisitasAsignadas() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [visitas] = await conexion.execute(`
            SELECT
                vt.*,
                us.nombre as creador_nombre,
                t.nombre as tecnico_nombre,
                t.telefono as tecnico_telefono
            FROM visitas_tecnicas vt
            LEFT JOIN usuarios_sistema us ON vt.creado_por = us.id
            LEFT JOIN tecnicos t ON vt.tecnico_asignado_id = t.id
            WHERE vt.estado = 'asignada'
            AND vt.tecnico_asignado_id IS NOT NULL
            ORDER BY vt.fecha_programada ASC, vt.fecha_creacion ASC
        `);

        await conexion.end();
        return { success: true, visitas };
    } catch (error) {
        console.error('❌ Error obteniendo visitas asignadas:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener visitas en progreso
async function obtenerVisitasEnProgreso() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [visitas] = await conexion.execute(`
            SELECT
                vt.*,
                us.nombre as creador_nombre,
                t.nombre as tecnico_nombre,
                t.telefono as tecnico_telefono
            FROM visitas_tecnicas vt
            LEFT JOIN usuarios_sistema us ON vt.creado_por = us.id
            LEFT JOIN tecnicos t ON vt.tecnico_asignado_id = t.id
            WHERE vt.estado = 'en_progreso'
            AND vt.tecnico_asignado_id IS NOT NULL
            ORDER BY vt.fecha_programada ASC, vt.fecha_creacion ASC
        `);

        await conexion.end();
        return { success: true, visitas };
    } catch (error) {
        console.error('❌ Error obteniendo visitas en progreso:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener estadísticas de visitas
async function obtenerEstadisticasVisitas() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [estadisticas] = await conexion.execute(`
            SELECT
                estado,
                COUNT(*) as cantidad
            FROM visitas_tecnicas
            WHERE estado IN ('programada', 'asignada', 'en_progreso', 'completada', 'cancelada')
            GROUP BY estado
        `);

        await conexion.end();

        // Convertir array a objeto para fácil acceso
        const stats = {
            programada: 0,
            asignada: 0,
            en_progreso: 0,
            completada: 0,
            cancelada: 0
        };

        estadisticas.forEach(stat => {
            stats[stat.estado] = stat.cantidad;
        });

        return { success: true, estadisticas: stats };
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas de visitas:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para desasignar técnico de una visita
async function desasignarTecnicoDeVisita(visitaId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar que la visita existe y está asignada
        const [visitaExistente] = await conexion.execute(
            'SELECT id, estado, tecnico_asignado_id, tecnico_asignado_nombre, cliente_nombre FROM visitas_tecnicas WHERE id = ?',
            [visitaId]
        );

        if (visitaExistente.length === 0) {
            await conexion.end();
            return { success: false, message: 'La visita no existe' };
        }

        const visita = visitaExistente[0];

        if (visita.estado !== 'asignada') {
            await conexion.end();
            return { success: false, message: 'Solo se pueden desasignar visitas en estado "asignada"' };
        }

        if (!visita.tecnico_asignado_id) {
            await conexion.end();
            return { success: false, message: 'La visita no tiene técnico asignado' };
        }

        // Desasignar técnico - regresar al estado programada
        await conexion.execute(
            `UPDATE visitas_tecnicas
             SET estado = 'programada',
                 tecnico_asignado_id = NULL,
                 tecnico_asignado_nombre = NULL,
                 fecha_modificacion = NOW()
             WHERE id = ?`,
            [visitaId]
        );

        await conexion.end();

        console.log(`✅ Técnico desasignado de visita ${visitaId} (${visita.cliente_nombre})`);
        return {
            success: true,
            message: `Técnico "${visita.tecnico_asignado_nombre}" desasignado exitosamente de la visita de ${visita.cliente_nombre}`,
            visita_id: visitaId
        };

    } catch (error) {
        console.error('❌ Error desasignando técnico de visita:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para editar una visita sin agendar
async function editarVisitaSinAgendar(visitaId, localidad, fechaVisita, motivoVisita, observacion) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar que la visita existe y está en estado 'programada'
        const [visitaExistente] = await conexion.execute(
            'SELECT id, estado, tecnico_asignado_id FROM visitas_tecnicas WHERE id = ?',
            [visitaId]
        );

        if (visitaExistente.length === 0) {
            await conexion.end();
            return { success: false, message: 'La visita no existe' };
        }

        if (visitaExistente[0].estado !== 'programada') {
            await conexion.end();
            return { success: false, message: 'Solo se pueden editar visitas en estado programada' };
        }

        if (visitaExistente[0].tecnico_asignado_id !== null) {
            await conexion.end();
            return { success: false, message: 'No se puede editar una visita que ya tiene técnico asignado' };
        }

        // Actualizar la visita
        const [resultado] = await conexion.execute(`
            UPDATE visitas_tecnicas
            SET localidad = ?,
                fecha_programada = ?,
                motivo_visita = ?,
                observacion = ?,
                fecha_modificacion = NOW()
            WHERE id = ?
        `, [localidad, fechaVisita, motivoVisita, observacion || null, visitaId]);

        await conexion.end();

        if (resultado.affectedRows > 0) {
            return {
                success: true,
                message: 'Visita actualizada exitosamente',
                visitaId: visitaId
            };
        } else {
            return { success: false, message: 'No se pudo actualizar la visita' };
        }

    } catch (error) {
        console.error('❌ Error editando visita sin agendar:', error.message);
        return { success: false, message: 'Error interno: ' + error.message };
    }
}

// Función para guardar ubicación de técnico
async function guardarUbicacionTecnico(tecnicoId, latitud, longitud, precisionGps) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(`
            INSERT INTO ubicaciones_tecnicos (tecnico_id, latitud, longitud, precision_gps)
            VALUES (?, ?, ?, ?)
        `, [tecnicoId, latitud, longitud, precisionGps || null]);

        await conexion.end();
        return { success: true, message: 'Ubicación guardada exitosamente' };
    } catch (error) {
        console.error('❌ Error guardando ubicación del técnico:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener últimas ubicaciones de todos los técnicos
async function obtenerUltimasUbicacionesTecnicos() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Obtener la última ubicación de cada técnico
        const [ubicaciones] = await conexion.execute(`
            SELECT
                ut.tecnico_id,
                ut.latitud,
                ut.longitud,
                ut.precision_gps,
                ut.fecha_captura,
                us.nombre as tecnico_nombre,
                us.username as tecnico_telefono,
                (SELECT COUNT(*) FROM visitas_tecnicas vt
                 WHERE vt.tecnico_asignado_id = ut.tecnico_id
                 AND vt.estado = 'en_progreso') as visitas_activas
            FROM ubicaciones_tecnicos ut
            INNER JOIN usuarios_sistema us ON ut.tecnico_id = us.id
            WHERE us.rol = 'tecnico' AND us.activo = TRUE
            AND ut.id IN (
                SELECT MAX(id)
                FROM ubicaciones_tecnicos
                GROUP BY tecnico_id
            )
            ORDER BY ut.fecha_captura DESC
        `);

        await conexion.end();
        return { success: true, ubicaciones };
    } catch (error) {
        console.error('❌ Error obteniendo ubicaciones de técnicos:', error.message);
        return { success: false, message: error.message };
    }
}

// Función para obtener historial de ubicaciones de un técnico específico
async function obtenerHistorialUbicacionesTecnico(tecnicoId, limite = 50) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [ubicaciones] = await conexion.execute(`
            SELECT
                latitud,
                longitud,
                precision_gps,
                fecha_captura
            FROM ubicaciones_tecnicos
            WHERE tecnico_id = ?
            ORDER BY fecha_captura DESC
            LIMIT ?
        `, [tecnicoId, limite]);

        await conexion.end();
        return { success: true, ubicaciones };
    } catch (error) {
        console.error('❌ Error obteniendo historial de ubicaciones:', error.message);
        return { success: false, message: error.message };
    }
}

module.exports = {
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
    obtenerSerialEquipoCliente,
    guardarUbicacionTecnico,
    obtenerUltimasUbicacionesTecnicos,
    obtenerHistorialUbicacionesTecnico
};