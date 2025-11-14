const mysql = require('mysql2/promise');

// Pool de conexiones para optimizar el uso de CPU y memoria
const connectionPools = {};

// Configuración de tus bases de datos
const basesDatos = [
    { host: '192.168.99.50', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6' },
    { host: '192.168.99.11', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6' },
    { host: '192.168.99.2', user: 'root', password: 'Y9T1Q6P39YI6TJ2', database: 'Mikrowisp6' },
    
];

// Crear pools de conexiones optimizados
function createConnectionPool(config) {
    const poolKey = `${config.host}_${config.database}`;
    if (!connectionPools[poolKey]) {
        connectionPools[poolKey] = mysql.createPool({
            ...config,
            waitForConnections: true,
            connectionLimit: 3, // Límite reducido para ahorrar recursos
            queueLimit: 0,
            acquireTimeout: 10000,
            timeout: 10000,
            reconnect: true,
            idleTimeout: 300000, // 5 minutos de timeout
            maxIdle: 2 // Conexiones idle máximas
        });
    }
    return connectionPools[poolKey];
}

// Configuración para base de datos del sistema de autenticación
// Base de datos separada para usuarios y configuración del sistema
const dbSistema = {
    host: process.env.DB_SYSTEM_HOST || 'localhost',
    user: process.env.DB_SYSTEM_USER || 'root',
    password: process.env.DB_SYSTEM_PASSWORD || '',
    database: 'solucnet_auth_system'
};

// Cache para consultas frecuentes
const consultaCache = new Map();
const CACHE_TTL = 300000; // 5 minutos

async function consultarCliente(cedula) {
    // Limpiar y normalizar cédula (remover puntos, guiones, espacios)
    const cedulaLimpia = cedula.toString().replace(/[.\-\s]/g, '').trim();
    console.log(`🔍 [DB] Buscando cliente - Cédula original: "${cedula}", Cédula limpia: "${cedulaLimpia}"`);

    // Verificar cache primero
    const cacheKey = `cliente_${cedulaLimpia}`;
    const cached = consultaCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`📦 [DB] Cliente encontrado en caché: ${cached.data.cliente.nombre}`);
        return cached.data;
    }

    for (const bd of basesDatos) {
        try {
            const pool = createConnectionPool(bd);
            const conexion = await pool.getConnection();
            
            try {
                console.log(`🔍 [DB] Buscando cliente con cédula: ${cedulaLimpia} en BD: ${bd.database}`);

                const [clientes] = await conexion.execute(
                    'SELECT id, nombre AS nombre, estado, cedula, telefono, movil, direccion_principal FROM usuarios WHERE cedula = ? LIMIT 1',
                    [cedulaLimpia]
                );

                if (clientes.length === 0) {
                    console.log(`⚠️ [DB] Cliente no encontrado en BD: ${bd.database}`);
                    continue;
                }

                const cliente = clientes[0];
                console.log(`✅ [DB] Cliente encontrado: ${cliente.nombre} (ID: ${cliente.id}) en BD: ${bd.database}`);

                // Usar transacción para consultas relacionadas
                const [facturas, cuentas] = await Promise.all([
                    conexion.execute(
                        `SELECT
                            DATE_FORMAT(vencimiento, '%d/%m/%Y') AS vencimiento,
                            total,
                            estado,
                            CASE
                                WHEN vencimiento < CURDATE() THEN 'Vencida'
                                ELSE 'No pagado'
                            END AS situacion
                         FROM facturas
                         WHERE idcliente = ? AND TRIM(estado) IN ('No pagado', 'vencida')
                         ORDER BY vencimiento ASC
                         LIMIT 10`,
                        [cliente.id]
                    ),
                    conexion.execute('SELECT cuenta FROM numero_de_cuenta LIMIT 1')
                ]);

                // Permitir que el cliente sea encontrado incluso si no hay cuenta configurada
                const cuenta = cuentas[0].length > 0 ? cuentas[0][0] : { cuenta: 'No configurada' };
                console.log(`📋 [DB] Facturas encontradas: ${facturas[0].length}, Cuenta: ${cuenta.cuenta}`);

                const resultado = { cliente, facturas: facturas[0], cuenta, bd };
                
                // Guardar en cache
                consultaCache.set(cacheKey, {
                    data: resultado,
                    timestamp: Date.now()
                });

                return resultado;
            } finally {
                conexion.release();
            }
        } catch (err) {
            console.error(`Error en BD ${bd.database}: ${err.message}`);
            continue;
        }
    }
    return null;
}

