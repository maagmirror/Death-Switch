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

// Rutas públicas
app.get('/login', auth.requireGuest.bind(auth), (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/verify', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/verify.html'));
});

// Rutas protegidas
app.get('/', auth.requireAuth.bind(auth), (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
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
        
        if (username === adminUsername && auth.verifyPassword(password, auth.hashPassword(adminPassword))) {
            const token = auth.createSession(username);
            
            // Configurar cookie
            res.cookie('sessionToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000 // 24 horas
            });
            
            res.json({ success: true, message: 'Login exitoso' });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }
    } catch (error) {
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
app.post('/api/encrypt', auth.requireAuth.bind(auth), async (req, res) => {
    try {
        const { files } = req.body;
        const result = await encryptionService.encryptFiles(files);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.get('/api/status', auth.requireAuth.bind(auth), async (req, res) => {
    try {
        const status = await verificationService.getStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/force-verification', auth.requireAuth.bind(auth), async (req, res) => {
    try {
        await verificationService.forceVerification();
        res.json({ success: true, message: 'Verificación forzada enviada' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/reset-verification', auth.requireAuth.bind(auth), async (req, res) => {
    try {
        await verificationService.resetVerification();
        res.json({ success: true, message: 'Estado reseteado correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API para cambiar modo testing
app.post('/api/toggle-testing', auth.requireAuth.bind(auth), async (req, res) => {
    try {
        const { enabled, intervalMinutes } = req.body;
        
        if (enabled && (!intervalMinutes || intervalMinutes < 1)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Debes especificar un intervalo en minutos mayor a 0' 
            });
        }
        
        // Reiniciar el servicio de verificación con nueva configuración
        verificationService.stopPeriodicVerification();
        
        if (enabled) {
            process.env.VERIFICATION_INTERVAL_MINUTES = intervalMinutes.toString();
            process.env.VERIFICATION_INTERVAL_DAYS = '0';
        } else {
            process.env.VERIFICATION_INTERVAL_MINUTES = '0';
            process.env.VERIFICATION_INTERVAL_DAYS = '7';
        }
        
        verificationService.startPeriodicVerification();
        
        res.json({ 
            success: true, 
            message: enabled ? 
                `Modo testing activado: verificaciones cada ${intervalMinutes} minutos` : 
                'Modo producción activado: verificaciones diarias'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`📧 Verificaciones cada ${process.env.VERIFICATION_INTERVAL_DAYS || 7} días`);
    console.log(`🔐 Datos encriptados en: ${process.env.DATA_FOLDER || './encrypted_data'}`);
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