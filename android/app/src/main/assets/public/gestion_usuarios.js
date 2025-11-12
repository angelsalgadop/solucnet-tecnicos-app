// Variables globales
let usuarios = [];
let usuarioActualSesion = null;

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', async function() {
    // Verificar autenticación
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/';
        return;
    }

    // Verificar que sea admin
    await verificarRolAdmin();

    // Cargar información del usuario actual
    await cargarInfoUsuario();

    // Cargar usuarios
    await cargarUsuarios();
});

// Verificar que el usuario sea admin
async function verificarRolAdmin() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/verificar-admin', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const resultado = await response.json();

        if (!resultado.success || resultado.rol !== 'admin') {
            alert('❌ Acceso denegado. Solo administradores pueden acceder a esta página.');
            window.location.href = '/admin_visitas.html';
        }
    } catch (error) {
        console.error('Error verificando rol:', error);
        window.location.href = '/';
    }
}

// Cargar información del usuario actual
async function cargarInfoUsuario() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/usuario-actual', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const resultado = await response.json();

        if (resultado.success) {
            usuarioActualSesion = resultado.usuario;
            document.getElementById('usuarioActual').textContent =
                `${resultado.usuario.nombre} (${resultado.usuario.rol})`;
        }
    } catch (error) {
        console.error('Error cargando info usuario:', error);
    }
}

// Cargar todos los usuarios
async function cargarUsuarios() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/usuarios', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const resultado = await response.json();

        if (resultado.success) {
            usuarios = resultado.usuarios;
            mostrarUsuarios();
        } else {
            mostrarAlerta('Error cargando usuarios', 'danger');
        }
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        mostrarAlerta('Error de conexión', 'danger');
    }
}

