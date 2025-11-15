// Configuración de la app móvil
const APP_CONFIG = {
    // Detectar si está corriendo en app nativa
    // Capacitor agrega el protocolo capacitor:// o se puede detectar por window.Capacitor
    _isNative: (function() {
        // Verificar si Capacitor está disponible
        if (typeof window !== 'undefined' && window.Capacitor) {
            return true;
        }
        // Verificar si está usando el protocolo capacitor://
        if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:') {
            return true;
        }
        return false;
    })(),

    // URL del servidor (IMPORTANTE: Solo la base, sin rutas)
    // Para desarrollo local: 'http://localhost:3000'
    // Para producción: El servidor Node.js corre en puerto 3000 con SSL válido
    SERVER_URL: 'https://cliente.solucnet.com:3000',

    // Función helper para construir URLs de API
    getApiUrl: function(endpoint) {
        // Asegurar que el endpoint empiece con /
        if (!endpoint.startsWith('/')) {
            endpoint = '/' + endpoint;
        }

        // Si es app nativa, usar SERVER_URL completo
        if (this._isNative) {
            return this.SERVER_URL + endpoint;
        }

        // Si es web, usar ruta relativa (el navegador agregará el dominio)
        return endpoint;
    },

    // Función helper para redirecciones
    redirectTo: function(path) {
        // Remover / inicial si existe
        const cleanPath = path.replace(/^\//, '');

        if (this._isNative) {
            // En app nativa, redirigir a archivo local sin /
            window.location.href = cleanPath;
        } else {
            // En web, usar ruta normal
            window.location.href = '/' + cleanPath;
        }
    },

    // Getter público para saber si es nativo
    isNative: function() {
        return this._isNative;
    }
};

// Log de configuración para debugging
console.log('🔧 APP_CONFIG inicializado:', {
    isNative: APP_CONFIG.isNative(),
    serverUrl: APP_CONFIG.SERVER_URL,
    protocol: window.location.protocol,
    hasCapacitor: typeof window.Capacitor !== 'undefined'
});
