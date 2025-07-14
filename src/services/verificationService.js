const cron = require('cron');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');

class VerificationService {
    constructor(database, emailService) {
        this.db = database;
        this.emailService = emailService;
        this.verificationJob = null;
        this.checkInterval = null;
    }

    startPeriodicVerification() {
        const intervalMinutes = process.env.VERIFICATION_INTERVAL_MINUTES || 0;
        const intervalDays = process.env.VERIFICATION_INTERVAL_DAYS || 7;
        
        if (intervalMinutes > 0) {
            // Modo testing: verificaciones cada X minutos
            const cronExpression = `*/${intervalMinutes} * * * *`;
            this.verificationJob = new cron.CronJob(cronExpression, async () => {
                await this.performVerification();
            }, null, true, 'America/Argentina/Buenos_Aires');
            
            console.log(`🕐 Verificación periódica programada cada ${intervalMinutes} minutos (MODO TESTING)`);
        } else {
            // Modo producción: verificar cada día a las 9:00 AM
            this.verificationJob = new cron.CronJob('0 9 * * *', async () => {
                await this.performVerification();
            }, null, true, 'America/Argentina/Buenos_Aires');
            
            console.log('🕐 Verificación periódica programada diariamente a las 9:00 AM');
        }

        // Verificar cada 5 minutos si hay verificaciones pendientes (más frecuente para testing)
        const checkIntervalMinutes = intervalMinutes > 0 ? 1 : 60; // 1 minuto en testing, 1 hora en producción
        this.checkInterval = setInterval(async () => {
            await this.checkPendingVerifications();
        }, checkIntervalMinutes * 60 * 1000);

        console.log(`🔍 Verificación de estado pendiente cada ${checkIntervalMinutes} minutos`);
    }

    stopPeriodicVerification() {
        if (this.verificationJob) {
            this.verificationJob.stop();
        }
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }

    async performVerification() {
        try {
            const status = await this.db.getVerificationStatus();
            
            if (!status) {
                console.log('❌ No se encontró estado de verificación');
                return;
            }

            const now = new Date();
            const nextVerification = new Date(status.next_verification);

            // Si es momento de verificar
            if (now >= nextVerification) {
                console.log('📧 Enviando verificación...');
                await this.sendVerification();
            } else {
                console.log(`⏰ Próxima verificación: ${nextVerification.toLocaleString()}`);
            }
        } catch (error) {
            console.error('❌ Error en verificación periódica:', error);
        }
    }

    async checkPendingVerifications() {
        try {
            const status = await this.db.getVerificationStatus();
            if (!status) {
                return;
            }
            // Log extra para debug
            const intervalMinutes = Number(process.env.VERIFICATION_INTERVAL_MINUTES) || 0;
            const lastVerification = new Date(status.last_verification);
            const now = new Date();
            let minutesSinceLastVerification = (now - lastVerification) / (1000 * 60);
            console.log(`[DEBUG] is_alive: ${status.is_alive}, minutos desde última verificación: ${minutesSinceLastVerification.toFixed(2)}`);
            if (status.is_alive) {
                return;
            }
            // En testing, esperar solo 1 minuto; en producción, 24 horas
            if ((intervalMinutes > 0 && minutesSinceLastVerification >= 1) || (intervalMinutes === 0 && minutesSinceLastVerification >= 24 * 60)) {
                console.log('⚠️ No se recibió verificación en el tiempo esperado, enviando notificaciones...');
                await this.handleDeathScenario();
            }
        } catch (error) {
            console.error('❌ Error verificando estado pendiente:', error);
        }
    }

    async sendVerification() {
        try {
            // Generar token único
            const token = uuidv4();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

            // Guardar token en base de datos
            await this.db.saveVerificationToken(token, expiresAt.toISOString());

            // Enviar email de verificación
            await this.emailService.sendVerificationEmail(token, expiresAt);

            // Marcar como no verificado
            await this.db.updateVerificationStatus(false);

            console.log('✅ Email de verificación enviado');
        } catch (error) {
            console.error('❌ Error enviando verificación:', error);
        }
    }

    async verifyAlive(token) {
        try {
            // Verificar y usar token
            const tokenValid = await this.db.useVerificationToken(token);
            
            if (!tokenValid) {
                throw new Error('Token inválido o expirado');
            }

            // Actualizar estado como vivo
            await this.db.updateVerificationStatus(true);

            console.log('✅ Verificación exitosa - Usuario confirmado vivo');

            const intervalMinutes = process.env.VERIFICATION_INTERVAL_MINUTES || 0;
            const intervalDays = process.env.VERIFICATION_INTERVAL_DAYS || 7;
            
            let nextVerification;
            if (intervalMinutes > 0) {
                nextVerification = new Date(Date.now() + intervalMinutes * 60 * 1000);
            } else {
                nextVerification = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
            }
            
            return {
                success: true,
                message: 'Verificación exitosa',
                nextVerification: nextVerification
            };
        } catch (error) {
            console.error('❌ Error en verificación:', error);
            throw error;
        }
    }

