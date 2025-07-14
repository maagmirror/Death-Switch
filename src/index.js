require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const cookieParser = require('cookie-parser');
const Database = require('./database');
const EmailService = require('./services/emailService');
const VerificationService = require('./services/verificationService');
const EncryptionService = require('./services/encryptionService');
const AuthMiddleware = require('./middleware/auth');
const multer = require('multer');
const upload = multer({ dest: 'tmp_uploads/' });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Inicializar autenticación
const auth = new AuthMiddleware();

// Inicializar servicios
const db = new Database();
const emailService = new EmailService();
const verificationService = new VerificationService(db, emailService);
const encryptionService = new EncryptionService();

// Crear directorios necesarios
async function initializeApp() {
    try {
        await fs.ensureDir(process.env.DATA_FOLDER || './encrypted_data');
        await fs.ensureDir('./data');
        await fs.ensureDir('./public');
        await fs.ensureDir('./templates');
        
        console.log('✅ Directorios creados correctamente');
        
        // Inicializar base de datos
        await db.initialize();
        console.log('✅ Base de datos inicializada');
        
        // Inicializar servicios
        await emailService.initialize();
        console.log('✅ Servicio de email inicializado');
        
        // Iniciar verificación periódica
        verificationService.startPeriodicVerification();
        console.log('✅ Verificación periódica iniciada');
        
        // Limpiar sesiones expiradas cada hora
        setInterval(() => {
            auth.cleanupExpiredSessions();
        }, 60 * 60 * 1000);
        console.log('✅ Limpiador de sesiones iniciado');
        
    } catch (error) {
        console.error('❌ Error inicializando la aplicación:', error);
        process.exit(1);
    }
}

// Middleware de autenticación
const requireAuth = (req, res, next) => {
    const token = req.cookies?.sessionToken || req.headers['x-session-token'];
    
    if (!token || !auth.verifySession(token)) {
        console.log('🚫 Acceso denegado a ruta protegida:', req.path);
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
};

const requireGuest = (req, res, next) => {
    const token = req.cookies?.sessionToken || req.headers['x-session-token'];
    
    if (token && auth.verifySession(token)) {
        console.log('🔄 Usuario ya autenticado, redirigiendo a panel');
        return res.redirect('/');
    }
    next();
};

// Rutas públicas
app.get('/login', requireGuest, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/verify', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/verify.html'));
});

// Rutas protegidas
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Proteger todos los archivos estáticos excepto login y verify
app.use('/public', (req, res, next) => {
    if (req.path === '/login.html' || req.path === '/verify.html') {
        return next();
    }
    requireAuth(req, res, next);
});

// Ruta protegida para descargar ZIPs encriptados
app.get('/download/:filename', requireAuth, async (req, res) => {
    const { filename } = req.params;
    if (!filename.endsWith('.zip')) {
        return res.status(400).send('Solo se permiten archivos ZIP');
    }
    const filePath = path.join(process.env.DATA_FOLDER || './encrypted_data', filename);
    if (!await fs.pathExists(filePath)) {
        return res.status(404).send('Archivo no encontrado');
    }
    res.download(filePath);
});

// API pública para verificar que estás vivo
app.post('/api/verify', async (req, res) => {
    try {
        const { token } = req.body;
        const result = await verificationService.verifyAlive(token);
        res.json({ success: true, message: 'Verificación exitosa' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// API de autenticación
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Verificar credenciales (configuradas en .env)
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        
        console.log('🔐 Intento de login:', { 
            username, 
            expectedUsername: adminUsername,
            passwordProvided: !!password,
            expectedPassword: adminPassword 
        });
        
        if (username === adminUsername && password === adminPassword) {
            const token = auth.createSession(username);
            
            // Configurar cookie
            res.cookie('sessionToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000 // 24 horas
            });
            
            console.log('✅ Login exitoso para usuario:', username);
            res.json({ success: true, message: 'Login exitoso' });
        } else {
            console.log('❌ Login fallido para usuario:', username);
            res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }
    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    const token = req.cookies?.sessionToken;
    if (token) {
        auth.destroySession(token);
    }
    
    res.clearCookie('sessionToken');
    res.json({ success: true, message: 'Logout exitoso' });
});

// APIs protegidas
app.post('/api/encrypt', requireAuth, upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No se recibieron archivos' });
        }
        // Obtener paths temporales de los archivos subidos
        const filePaths = req.files.map(f => f.path);
        const result = await encryptionService.encryptFiles(filePaths);
        // Eliminar archivos temporales después de encriptar
        const fs = require('fs-extra');
        for (const file of filePaths) {
            await fs.remove(file);
        }
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.get('/api/status', requireAuth, async (req, res) => {
    try {
        const status = await verificationService.getStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/force-verification', requireAuth, async (req, res) => {
    try {
        await verificationService.forceVerification();
        res.json({ success: true, message: 'Verificación forzada enviada' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/reset-verification', requireAuth, async (req, res) => {
    try {
        await verificationService.resetVerification();
        res.json({ success: true, message: 'Estado reseteado correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API para cambiar modo testing
app.post('/api/toggle-testing', requireAuth, async (req, res) => {
    try {
        const { enabled, intervalMinutes } = req.body;
        const interval = Number(intervalMinutes);
        if (enabled && (!interval || interval < 1 || interval > 60)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Debes especificar un intervalo en minutos entre 1 y 60' 
            });
        }
        // Reiniciar el servicio de verificación con nueva configuración
        verificationService.stopPeriodicVerification();
        if (enabled) {
            process.env.VERIFICATION_INTERVAL_MINUTES = interval.toString();
            process.env.VERIFICATION_INTERVAL_DAYS = '0';
        } else {
            process.env.VERIFICATION_INTERVAL_MINUTES = '0';
            process.env.VERIFICATION_INTERVAL_DAYS = '7';
        }
        verificationService.startPeriodicVerification();
        res.json({ 
            success: true, 
            message: enabled ? 
                `Modo testing activado: verificaciones cada ${interval} minutos` : 
                'Modo producción activado: verificaciones diarias'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Ruta catch-all protegida: si no está autenticado, redirige a /login
app.get('*', (req, res) => {
    const token = req.cookies?.sessionToken || req.headers['x-session-token'];
    if (!token || !auth.verifySession(token)) {
        console.log('🚫 Acceso a URL no definida o protegida sin login:', req.path);
        return res.redirect('/login');
    }
    // Si está autenticado pero la ruta no existe, mostrar 404 o redirigir al panel
    res.redirect('/');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`📧 Verificaciones cada ${process.env.VERIFICATION_INTERVAL_DAYS || 7} días`);
    console.log(`🔐 Datos encriptados en: ${process.env.DATA_FOLDER || './encrypted_data'}`);
    console.log(`🔑 Credenciales configuradas:`);
    console.log(`   Usuario: ${process.env.ADMIN_USERNAME || 'admin'}`);
    console.log(`   Contraseña: ${process.env.ADMIN_PASSWORD || 'admin123'}`);
});

// Inicializar aplicación
initializeApp();

// Manejo de señales para cerrar limpiamente
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando aplicación...');
    verificationService.stopPeriodicVerification();
    await db.close();
    process.exit(0);
}); 