// Mostrar usuarios en la tabla
function mostrarUsuarios() {
    const tbody = document.getElementById('tablaUsuarios');

    if (usuarios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay usuarios</td></tr>';
        return;
    }

    tbody.innerHTML = usuarios.map(usuario => `
        <tr>
            <td>${usuario.id}</td>
            <td><strong>${usuario.username}</strong></td>
            <td>${usuario.nombre}</td>
            <td>
                <span class="badge ${
                    usuario.rol === 'admin' ? 'bg-danger' :
                    usuario.rol === 'tecnico' ? 'bg-primary' : 'bg-info'
                }">
                    ${usuario.rol.toUpperCase()}
                </span>
            </td>
            <td>
                <span class="badge ${usuario.activo ? 'bg-success' : 'bg-secondary'}">
                    ${usuario.activo ? 'Activo' : 'Inactivo'}
                </span>
            </td>
            <td>
                <small>${usuario.ultimo_acceso ?
                    new Date(usuario.ultimo_acceso).toLocaleString('es-CO') :
                    'Nunca'
                }</small>
            </td>
            <td>
                <button class="btn btn-sm btn-primary me-1" onclick="editarUsuario(${usuario.id})"
                        title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-warning me-1" onclick="mostrarModalCambiarPassword(${usuario.id})"
                        title="Cambiar contraseña">
                    <i class="fas fa-key"></i>
                </button>
                ${usuario.id !== usuarioActualSesion?.id ? `
                    <button class="btn btn-sm btn-danger" onclick="eliminarUsuario(${usuario.id})"
                            title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

// Mostrar modal para crear usuario
function mostrarModalCrearUsuario() {
    document.getElementById('modalUsuarioTitulo').innerHTML =
        '<i class="fas fa-user-plus"></i> Crear Usuario';
    document.getElementById('formUsuario').reset();
    document.getElementById('usuarioId').value = '';
    document.getElementById('campoPassword').style.display = 'block';
    document.getElementById('password').required = true;

    const modal = new bootstrap.Modal(document.getElementById('modalUsuario'));
    modal.show();
}

// Editar usuario
function editarUsuario(id) {
    const usuario = usuarios.find(u => u.id === id);
    if (!usuario) return;

    document.getElementById('modalUsuarioTitulo').innerHTML =
        '<i class="fas fa-user-edit"></i> Editar Usuario';
    document.getElementById('usuarioId').value = usuario.id;
    document.getElementById('username').value = usuario.username;
    document.getElementById('nombre').value = usuario.nombre;
    document.getElementById('rol').value = usuario.rol;
    document.getElementById('activo').checked = usuario.activo;

    // Ocultar campo de contraseña al editar
    document.getElementById('campoPassword').style.display = 'none';
    document.getElementById('password').required = false;

    const modal = new bootstrap.Modal(document.getElementById('modalUsuario'));
    modal.show();
}

// Guardar usuario (crear o actualizar)
async function guardarUsuario() {
    const id = document.getElementById('usuarioId').value;
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const nombre = document.getElementById('nombre').value.trim();
    const rol = document.getElementById('rol').value;
    const activo = document.getElementById('activo').checked;

    if (!username || !nombre || !rol) {
        mostrarAlerta('Por favor completa todos los campos obligatorios', 'warning');
        return;
    }

    if (!id && !password) {
        mostrarAlerta('La contraseña es obligatoria para nuevos usuarios', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const url = id ? `/api/usuarios/${id}` : '/api/usuarios';
        const method = id ? 'PUT' : 'POST';

        const body = { username, nombre, rol, activo };
        if (!id || password) {
            body.password = password;
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta(id ? 'Usuario actualizado exitosamente' : 'Usuario creado exitosamente', 'success');
            bootstrap.Modal.getInstance(document.getElementById('modalUsuario')).hide();
            await cargarUsuarios();
        } else {
            mostrarAlerta(resultado.message || 'Error guardando usuario', 'danger');
        }
    } catch (error) {
        console.error('Error guardando usuario:', error);
        mostrarAlerta('Error de conexión', 'danger');
    }
}

// Mostrar modal para cambiar contraseña
function mostrarModalCambiarPassword(id) {
    const usuario = usuarios.find(u => u.id === id);
    if (!usuario) return;

    document.getElementById('passwordUserId').value = usuario.id;
    document.getElementById('passwordUserName').textContent =
        `${usuario.nombre} (@${usuario.username})`;
    document.getElementById('nuevaPassword').value = '';
    document.getElementById('confirmarPassword').value = '';

    const modal = new bootstrap.Modal(document.getElementById('modalCambiarPassword'));
    modal.show();
}

// Cambiar contraseña
async function cambiarPassword() {
    const userId = document.getElementById('passwordUserId').value;
    const nuevaPassword = document.getElementById('nuevaPassword').value;
    const confirmarPassword = document.getElementById('confirmarPassword').value;

    if (!nuevaPassword || !confirmarPassword) {
        mostrarAlerta('Por favor completa ambos campos', 'warning');
        return;
    }

    if (nuevaPassword !== confirmarPassword) {
        mostrarAlerta('Las contraseñas no coinciden', 'warning');
        return;
    }

    if (nuevaPassword.length < 4) {
        mostrarAlerta('La contraseña debe tener al menos 4 caracteres', 'warning');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/usuarios/${userId}/password`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ password: nuevaPassword })
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Contraseña actualizada exitosamente', 'success');
            bootstrap.Modal.getInstance(document.getElementById('modalCambiarPassword')).hide();
        } else {
            mostrarAlerta(resultado.message || 'Error cambiando contraseña', 'danger');
        }
    } catch (error) {
        console.error('Error cambiando contraseña:', error);
        mostrarAlerta('Error de conexión', 'danger');
    }
}

// Eliminar usuario
async function eliminarUsuario(id) {
    const usuario = usuarios.find(u => u.id === id);
    if (!usuario) return;

    if (!confirm(`¿Estás seguro de eliminar el usuario "${usuario.nombre}" (@${usuario.username})?`)) {
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/usuarios/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const resultado = await response.json();

        if (resultado.success) {
            mostrarAlerta('Usuario eliminado exitosamente', 'success');
            await cargarUsuarios();
        } else {
            mostrarAlerta(resultado.message || 'Error eliminando usuario', 'danger');
        }
    } catch (error) {
        console.error('Error eliminando usuario:', error);
        mostrarAlerta('Error de conexión', 'danger');
    }
}

// Cerrar sesión
function cerrarSesion() {
    localStorage.removeItem('token');
    window.location.href = '/';
}

// Mostrar alertas
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