// Función para buscar cliente por número de teléfono/móvil
async function consultarClientePorTelefono(telefono) {
    // Limpiar y normalizar teléfono (remover espacios, guiones, caracteres especiales)
    const telefonoLimpio = telefono.toString().replace(/[\s\-\+\(\)]/g, '').trim();
    console.log(`🔍 [DB] Buscando cliente por teléfono - Original: "${telefono}", Limpio: "${telefonoLimpio}"`);

    // Generar variaciones del número para buscar
    // Si viene con código de país (ej: 573024019208), extraer sin código (3024019208)
    // Si viene sin código, probar con código de país de Colombia (57)
    let numerosABuscar = [telefonoLimpio];

    if (telefonoLimpio.startsWith('57') && telefonoLimpio.length > 10) {
        // Número con código de país, extraer sin código
        const numeroSinCodigo = telefonoLimpio.substring(2);
        numerosABuscar.push(numeroSinCodigo);
        console.log(`📱 [DB] Número con código país detectado. También buscaré: ${numeroSinCodigo}`);
    } else if (telefonoLimpio.length === 10) {
        // Número sin código de país, agregar código de Colombia
        const numeroConCodigo = '57' + telefonoLimpio;
        numerosABuscar.push(numeroConCodigo);
        console.log(`📱 [DB] Número sin código país. También buscaré: ${numeroConCodigo}`);
    }

    // Verificar cache primero
    const cacheKey = `telefono_${telefonoLimpio}`;
    const cached = consultaCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`📦 [DB] Cliente encontrado en caché por teléfono: ${cached.data.cliente.nombre}`);
        return cached.data;
    }

    for (const bd of basesDatos) {
        try {
            const pool = createConnectionPool(bd);
            const conexion = await pool.getConnection();

            try {
                console.log(`🔍 [DB] Buscando cliente en BD: ${bd.database} con números: ${numerosABuscar.join(', ')}`);

                // Construir condiciones dinámicas para buscar todas las variaciones
                const condiciones = [];
                const parametros = [];

                for (const num of numerosABuscar) {
                    condiciones.push('REPLACE(REPLACE(REPLACE(REPLACE(movil, " ", ""), "-", ""), "+", ""), "(", "") LIKE ?');
                    condiciones.push('REPLACE(REPLACE(REPLACE(REPLACE(telefono, " ", ""), "-", ""), "+", ""), "(", "") LIKE ?');
                    parametros.push(`%${num}%`);
                    parametros.push(`%${num}%`);
                }

                // Buscar por móvil o teléfono, incluyendo todas las variaciones del número
                const query = `SELECT id, nombre AS nombre, estado, cedula, telefono, movil, direccion_principal
                     FROM usuarios
                     WHERE (${condiciones.join(' OR ')})
                     LIMIT 1`;

                const [clientes] = await conexion.execute(query, parametros);

                if (clientes.length === 0) {
                    console.log(`⚠️ [DB] Cliente no encontrado por teléfono en BD: ${bd.database}`);
                    continue;
                }

                const cliente = clientes[0];
                console.log(`✅ [DB] Cliente encontrado por teléfono: ${cliente.nombre} (ID: ${cliente.id}) en BD: ${bd.database}`);

                // Obtener facturas y cuenta (igual que en consultarCliente)
                const [facturas, cuentas] = await Promise.all([
                    conexion.execute(
                        `SELECT
                            DATE_FORMAT(vencimiento, '%d/%m/%Y') AS vencimiento,
                            total,
                            estado,
                            CASE
                                WHEN vencimiento < CURDATE() THEN 'Vencida'
                                ELSE 'No pagado'
                            END AS situacion
                         FROM facturas
                         WHERE idcliente = ? AND TRIM(estado) IN ('No pagado', 'vencida')
                         ORDER BY vencimiento ASC
                         LIMIT 10`,
                        [cliente.id]
                    ),
                    conexion.execute('SELECT cuenta FROM numero_de_cuenta LIMIT 1')
                ]);

                const cuenta = cuentas[0].length > 0 ? cuentas[0][0] : { cuenta: 'No configurada' };
                console.log(`📋 [DB] Facturas encontradas: ${facturas[0].length}, Cuenta: ${cuenta.cuenta}`);

                const resultado = { cliente, facturas: facturas[0], cuenta, bd };

                // Guardar en cache
                consultaCache.set(cacheKey, {
                    data: resultado,
                    timestamp: Date.now()
                });

                return resultado;
            } finally {
                conexion.release();
            }
        } catch (err) {
            console.error(`Error en BD ${bd.database}: ${err.message}`);
            continue;
        }
    }
    return null;
}