    async handleDeathScenario() {
        try {
            console.log('💀 Escenario de muerte detectado, preparando datos...');

            // Crear archivo ZIP con datos encriptados
            const zipPath = await this.createEncryptedDataZip();
            const zipName = require('path').basename(zipPath);
            const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
            const downloadLink = `${baseUrl}/download/${encodeURIComponent(zipName)}`;

            // Enviar notificaciones a todos los contactos
            const contactEmails = process.env.CONTACT_EMAILS.split(',').map(email => email.trim());
            const status = await this.db.getVerificationStatus();

            for (const email of contactEmails) {
                try {
                    await this.emailService.sendDeathNotification(email, status.last_verification, downloadLink);
                    console.log(`📧 Notificación enviada a: ${email}`);
                } catch (error) {
                    console.error(`❌ Error enviando notificación a ${email}:`, error);
                }
            }

            // También enviar email con archivo adjunto (si es posible)
            await this.sendEncryptedDataToContacts(zipPath);

            console.log('✅ Notificaciones de muerte enviadas');
        } catch (error) {
            console.error('❌ Error manejando escenario de muerte:', error);
        }
    }

    async createEncryptedDataZip() {
        const dataFolder = process.env.DATA_FOLDER || './encrypted_data';
        const zipPath = path.join(dataFolder, `encrypted_data_${Date.now()}.zip`);

        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            output.on('close', () => {
                console.log(`📦 Archivo ZIP creado: ${zipPath}`);
                resolve(zipPath);
            });

            archive.on('error', (err) => {
                reject(err);
            });

            archive.pipe(output);

            // Agregar archivo README con instrucciones
            const readmeContent = this.generateReadmeContent();
            archive.append(readmeContent, { name: 'README.txt' });

            // Agregar todos los archivos encriptados
            archive.directory(dataFolder, false, (data) => {
                // Excluir el propio archivo ZIP
                if (data.name.endsWith('.zip')) return false;
                return data;
            });

            archive.finalize();
        });
    }

    generateReadmeContent() {
        return `DEATH SWITCH - DATOS ENCRIPTADOS
=====================================

Este archivo contiene los datos encriptados del propietario del sistema Death Switch.

INSTRUCCIONES PARA DESENCRIPTAR:
1. Asegúrate de tener la clave de desencriptación que se te envió por email
2. Usa un software de desencriptación compatible con AES-256
3. Todos los archivos están encriptados con la misma clave

CLAVE DE DESENCRIPTACIÓN:
${process.env.DECRYPTION_KEY}

NOTA IMPORTANTE:
- Solo usa estos datos si el propietario ha fallecido
- Mantén la confidencialidad de estos datos
- Contacta a otros contactos de emergencia si es necesario

Fecha de creación: ${new Date().toLocaleString('es-ES')}
Sistema: Death Switch v1.0`;
    }

    async sendEncryptedDataToContacts(zipPath) {
        // Nota: En una implementación real, aquí se enviaría el archivo ZIP
        // como adjunto por email o se subiría a un servicio de almacenamiento
        console.log(`📎 Archivo ZIP listo para envío: ${zipPath}`);
        console.log('💡 En una implementación completa, aquí se enviaría el archivo a los contactos');
    }

    async getStatus() {
        try {
            const status = await this.db.getVerificationStatus();
            const encryptedFiles = await this.db.getEncryptedFiles();
            
            const intervalMinutes = process.env.VERIFICATION_INTERVAL_MINUTES || 0;
            const intervalDays = process.env.VERIFICATION_INTERVAL_DAYS || 7;
            
            return {
                isAlive: status ? status.is_alive : true,
                lastVerification: status ? status.last_verification : null,
                nextVerification: status ? status.next_verification : null,
                verificationCount: status ? status.verification_count : 0,
                encryptedFilesCount: encryptedFiles.length,
                verificationIntervalDays: intervalMinutes > 0 ? intervalMinutes : intervalDays,
                isTestingMode: intervalMinutes > 0
            };
        } catch (error) {
            console.error('❌ Error obteniendo estado:', error);
            throw error;
        }
    }

    async forceVerification() {
        console.log('🔄 Forzando verificación...');
        await this.sendVerification();
    }

    async resetVerification() {
        console.log('🔄 Reseteando verificación...');
        await this.db.updateVerificationStatus(true);
    }
}

module.exports = VerificationService; 