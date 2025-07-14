const crypto = require('crypto');

class AuthMiddleware {
    constructor() {
        this.sessions = new Map();
        this.sessionTimeout = 24 * 60 * 60 * 1000; // 24 horas
    }

    // Generar hash de contraseña
    hashPassword(password) {
        return crypto.createHash('sha256').update(password).digest('hex');
    }

    // Verificar contraseña
    verifyPassword(password, hash) {
        return this.hashPassword(password) === hash;
    }

    // Generar token de sesión
    generateSessionToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    // Crear sesión
    createSession(userId) {
        const token = this.generateSessionToken();
        const expiresAt = Date.now() + this.sessionTimeout;
        
        this.sessions.set(token, {
            userId,
            expiresAt,
            createdAt: Date.now()
        });

        return token;
    }

    // Verificar sesión
    verifySession(token) {
        const session = this.sessions.get(token);
        
        if (!session) {
            console.log('🔍 Sesión no encontrada para token:', token.substring(0, 8) + '...');
            return false;
        }

        if (Date.now() > session.expiresAt) {
            console.log('⏰ Sesión expirada para usuario:', session.userId);
            this.sessions.delete(token);
            return false;
        }

        console.log('✅ Sesión válida para usuario:', session.userId);
        return true;
    }

    // Eliminar sesión
    destroySession(token) {
        this.sessions.delete(token);
    }

    // Limpiar sesiones expiradas
    cleanupExpiredSessions() {
        const now = Date.now();
        for (const [token, session] of this.sessions.entries()) {
            if (now > session.expiresAt) {
                this.sessions.delete(token);
            }
        }
    }

    // Middleware de autenticación
    requireAuth(req, res, next) {
        const token = req.cookies?.sessionToken || req.headers['x-session-token'];
        
        if (!token || !this.verifySession(token)) {
            if (req.xhr || req.path.startsWith('/api/')) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'No autorizado',
                    redirect: '/login'
                });
            }
            return res.redirect('/login');
        }

        next();
    }

    // Middleware para páginas de login/logout
    requireGuest(req, res, next) {
        const token = req.cookies?.sessionToken || req.headers['x-session-token'];
        
        if (token && this.verifySession(token)) {
            return res.redirect('/');
        }

        next();
    }
}

module.exports = AuthMiddleware; 