// Funci�n para validar conexi�n a la base de datos
async function validarConexionBD(configBD) {
    try {
        const conexion = await mysql.createConnection(configBD);
        await conexion.ping();
        await conexion.end();
        return { success: true, message: 'Conexi�n exitosa' };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Nueva funci�n para insertar soporte
async function crearSoporte(idCliente, bd) {
    try {
        // Validar conexi�n antes de proceder
        const validacion = await validarConexionBD(bd);
        if (!validacion.success) {
            console.error('� Error de conexi�n a BD:', validacion.message);
            return null;
        }

        const conexion = await mysql.createConnection(bd);

        const sql = `
            INSERT INTO soporte (
                idcliente,
                idsoporte,
                asunto,
                fecha_soporte,
                estado,
                operador,
                procede,
                solicitante,
                lastdate,
                dp,
                oculto
            ) VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, NOW(), ?, ?)
        `;

        const valores = [
            idCliente,                               // idcliente
            1,                                       // idsoporte
            'LUZ ROJA EN EL EQUIPO.',       // asunto
            'abierto',                               // estado
            'CHATBOOT',                           // operador
            'S�',                                    // procede
            'cliente',                      // solicitante
            0,                                       // dp
            0                                        // oculto
        ];

        const [result] = await conexion.execute(sql, valores);
        await conexion.end();
        console.log('? Soporte creado con ID:', result.insertId);
        return result.insertId;
    } catch (err) {
        console.error('? Error insertando soporte:', err.message);
        return null;
    }
}

// ===== FUNCIONES PARA SISTEMA DE USUARIOS =====

// Crear tablas del sistema si no existen
async function inicializarSistema() {
    try {
        // Crear conexión sin especificar base de datos para crear la BD
        const conexionSinDB = await mysql.createConnection({
            host: dbSistema.host,
            user: dbSistema.user,
            password: dbSistema.password
        });

        // Crear base de datos si no existe
        await conexionSinDB.query('CREATE DATABASE IF NOT EXISTS solucnet_auth_system');
        await conexionSinDB.end();

        // Ahora conectar con la base de datos específica
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Crear tabla de usuarios
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS usuarios_sistema (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                rol ENUM('soporte', 'admin') NOT NULL DEFAULT 'soporte',
                activo BOOLEAN DEFAULT TRUE,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ultimo_acceso TIMESTAMP NULL,
                INDEX idx_username (username),
                INDEX idx_rol (rol)
            )
        `);

        // Crear tabla de números omitidos
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS numeros_omitidos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                numero VARCHAR(20) UNIQUE NOT NULL,
                motivo TEXT,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                creado_por INT,
                activo BOOLEAN DEFAULT TRUE,
                INDEX idx_numero (numero),
                INDEX idx_activo (activo),
                FOREIGN KEY (creado_por) REFERENCES usuarios_sistema(id)
            )
        `);

        // Crear tabla de sesiones
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS sesiones (
                id VARCHAR(255) PRIMARY KEY,
                usuario_id INT NOT NULL,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_expiracion TIMESTAMP NOT NULL,
                activo BOOLEAN DEFAULT TRUE,
                INDEX idx_usuario (usuario_id),
                INDEX idx_expiracion (fecha_expiracion),
                FOREIGN KEY (usuario_id) REFERENCES usuarios_sistema(id)
            )
        `);

        // Crear tabla de logs de API
        await conexion.query(`
            CREATE TABLE IF NOT EXISTS logs_api (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ip_origen VARCHAR(45) NOT NULL,
                numero_destino VARCHAR(20),
                mensaje TEXT,
                estado ENUM('enviado', 'error_envio', 'error_parametros', 'error_whatsapp_no_listo', 'error_excepcion') NOT NULL,
                fecha_envio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_fecha (fecha_envio),
                INDEX idx_estado (estado)
            )
        `);

        // Insertar usuarios por defecto si no existen
        const [usuarios] = await conexion.execute(
            'SELECT id FROM usuarios_sistema WHERE username = ?',
            ['admin']
        );

        if (usuarios.length === 0) {
            // Contraseña: admin123 (debería ser cambiada)
            const hashedPassword = await hashPassword('admin123');
            await conexion.execute(
                'INSERT INTO usuarios_sistema (username, password, nombre, rol) VALUES (?, ?, ?, ?)',
                ['admin', hashedPassword, 'Administrador', 'admin']
            );
            console.log('Usuario admin creado por defecto en solucnet_auth_system');
        }

        // Crear usuario de soporte por defecto
        const [usuariosSoporte] = await conexion.execute(
            'SELECT id FROM usuarios_sistema WHERE username = ?',
            ['soporte']
        );

        if (usuariosSoporte.length === 0) {
            // Contraseña: soporte123 (debería ser cambiada)
            const hashedPassword = await hashPassword('soporte123');
            await conexion.execute(
                'INSERT INTO usuarios_sistema (username, password, nombre, rol) VALUES (?, ?, ?, ?)',
                ['soporte', hashedPassword, 'Soporte Técnico', 'soporte']
            );
            console.log('Usuario soporte creado por defecto en solucnet_auth_system');
        }

        // Crear usuario API especial si no existe
        const [usuariosAPI] = await conexion.execute(
            'SELECT id FROM usuarios_sistema WHERE username = ?',
            ['api']
        );

        if (usuariosAPI.length === 0) {
            // Contraseña especial para API
            const hashedPassword = await hashPassword('api_system_secure_2024');
            await conexion.execute(
                'INSERT INTO usuarios_sistema (username, password, nombre, rol) VALUES (?, ?, ?, ?)',
                ['api', hashedPassword, 'Usuario API Especial', 'api']
            );
            console.log('✅ Usuario API especial creado por defecto en solucnet_auth_system');
        }

        await conexion.end();
        console.log('Sistema de usuarios inicializado correctamente');
    } catch (error) {
        console.error('Error inicializando sistema de usuarios:', error.message);
    }
}

// Función de hash para contraseñas usando bcrypt
async function hashPassword(password) {
    const bcrypt = require('bcrypt');
    return await bcrypt.hash(password, 10);
}

// Verificar contraseña
async function verifyPassword(password, hashedPassword) {
    try {
        const bcrypt = require('bcrypt');
        return await bcrypt.compare(password, hashedPassword);
    } catch (error) {
        // Fallback para contraseñas antiguas con SHA256 (por compatibilidad)
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(password + 'solucnet_salt').digest('hex');
        return hash === hashedPassword;
    }
}

// Pool para sistema de autenticación
let sistemaPool = null;
function getSistemaPool() {
    if (!sistemaPool) {
        sistemaPool = mysql.createPool({
            ...dbSistema,
            waitForConnections: true,
            connectionLimit: 2,
            queueLimit: 0,
            acquireTimeout: 8000,
            timeout: 8000,
            reconnect: true,
            idleTimeout: 600000 // 10 minutos
        });
    }
    return sistemaPool;
}

// Buscar usuario por credenciales
async function buscarUsuario(username, password) {
    try {
        const pool = getSistemaPool();
        const conexion = await pool.getConnection();
        
        try {
            await conexion.query('USE solucnet_auth_system');

            const [usuarios] = await conexion.execute(
                'SELECT id, username, password, nombre, rol, activo, puede_agregar_naps FROM usuarios_sistema WHERE username = ? AND activo = TRUE LIMIT 1',
                [username]
            );

            if (usuarios.length === 0) {
                return null;
            }

            const usuario = usuarios[0];
            const passwordValida = await verifyPassword(password, usuario.password);

            if (passwordValida) {
                delete usuario.password; // No devolver la contraseña
                return usuario;
            }

            return null;
        } finally {
            conexion.release();
        }
    } catch (error) {
        console.error('Error buscando usuario:', error.message);
        return null;
    }
}

// Crear token JWT
async function crearToken(usuarioId, userData) {
    try {
        const jwt = require('jsonwebtoken');
        const SECRET_KEY = process.env.JWT_SECRET || 'solucnet_jwt_secret_2024';

        const payload = {
            userId: usuarioId,
            username: userData.username,
            nombre: userData.nombre,
            rol: userData.rol,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 horas
        };

        const token = jwt.sign(payload, SECRET_KEY);

        // También guardamos una referencia en la base de datos para control de sesiones
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'INSERT INTO sesiones (id, usuario_id, fecha_expiracion) VALUES (?, ?, ?)',
            [token.substring(0, 255), usuarioId, new Date(payload.exp * 1000)]
        );

        await conexion.end();
        return token;
    } catch (error) {
        console.error('Error creando token:', error.message);
        return null;
    }
}

// Crear token eterno (sin expiración) para usuario API
async function crearTokenEternoAPI() {
    try {
        const jwt = require('jsonwebtoken');
        const SECRET_KEY = process.env.JWT_SECRET || 'solucnet_jwt_secret_2024';

        console.log('🔧 Generando token eterno para usuario API...');

        const payload = {
            userId: 'api_system',
            username: 'api',
            nombre: 'Usuario API Especial',
            rol: 'api',
            iat: Math.floor(Date.now() / 1000),
            // Sin exp (expiración) para que nunca expire
        };

        const token = jwt.sign(payload, SECRET_KEY);
        console.log('✅ Token eterno generado exitosamente');

        return token;
    } catch (error) {
        console.error('❌ Error creando token eterno:', error.message);
        return null;
    }
}

// Verificar token JWT
async function verificarToken(token) {
    try {
        const jwt = require('jsonwebtoken');
        const SECRET_KEY = process.env.JWT_SECRET || 'solucnet_jwt_secret_2024';
        
        // Verificar y decodificar el token
        const decoded = jwt.verify(token, SECRET_KEY);
        
        // Verificar que el usuario aún existe y está activo
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [usuarios] = await conexion.execute(
            'SELECT id, username, nombre, rol, activo, puede_agregar_naps FROM usuarios_sistema WHERE id = ? AND activo = TRUE',
            [decoded.userId]
        );

        if (usuarios.length === 0) {
            await conexion.end();
            return null;
        }

        const usuario = usuarios[0];
        await conexion.end();

        return {
            id: usuario.id,  // Agregar id para compatibilidad
            usuario_id: usuario.id,
            username: usuario.username,
            nombre: usuario.nombre,
            rol: usuario.rol,
            puede_agregar_naps: usuario.puede_agregar_naps,
            token_data: decoded
        };
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            console.log('Token inválido o expirado:', error.message);
        } else {
            console.error('Error verificando token:', error.message);
        }
        return null;
    }
}

// Verificar token eterno (sin expiración)
async function verificarTokenEterno(token) {
    try {
        const jwt = require('jsonwebtoken');
        const SECRET_KEY = process.env.JWT_SECRET || 'solucnet_jwt_secret_2024';

        // Para tokens eternos, usamos decode en lugar de verify
        const decoded = jwt.decode(token, { complete: true });

        if (!decoded) {
            console.log('Token eterno inválido');
            return null;
        }

        const payload = decoded.payload;

        // Verificar que sea un token eterno (sin expiración y con propiedades específicas)
        if (payload.permanent !== true || payload.rol !== 'api') {
            console.log('El token no es un token eterno válido');
            return null;
        }

        // Verificar que sea un token eterno de nuestra API
        if (!payload.userId || !payload.username || !payload.description) {
            console.log('Token eterno con estructura inválida');
            return null;
        }

        // Retornar usuario simulado para token eterno
        return {
            usuario_id: payload.userId,
            username: payload.username,
            nombre: payload.nombre,
            rol: payload.rol,
            token_data: payload,
            is_eternal: true
        };

    } catch (error) {
        console.error('Error verificando token eterno:', error.message);
        return null;
    }
}

// Cerrar sesión (invalidar token)
async function cerrarSesion(token) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Marcar el token como inactivo en la base de datos
        await conexion.execute(
            'UPDATE sesiones SET activo = FALSE WHERE id = ?',
            [token.substring(0, 255)]
        );

        await conexion.end();
        return true;
    } catch (error) {
        console.error('Error cerrando sesión:', error.message);
        return false;
    }
}

// ===== FUNCIONES PARA NÚMEROS OMITIDOS =====

// Agregar número omitido
async function agregarNumeroOmitido(numero, motivo, usuarioId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar si el número ya existe
        const [existe] = await conexion.execute(
            'SELECT id FROM numeros_omitidos WHERE numero = ? AND activo = TRUE',
            [numero]
        );

        if (existe.length > 0) {
            await conexion.end();
            return { success: false, message: 'El número ya está en la lista de omitidos' };
        }

        await conexion.execute(
            'INSERT INTO numeros_omitidos (numero, motivo, creado_por) VALUES (?, ?, ?)',
            [numero, motivo, usuarioId]
        );

        await conexion.end();
        return { success: true, message: 'Número agregado a la lista de omitidos' };
    } catch (error) {
        console.error('Error agregando número omitido:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// Obtener lista de números omitidos activos (para compatibilidad)
async function obtenerNumerosOmitidosActivos() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [numeros] = await conexion.execute(`
            SELECT n.id, n.numero, n.motivo, n.fecha_creacion, n.activo, u.nombre as creado_por
            FROM numeros_omitidos n
            LEFT JOIN usuarios_sistema u ON n.creado_por = u.id
            WHERE n.activo = TRUE
            ORDER BY n.fecha_creacion DESC
        `);

        await conexion.end();
        return { success: true, numeros };
    } catch (error) {
        console.error('Error obteniendo números omitidos activos:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// Obtener lista de números omitidos inactivos
async function obtenerNumerosOmitidosInactivos() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [numeros] = await conexion.execute(`
            SELECT n.id, n.numero, n.motivo, n.fecha_creacion, n.activo, u.nombre as creado_por
            FROM numeros_omitidos n
            LEFT JOIN usuarios_sistema u ON n.creado_por = u.id
            WHERE n.activo = FALSE
            ORDER BY n.fecha_creacion DESC
        `);

        await conexion.end();
        return { success: true, numeros };
    } catch (error) {
        console.error('Error obteniendo números omitidos inactivos:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// Obtener todos los números omitidos (activos e inactivos)
async function obtenerTodosLosNumerosOmitidos() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [numeros] = await conexion.execute(`
            SELECT n.id, n.numero, n.motivo, n.fecha_creacion, n.activo, u.nombre as creado_por
            FROM numeros_omitidos n
            LEFT JOIN usuarios_sistema u ON n.creado_por = u.id
            ORDER BY n.fecha_creacion DESC
        `);

        await conexion.end();
        return { success: true, numeros };
    } catch (error) {
        console.error('Error obteniendo todos los números omitidos:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// Verificar si un número está omitido
async function estaNumeroOmitido(numero) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [numeros] = await conexion.execute(
            'SELECT id FROM numeros_omitidos WHERE numero = ? AND activo = TRUE',
            [numero]
        );

        await conexion.end();
        return numeros.length > 0;
    } catch (error) {
        console.error('Error verificando número omitido:', error.message);
        return false;
    }
}

// Eliminar número omitido (eliminación completa de la base de datos)
async function eliminarNumeroOmitido(id) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Eliminar completamente el registro de la base de datos
        const [result] = await conexion.execute(
            'DELETE FROM numeros_omitidos WHERE id = ?',
            [id]
        );

        await conexion.end();
        
        if (result.affectedRows > 0) {
            console.log(`✅ Número omitido con ID ${id} eliminado permanentemente de la base de datos`);
            return { success: true, message: 'Número eliminado permanentemente de la base de datos' };
        } else {
            console.log(`⚠️ No se encontró el número omitido con ID ${id} para eliminar`);
            return { success: false, message: 'Número no encontrado' };
        }
    } catch (error) {
        console.error('Error eliminando número omitido:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// ===== FUNCIONES DE GESTIÓN DE USUARIOS =====

// Obtener todos los usuarios
async function obtenerUsuarios() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [usuarios] = await conexion.execute(
            'SELECT id, username, nombre, rol, fecha_creacion FROM usuarios_sistema ORDER BY fecha_creacion DESC'
        );

        await conexion.end();
        return { success: true, users: usuarios };
    } catch (error) {
        console.error('Error obteniendo usuarios:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// Crear nuevo usuario
async function crearUsuario(username, password, nombre, rol) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar si el usuario ya existe
        const [existente] = await conexion.execute(
            'SELECT id FROM usuarios_sistema WHERE username = ?',
            [username]
        );

        if (existente.length > 0) {
            await conexion.end();
            return { success: false, message: 'El nombre de usuario ya existe' };
        }

        // Crear hash de la contraseña
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insertar nuevo usuario
        await conexion.execute(
            'INSERT INTO usuarios_sistema (username, password, nombre, rol, fecha_creacion) VALUES (?, ?, ?, ?, NOW())',
            [username, hashedPassword, nombre, rol]
        );

        await conexion.end();
        return { success: true, message: 'Usuario creado exitosamente' };
    } catch (error) {
        console.error('Error creando usuario:', error.message);
        return { success: false, message: 'Error interno del servidor' };
    }
}

// Eliminar usuario
async function eliminarUsuario(id) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar que no sea el usuario admin principal
        const [usuario] = await conexion.execute(
            'SELECT username, rol FROM usuarios_sistema WHERE id = ?',
            [id]
        );

        if (usuario.length === 0) {
            await conexion.end();
            return { success: false, message: 'Usuario no encontrado' };
        }

        if (usuario[0].username === 'api') {
            await conexion.end();
            return { success: false, message: 'No se puede eliminar el usuario API especial' };
        }

        console.log(`🗑️ [ELIMINAR USUARIO] Eliminando usuario ID ${id} (${usuario[0].username}, rol: ${usuario[0].rol})`);

        // 1. Eliminar todas las sesiones del usuario
        await conexion.execute(
            'DELETE FROM sesiones WHERE usuario_id = ?',
            [id]
        );
        console.log('✅ [ELIMINAR USUARIO] Sesiones eliminadas');

        // 2. Eliminar ubicaciones de técnicos
        await conexion.execute(
            'DELETE FROM ubicaciones_tecnicos WHERE tecnico_id = ?',
            [id]
        );
        console.log('✅ [ELIMINAR USUARIO] Ubicaciones eliminadas');

        // 3. Actualizar visitas técnicas creadas por este usuario (poner NULL en creado_por)
        await conexion.execute(
            'UPDATE visitas_tecnicas SET creado_por = NULL WHERE creado_por = ?',
            [id]
        );
        console.log('✅ [ELIMINAR USUARIO] Referencias en visitas_tecnicas actualizadas');

        // 4. Actualizar números omitidos creados por este usuario
        await conexion.execute(
            'UPDATE numeros_omitidos SET creado_por = NULL WHERE creado_por = ?',
            [id]
        );
        console.log('✅ [ELIMINAR USUARIO] Referencias en numeros_omitidos actualizadas');

        // 5. Si es técnico, eliminar de la tabla tecnicos
        if (usuario[0].rol === 'tecnico') {
            await conexion.execute(
                'DELETE FROM tecnicos WHERE usuario_id = ? OR creado_por = ?',
                [id, id]
            );
            console.log('✅ [ELIMINAR USUARIO] Registro de técnico eliminado');
        }

        // 6. Finalmente, eliminar el usuario
        await conexion.execute(
            'DELETE FROM usuarios_sistema WHERE id = ?',
            [id]
        );
        console.log('✅ [ELIMINAR USUARIO] Usuario eliminado exitosamente');

        await conexion.end();
        return { success: true, message: 'Usuario eliminado exitosamente' };
    } catch (error) {
        console.error('❌ [ELIMINAR USUARIO] Error:', error.message);
        return { success: false, message: 'Error interno del servidor: ' + error.message };
    }
}

// Actualizar usuario
async function actualizarUsuario(id, datos) {
    let conexion;
    try {
        // Validar parámetros de entrada
        if (!id || !datos) {
            return { success: false, message: 'ID y datos son requeridos' };
        }

        console.log('🔧 Intentando actualizar usuario ID:', id);
        console.log('📊 Datos a actualizar:', Object.keys(datos));

        conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar que el usuario existe
        const [usuarioExistente] = await conexion.execute(
            'SELECT id, username FROM usuarios_sistema WHERE id = ?',
            [id]
        );

        if (usuarioExistente.length === 0) {
            await conexion.end();
            return { success: false, message: 'Usuario no encontrado' };
        }

        const usuarioActual = usuarioExistente[0];

        // Verificar si es usuario protegido (solo proteger usuario 'api')
        if (usuarioActual.username === 'api') {
            await conexion.end();
            return { success: false, message: 'No se puede modificar el usuario API del sistema' };
        }

        // Verificar si el username ya existe (si cambió)
        if (datos.username && datos.username !== usuarioActual.username) {
            const [usuarioDuplicado] = await conexion.execute(
                'SELECT id FROM usuarios_sistema WHERE username = ? AND id != ?',
                [datos.username, id]
            );

            if (usuarioDuplicado.length > 0) {
                await conexion.end();
                return { success: false, message: 'El nombre de usuario ya existe' };
            }
        }

        // Preparar datos para actualizar
        const camposActualizar = [];
        const valores = [];

        if (datos.username) {
            camposActualizar.push('username = ?');
            valores.push(datos.username);
        }

        if (datos.nombre) {
            camposActualizar.push('nombre = ?');
            valores.push(datos.nombre);
        }

        if (datos.rol) {
            camposActualizar.push('rol = ?');
            valores.push(datos.rol);
        }

        if (datos.password) {
            try {
                const bcrypt = require('bcrypt');
                const hashedPassword = await bcrypt.hash(datos.password, 10);
                camposActualizar.push('password = ?');
                valores.push(hashedPassword);
            } catch (bcryptError) {
                console.error('Error procesando contraseña con bcrypt:', bcryptError.message);
                await conexion.end();
                return { success: false, message: 'Error procesando contraseña' };
            }
        }

        // Solo actualizar si hay campos para actualizar
        if (camposActualizar.length === 0) {
            await conexion.end();
            return { success: false, message: 'No hay datos para actualizar' };
        }

        // Agregar ID al final de los valores
        valores.push(id);

        const query = `UPDATE usuarios_sistema SET ${camposActualizar.join(', ')} WHERE id = ?`;

        await conexion.execute(query, valores);

        // Si se cambió el rol o el username, cerrar todas las sesiones del usuario
        if (datos.rol || datos.username) {
            await conexion.execute(
                'DELETE FROM sesiones WHERE usuario_id = ?',
                [id]
            );
        }

        await conexion.end();
        console.log('✅ Usuario actualizado exitosamente:', id);
        return { success: true, message: 'Usuario actualizado exitosamente' };
    } catch (error) {
        console.error('❌ Error actualizando usuario:', error.message);
        console.error('Stack trace:', error.stack);

        // Cerrar conexión si existe
        if (conexion) {
            try {
                await conexion.end();
            } catch (closeError) {
                console.error('Error cerrando conexión:', closeError.message);
            }
        }

        // Proporcionar mensajes de error más específicos
        if (error.code === 'ECONNREFUSED') {
            return { success: false, message: 'Error de conexión a la base de datos' };
        } else if (error.code === 'ER_DUP_ENTRY') {
            return { success: false, message: 'El nombre de usuario ya existe' };
        } else if (error.message.includes('bcrypt')) {
            return { success: false, message: 'Error procesando la contraseña' };
        } else {
            return { success: false, message: 'Error interno del servidor' };
        }
    }
}

// ===== FUNCIONES PARA LOGS DE API =====

// Registrar log de API
async function registrarLogAPI(ip, numero, mensaje, estado = 'enviado') {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'INSERT INTO logs_api (ip_origen, numero_destino, mensaje, estado, fecha_envio) VALUES (?, ?, ?, ?, NOW())',
            [ip, numero, mensaje, estado]
        );

        await conexion.end();
        return { success: true };
    } catch (error) {
        console.error('Error registrando log API:', error.message);
        return { success: false, message: 'Error registrando log' };
    }
}

// Obtener logs de API
async function obtenerLogsAPI(limite = 100) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [logs] = await conexion.execute(
            'SELECT id, ip_origen, numero_destino, mensaje, estado, fecha_envio FROM logs_api ORDER BY fecha_envio DESC LIMIT ?',
            [String(limite)]
        );

        await conexion.end();
        return { success: true, logs: logs };
    } catch (error) {
        console.error('Error obteniendo logs API:', error.message);
        return { success: false, message: 'Error obteniendo logs' };
    }
}

// Eliminar logs antiguos (opcional - para mantenimiento)
async function limpiarLogsAPI(diasAntiguedad = 30) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'DELETE FROM logs_api WHERE fecha_envio < DATE_SUB(NOW(), INTERVAL ? DAY)',
            [diasAntiguedad]
        );

        await conexion.end();
        return { success: true };
    } catch (error) {
        console.error('Error limpiando logs API:', error.message);
        return { success: false, message: 'Error limpiando logs' };
    }
}

// Limpiar sesiones expiradas
async function limpiarSesionesExpiradas() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [result] = await conexion.execute(
            'UPDATE sesiones SET activo = FALSE WHERE activo = TRUE AND fecha_expiracion <= NOW()'
        );

        await conexion.end();
        return {
            success: true,
            message: `Se marcaron como inactivas ${result.affectedRows} sesiones expiradas`
        };
    } catch (error) {
        console.error('Error limpiando sesiones expiradas:', error.message);
        return {
            success: false,
            message: 'Error interno del servidor'
        };
    }
}

// Migrar contraseñas antiguas de SHA256 a bcrypt
async function migrarContrasenas() {
    try {
        console.log('🔄 Iniciando migración de contraseñas a bcrypt...');
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Obtener todos los usuarios
        const [usuarios] = await conexion.execute(
            'SELECT id, username, password FROM usuarios_sistema'
        );

        let migrados = 0;
        const bcrypt = require('bcrypt');

        for (const usuario of usuarios) {
            try {
                // Verificar si la contraseña usa SHA256 (longitud 64 caracteres hexadecimales)
                if (usuario.password && usuario.password.length === 64 && /^[a-f0-9]{64}$/i.test(usuario.password)) {
                    // Es una contraseña SHA256, convertir a bcrypt
                    const nuevaPassword = await bcrypt.hash(usuario.password, 10);

                    await conexion.execute(
                        'UPDATE usuarios_sistema SET password = ? WHERE id = ?',
                        [nuevaPassword, usuario.id]
                    );

                    console.log(`✅ Migrada contraseña para usuario: ${usuario.username}`);
                    migrados++;
                }
            } catch (error) {
                console.error(`❌ Error migrando usuario ${usuario.username}:`, error.message);
            }
        }

        await conexion.end();
        console.log(`🎯 Migración completada: ${migrados} contraseñas actualizadas`);
        return {
            success: true,
            message: `Migración completada: ${migrados} contraseñas actualizadas a bcrypt`
        };
    } catch (error) {
        console.error('❌ Error en migración de contraseñas:', error.message);
        return {
            success: false,
            message: 'Error interno del servidor durante migración'
        };
    }
}

// Limpiar cache periódicamente
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of consultaCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            consultaCache.delete(key);
        }
    }
}, CACHE_TTL); // Ejecutar cada 5 minutos

// ===== FUNCIÓN PARA CREAR USUARIO API ESPECIAL =====
async function crearUsuarioAPI() {
    let conexion;
    try {
        console.log('🔧 Verificando existencia del usuario API especial...');

        conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        // Verificar si el usuario 'api' ya existe
        const [usuarioExistente] = await conexion.execute(
            'SELECT id FROM usuarios_sistema WHERE username = ?',
            ['api']
        );

        if (usuarioExistente.length > 0) {
            console.log('✅ El usuario API ya existe');
            await conexion.end();
            return { success: true, message: 'Usuario API ya existe' };
        }

        // Crear contraseña hash para el usuario API
        const bcrypt = require('bcrypt');
        const passwordAPI = 'api_system_secure_2024'; // Contraseña especial para API
        const hashedPassword = await bcrypt.hash(passwordAPI, 10);

        // Crear usuario API
        const result = await conexion.execute(
            'INSERT INTO usuarios_sistema (username, password, nombre, rol, fecha_creacion) VALUES (?, ?, ?, ?, NOW())',
            ['api', hashedPassword, 'Usuario API Especial', 'api', 'api']
        );

        await conexion.end();
        console.log('✅ Usuario API creado exitosamente con ID:', result[0].insertId);
        return {
            success: true,
            message: 'Usuario API creado exitosamente',
            password: passwordAPI // Devolver la contraseña para que el admin la conozca
        };

    } catch (error) {
        console.error('❌ Error creando usuario API:', error.message);
        if (conexion) {
            try {
                await conexion.end();
            } catch (closeError) {
                console.error('Error cerrando conexión:', closeError.message);
            }
        }
        return { success: false, message: 'Error creando usuario API: ' + error.message };
    }
}

// Nueva función para buscar clientes con información de seriales de equipos asignados
async function buscarClientesConSerial(termino) {
    const resultados = [];

    for (const bd of basesDatos) {
        try {
            const pool = createConnectionPool(bd);
            const conexion = await pool.getConnection();

            try {
                const consultaSQL = `
                    SELECT DISTINCT
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
                        srv.nodo as mikrotik_nombre,
                        srv.serial as mikrotik_serial,
                        ts.mac as equipo_mac,
                        ts.onu_sn as onu_serial,
                        alm.serial_producto as equipo_serial_almacen,
                        mat.serial as equipo_serial_material,
                        mat.detalle as equipo_tipo,
                        alm.estado as equipo_estado
                    FROM usuarios u
                    LEFT JOIN tblservicios ts ON u.id = ts.idcliente
                    LEFT JOIN server srv ON ts.nodo = srv.id
                    LEFT JOIN almacen alm ON u.id = alm.userid AND alm.estado IN ('comodato', 'vendido', 'prestado')
                    LEFT JOIN materiales mat ON alm.id = mat.idalmacen
                    WHERE (u.cedula LIKE ? OR u.nombre LIKE ? OR ts.pppuser LIKE ?)
                    AND u.estado != 'ELIMINADO'
                    LIMIT 50
                `;

                const [clientes] = await conexion.execute(consultaSQL, [`%${termino}%`, `%${termino}%`, `%${termino}%`]);

                // Agrupar por cliente (ya que el JOIN con almacen puede duplicar filas)
                const clientesMap = new Map();

                for (const cliente of clientes) {
                    const clienteKey = `${bd.host}-${cliente.id}`;

                    // Si ya procesamos este cliente, saltar
                    if (clientesMap.has(clienteKey)) {
                        continue;
                    }

                    cliente.bd_origen = bd.host;
                    cliente.bd_info = bd;

                    // Determinar el serial principal del equipo asignado
                    cliente.serial_equipo_asignado = cliente.equipo_serial_almacen || cliente.equipo_serial_material || null;

                    // Obtener TODOS los equipos asignados al cliente
                    try {
                        const [equipos] = await conexion.execute(`
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
                        `, [cliente.id]);

                        if (equipos.length > 0) {
                            cliente.todos_los_equipos = equipos;
                        }
                    } catch (equipoError) {
                        console.error(`Error obteniendo equipos del cliente ${cliente.id}:`, equipoError.message);
                    }

                    clientesMap.set(clienteKey, cliente);
                }

                // Agregar clientes únicos a resultados
                resultados.push(...Array.from(clientesMap.values()));

            } finally {
                conexion.release();
            }
        } catch (err) {
            console.error(`Error buscando clientes en BD ${bd.host}: ${err.message}`);
            continue;
        }
    }

    return { success: true, clientes: resultados };
}

// ===== FUNCIONES PARA COLA DE MENSAJES API (PERSISTENCIA) =====

// Crear tabla de cola de mensajes si no existe
async function inicializarColaMensajesAPI() {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.query(`
            CREATE TABLE IF NOT EXISTS cola_mensajes_api (
                id INT AUTO_INCREMENT PRIMARY KEY,
                chat_id VARCHAR(50) NOT NULL,
                mensaje TEXT NOT NULL,
                ruta_archivo VARCHAR(500) NULL,
                tipo_mensaje ENUM('text', 'image', 'audio', 'file') NOT NULL DEFAULT 'text',
                estado ENUM('pendiente', 'procesando', 'enviado', 'error', 'descartado') NOT NULL DEFAULT 'pendiente',
                intentos INT DEFAULT 0,
                max_intentos INT DEFAULT 5,
                fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                fecha_envio TIMESTAMP NULL,
                error_mensaje TEXT NULL,
                INDEX idx_chat_id (chat_id),
                INDEX idx_estado (estado),
                INDEX idx_fecha_creacion (fecha_creacion)
            )
        `);

        await conexion.end();
        console.log('✅ Tabla cola_mensajes_api inicializada correctamente');
        return { success: true };
    } catch (error) {
        console.error('❌ Error inicializando tabla cola_mensajes_api:', error.message);
        return { success: false, message: error.message };
    }
}

// Agregar mensaje a la cola en BD
async function agregarMensajeAColaBD(chatId, mensaje, rutaArchivo = null, tipoMensaje = 'text') {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [result] = await conexion.execute(
            'INSERT INTO cola_mensajes_api (chat_id, mensaje, ruta_archivo, tipo_mensaje) VALUES (?, ?, ?, ?)',
            [chatId, mensaje, rutaArchivo, tipoMensaje]
        );

        await conexion.end();
        console.log(`✅ [COLA BD] Mensaje agregado con ID: ${result.insertId}`);
        return { success: true, messageId: result.insertId };
    } catch (error) {
        console.error('❌ Error agregando mensaje a cola BD:', error.message);
        return { success: false, message: error.message };
    }
}

// Obtener mensajes pendientes de la cola
async function obtenerMensajesPendientesBD(limite = 10) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        const [mensajes] = await conexion.execute(
            `SELECT * FROM cola_mensajes_api
             WHERE estado = 'pendiente' AND intentos < max_intentos
             ORDER BY fecha_creacion ASC
             LIMIT ?`,
            [limite]
        );

        await conexion.end();
        return { success: true, mensajes };
    } catch (error) {
        console.error('❌ Error obteniendo mensajes pendientes:', error.message);
        return { success: false, message: error.message };
    }
}

// Marcar mensaje como enviado
async function marcarMensajeComoEnviadoBD(messageId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'UPDATE cola_mensajes_api SET estado = ?, fecha_envio = NOW() WHERE id = ?',
            ['enviado', messageId]
        );

        await conexion.end();
        console.log(`✅ [COLA BD] Mensaje ${messageId} marcado como enviado`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error marcando mensaje como enviado:', error.message);
        return { success: false, message: error.message };
    }
}

// Marcar mensaje como error
async function marcarMensajeComoErrorBD(messageId, errorMensaje) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'UPDATE cola_mensajes_api SET estado = ?, error_mensaje = ? WHERE id = ?',
            ['error', errorMensaje, messageId]
        );

        await conexion.end();
        console.log(`⚠️ [COLA BD] Mensaje ${messageId} marcado como error`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error marcando mensaje como error:', error.message);
        return { success: false, message: error.message };
    }
}

// Incrementar intentos de un mensaje
async function incrementarIntentoBD(messageId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'UPDATE cola_mensajes_api SET intentos = intentos + 1 WHERE id = ?',
            [messageId]
        );

        await conexion.end();
        console.log(`🔄 [COLA BD] Intento incrementado para mensaje ${messageId}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error incrementando intento:', error.message);
        return { success: false, message: error.message };
    }
}

// Marcar mensaje como descartado (después de máximo intentos)
async function marcarMensajeComoDescartadoBD(messageId) {
    try {
        const conexion = await mysql.createConnection(dbSistema);
        await conexion.query('USE solucnet_auth_system');

        await conexion.execute(
            'UPDATE cola_mensajes_api SET estado = ? WHERE id = ?',
            ['descartado', messageId]
        );

        await conexion.end();
        console.log(`❌ [COLA BD] Mensaje ${messageId} descartado (máximo de reintentos alcanzado)`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error marcando mensaje como descartado:', error.message);
        return { success: false, message: error.message };
    }
}

// ===== FUNCIÓN PARA ACTUALIZAR COORDENADAS EN BD EXTERNA =====

/**
 * Actualiza las coordenadas de un cliente en la base de datos externa (Mikrowisp)
 * Busca el cliente en las 3 bases de datos y actualiza en la que lo encuentre
 */
async function actualizarCoordenadasCliente(cedula, latitud, longitud) {
    try {
        console.log(`🗺️ [COORDS] Buscando cliente con cédula ${cedula} para actualizar coordenadas...`);

        // Limpiar cédula
        const cedulaLimpia = cedula.toString().replace(/[.\-\s]/g, '').trim();

        for (const bd of basesDatos) {
            try {
                const pool = createConnectionPool(bd);
                const conexion = await pool.getConnection();

                try {
                    // Buscar cliente en esta BD
                    const [clientes] = await conexion.execute(
                        'SELECT id FROM usuarios WHERE cedula = ? LIMIT 1',
                        [cedulaLimpia]
                    );

                    if (clientes.length === 0) {
                        console.log(`⚠️ [COORDS] Cliente no encontrado en BD: ${bd.host}`);
                        continue;
                    }

                    const clienteId = clientes[0].id;
                    console.log(`✅ [COORDS] Cliente encontrado en BD: ${bd.host} (ID: ${clienteId})`);

                    // Formato de coordenadas: "latitud,longitud"
                    const coordenadasFormato = `${latitud},${longitud}`;

                    // Verificar si ya existe un registro en tblservicios
                    const [servicios] = await conexion.execute(
                        'SELECT id FROM tblservicios WHERE idcliente = ? LIMIT 1',
                        [clienteId]
                    );

                    if (servicios.length > 0) {
                        // Actualizar coordenadas existentes
                        await conexion.execute(
                            'UPDATE tblservicios SET coordenadas = ? WHERE idcliente = ?',
                            [coordenadasFormato, clienteId]
                        );
                        console.log(`✅ [COORDS] Coordenadas actualizadas en ${bd.host}: ${coordenadasFormato}`);
                    } else {
                        // Insertar nuevo registro con coordenadas
                        await conexion.execute(
                            'INSERT INTO tblservicios (idcliente, coordenadas) VALUES (?, ?)',
                            [clienteId, coordenadasFormato]
                        );
                        console.log(`✅ [COORDS] Coordenadas insertadas en ${bd.host}: ${coordenadasFormato}`);
                    }

                    conexion.release();
                    return {
                        success: true,
                        message: `Coordenadas actualizadas en ${bd.host}`,
                        bd_host: bd.host
                    };

                } finally {
                    conexion.release();
                }
            } catch (err) {
                console.error(`❌ [COORDS] Error en BD ${bd.host}:`, err.message);
                continue;
            }
        }

        console.log(`⚠️ [COORDS] Cliente con cédula ${cedulaLimpia} no encontrado en ninguna BD`);
        return {
            success: false,
            message: 'Cliente no encontrado en ninguna base de datos'
        };

    } catch (error) {
        console.error('❌ [COORDS] Error actualizando coordenadas:', error.message);
        return {
            success: false,
            message: error.message
        };
    }
}

module.exports = {
    consultarCliente,
    consultarClientePorTelefono,
    buscarClientesConSerial,
    crearSoporte,
    inicializarSistema,
    buscarUsuario,
    crearToken,
    crearTokenEternoAPI,
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
    limpiarSesionesExpiradas,
    migrarContrasenas,
    crearUsuarioAPI,
    // Funciones de cola de mensajes API
    inicializarColaMensajesAPI,
    agregarMensajeAColaBD,
    obtenerMensajesPendientesBD,
    marcarMensajeComoEnviadoBD,
    marcarMensajeComoErrorBD,
    incrementarIntentoBD,
    marcarMensajeComoDescartadoBD,
    // Función para actualizar coordenadas
    actualizarCoordenadasCliente
};
