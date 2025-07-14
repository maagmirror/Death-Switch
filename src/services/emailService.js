const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class EmailService {
    constructor() {
        this.transporter = null;
        this.templates = {};
    }

    async initialize() {
        // Configurar transporter
        this.transporter = nodemailer.createTransporter({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        // Verificar conexión
        await this.transporter.verify();
        
        // Cargar templates
        await this.loadTemplates();
    }

    async loadTemplates() {
        const templatesDir = path.join(__dirname, '../../templates');
        await fs.ensureDir(templatesDir);

        // Crear templates por defecto si no existen
        const defaultTemplates = {
            'verification.hbs': this.getDefaultVerificationTemplate(),
            'death_notification.hbs': this.getDefaultDeathNotificationTemplate(),
            'contact_info.hbs': this.getDefaultContactInfoTemplate()
        };

        for (const [filename, content] of Object.entries(defaultTemplates)) {
            const filepath = path.join(templatesDir, filename);
            if (!await fs.pathExists(filepath)) {
                await fs.writeFile(filepath, content);
            }
            const templateContent = await fs.readFile(filepath, 'utf8');
            this.templates[filename.replace('.hbs', '')] = handlebars.compile(templateContent);
        }
    }

    getDefaultVerificationTemplate() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Verificación de Estado</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>🔐 Verificación de Estado - Death Switch</h2>
        </div>
        
        <p>Hola,</p>
        
        <p>Este es un mensaje automático de tu sistema Death Switch para verificar que sigues activo.</p>
        
        <p><strong>Fecha de verificación:</strong> {{verificationDate}}</p>
        <p><strong>Próxima verificación:</strong> {{nextVerificationDate}}</p>
        
        <p>Si estás leyendo este mensaje, por favor confirma que sigues vivo haciendo clic en el botón de abajo:</p>
        
        <a href="{{verificationUrl}}" class="button">✅ Confirmar que estoy vivo</a>
        
        <p><strong>Importante:</strong> Si no confirmas tu estado en los próximos {{expirationHours}} horas, el sistema asumirá que has fallecido y enviará los datos encriptados a tus contactos de emergencia.</p>
        
        <div class="footer">
            <p>Este es un mensaje automático del sistema Death Switch.</p>
            <p>Si tienes problemas con el enlace, copia y pega esta URL en tu navegador: {{verificationUrl}}</p>
        </div>
    </div>
</body>
</html>`;
    }

    getDefaultDeathNotificationTemplate() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Notificación de Fallecimiento</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>⚠️ Notificación de Fallecimiento</h2>
        </div>
        
        <p>Estimado/a,</p>
        
        <p>Lamentamos informarle que el propietario del sistema Death Switch no ha respondido a las verificaciones periódicas de estado.</p>
        
        <p><strong>Última verificación exitosa:</strong> {{lastVerificationDate}}</p>
        <p><strong>Fecha de la notificación:</strong> {{notificationDate}}</p>
        
        <p>Como contacto de emergencia designado, se le ha enviado un archivo ZIP con los datos encriptados del propietario.</p>
        
        <p><strong>Clave de desencriptación:</strong> {{decryptionKey}}</p>
        
        <p>Por favor, siga las instrucciones incluidas en el archivo ZIP para acceder a los datos.</p>
        
        <div class="footer">
            <p>Este es un mensaje automático del sistema Death Switch.</p>
            <p>Si tiene alguna pregunta, contacte al administrador del sistema.</p>
        </div>
    </div>
</body>
</html>`;
    }

    getDefaultContactInfoTemplate() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Información de Contacto</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #28a745; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .info-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>📋 Información de Contacto</h2>
        </div>
        
        <p>Hola,</p>
        
        <p>Has sido designado como contacto de emergencia en el sistema Death Switch.</p>
        
        <div class="info-box">
            <h3>Información del Propietario:</h3>
            <p><strong>Email:</strong> {{ownerEmail}}</p>
            <p><strong>Última verificación:</strong> {{lastVerificationDate}}</p>
        </div>
        
        <p>En caso de que el propietario no responda a las verificaciones periódicas, recibirás una notificación con los datos encriptados.</p>
        
        <div class="footer">
            <p>Este es un mensaje automático del sistema Death Switch.</p>
        </div>
    </div>
</body>
</html>`;
    }

    async sendVerificationEmail(token, expiresAt) {
        const verificationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/verify?token=${token}`;
        const verificationDate = new Date().toLocaleString('es-ES');
        const nextVerificationDate = new Date(Date.now() + (process.env.VERIFICATION_INTERVAL_DAYS || 7) * 24 * 60 * 60 * 1000).toLocaleString('es-ES');
        const expirationHours = 24;

        const html = this.templates.verification({
            verificationDate,
            nextVerificationDate,
            verificationUrl,
            expirationHours
        });

        const mailOptions = {
            from: process.env.SMTP_USER,
            to: process.env.OWNER_EMAIL,
            subject: '🔐 Verificación de Estado - Death Switch',
            html: html
        };

        return await this.transporter.sendMail(mailOptions);
    }

    async sendDeathNotification(contactEmail, lastVerificationDate) {
        const notificationDate = new Date().toLocaleString('es-ES');
        const decryptionKey = process.env.DECRYPTION_KEY;

        const html = this.templates.death_notification({
            lastVerificationDate,
            notificationDate,
            decryptionKey
        });

        const mailOptions = {
            from: process.env.SMTP_USER,
            to: contactEmail,
            subject: '⚠️ Notificación de Fallecimiento - Death Switch',
            html: html
        };

        return await this.transporter.sendMail(mailOptions);
    }

    async sendContactInfoEmail(contactEmail) {
        const lastVerificationDate = new Date().toLocaleString('es-ES');

        const html = this.templates.contact_info({
            ownerEmail: process.env.OWNER_EMAIL,
            lastVerificationDate
        });

        const mailOptions = {
            from: process.env.SMTP_USER,
            to: contactEmail,
            subject: '📋 Información de Contacto - Death Switch',
            html: html
        };

        return await this.transporter.sendMail(mailOptions);
    }

    async sendToAllContacts(template, data) {
        const contactEmails = process.env.CONTACT_EMAILS.split(',').map(email => email.trim());
        const results = [];

        for (const email of contactEmails) {
            try {
                const result = await this.sendEmail(email, template, data);
                results.push({ email, success: true, result });
            } catch (error) {
                results.push({ email, success: false, error: error.message });
            }
        }

        return results;
    }

    async sendEmail(to, template, data) {
        const html = this.templates[template](data);
        
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: to,
            subject: data.subject || 'Death Switch Notification',
            html: html
        };

        return await this.transporter.sendMail(mailOptions);
    }
}

module.exports = EmailService; 