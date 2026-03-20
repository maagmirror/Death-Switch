const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function formatDateTimeEs(value) {
    if (value == null || value === '') {
        return '—';
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) {
        return String(value);
    }
    const tz = process.env.MAIL_TIMEZONE || 'America/Argentina/Buenos_Aires';
    return d.toLocaleString('es-ES', { timeZone: tz });
}

class EmailService {
    constructor() {
        this.transporter = null;
        this.templates = {};
    }

    mailFrom() {
        return (
            process.env.SMTP_FROM ||
            process.env.SMTP_USER ||
            'noreply@death-switch.local'
        );
    }

    async initialize() {
        const port = parseInt(process.env.SMTP_PORT, 10);
        const useAuth =
            process.env.SMTP_AUTH !== 'false' &&
            process.env.SMTP_AUTH !== '0' &&
            Boolean(process.env.SMTP_USER);

        const transport = {
            host: process.env.SMTP_HOST || 'localhost',
            port: Number.isFinite(port) && port > 0 ? port : 587,
            secure: process.env.SMTP_SECURE === 'true',
        };
        if (useAuth) {
            transport.auth = {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS || '',
            };
        }

        this.transporter = nodemailer.createTransport(transport);

        await this.transporter.verify();
        console.log(
            `📬 SMTP listo: ${transport.host}:${transport.port}${useAuth ? ' (con auth)' : ' (sin auth, típico MailHog)'}`
        );

        await this.loadTemplates();
    }

    logSendResult(info, to) {
        const mid = info && (info.messageId || info.messageID);
        console.log(
            `📧 Correo enviado → ${Array.isArray(to) ? to.join(', ') : to}${mid ? ` [${mid}]` : ''}`
        );
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
            <h2>🔐 Verificación de estado — Death Switch</h2>
        </div>
        
        <p>Hola,</p>
        
        <p>Este es un mensaje automático de tu sistema Death Switch para verificar que seguís activo.</p>
        
        <p><strong>Fecha de verificación:</strong> {{verificationDate}}</p>
        <p><strong>Próxima verificación programada (si confirmás ahora):</strong> {{nextVerificationDate}}</p>
        
        <p>Si estás leyendo este mensaje, confirmá que estás bien haciendo clic en el botón de abajo:</p>
        
        <a href="{{verificationUrl}}" class="button">✅ Confirmar que estoy bien</a>
        
        <p><strong>Importante:</strong> Si no confirmás tu estado en las próximas {{expirationHours}} horas, el sistema avisará a tus contactos de emergencia y les enviará un enlace (y si el tamaño lo permite, un adjunto) para descargar los documentos que hayas guardado.</p>
        
        <div class="footer">
            <p>Este es un mensaje automático del sistema Death Switch.</p>
            <p>Si el botón no funciona, copiá y pegá esta URL en el navegador: {{verificationUrl}}</p>
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
    <title>Notificación de emergencia</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
        .btn { display: inline-block; padding: 12px 20px; background: #c82333; color: white !important; text-decoration: none; border-radius: 5px; margin: 12px 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>⚠️ Mensaje automático — Death Switch</h2>
        </div>
        
        <p>Hola,</p>
        
        <p>El sistema no recibió confirmación de estado dentro del plazo previsto. Por eso se envía este mensaje a los contactos de emergencia que la persona había indicado.</p>
        
        <p><strong>Última verificación exitosa del titular:</strong> {{lastVerificationDate}}</p>
        <p><strong>Fecha de este aviso:</strong> {{notificationDate}}</p>
        
        <p><strong>Qué incluye el archivo</strong><br>
        Un ZIP con los documentos que esa persona había guardado en el sistema, en la carpeta <em>archivos</em>. No hace falta instalar programas raros: en Windows, Mac o muchos celulares alcanza con descargar el ZIP y abrirlo con un doble clic.</p>
        
        {{#if downloadLink}}
        <p><strong>Descargar el archivo</strong></p>
        <p><a class="btn" href="{{downloadLink}}">Descargar documentos (ZIP)</a></p>
        <p style="font-size:13px;color:#555;">Si el botón no funciona, copiá y pegá este enlace en el navegador:<br>{{downloadLink}}</p>
        {{/if}}
        
        {{#if hasZipAttachment}}
        <p>También te enviamos <strong>una copia del mismo archivo adjunta a este correo</strong> (si tu casilla lo permite).</p>
        {{/if}}
        
        <p>Dentro del ZIP hay un archivo <strong>LEEME.txt</strong> con instrucciones en lenguaje sencillo.</p>
        
        <div class="footer">
            <p>Mensaje automático del sistema Death Switch.</p>
            <p>No respondas a este correo si no tenés un contacto técnico; guardá el enlace y los archivos en un lugar seguro.</p>
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
        
        <p>En caso de que el propietario no responda a las verificaciones periódicas, recibirás un correo con un enlace para descargar los documentos que hubiera guardado.</p>
        
        <div class="footer">
            <p>Este es un mensaje automático del sistema Death Switch.</p>
        </div>
    </div>
</body>
</html>`;
    }

    async sendVerificationEmail(token, expiresAt) {
        const owner = process.env.OWNER_EMAIL;
        if (!owner || !String(owner).trim().includes('@')) {
            throw new Error(
                'OWNER_EMAIL no está definido o no es válido en .env (necesario para enviar la verificación).'
            );
        }

        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        const verificationUrl = `${baseUrl.replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}`;
        const verificationDate = formatDateTimeEs(new Date());

        const intervalMinutes = Number(process.env.VERIFICATION_INTERVAL_MINUTES) || 0;
        const intervalDays = Number(process.env.VERIFICATION_INTERVAL_DAYS) || 7;
        let nextMs;
        if (intervalMinutes > 0) {
            nextMs = intervalMinutes * 60 * 1000;
        } else {
            nextMs = intervalDays * 24 * 60 * 60 * 1000;
        }
        const nextVerificationDate = formatDateTimeEs(new Date(Date.now() + nextMs));

        const expirationHours = 24;

        const html = this.templates.verification({
            verificationDate,
            nextVerificationDate,
            verificationUrl,
            expirationHours
        });

        const mailOptions = {
            from: this.mailFrom(),
            to: owner.trim(),
            subject: '🔐 Verificación de estado — Death Switch',
            html: html
        };

        const info = await this.transporter.sendMail(mailOptions);
        this.logSendResult(info, mailOptions.to);
        return info;
    }

    async sendDeathNotification(contactEmail, lastVerificationDate, downloadLink = null, zipPath = null) {
        const notificationDate = formatDateTimeEs(new Date());
        const lastVerFormatted = formatDateTimeEs(lastVerificationDate);

        let hasZipAttachment = false;
        if (zipPath && await fs.pathExists(zipPath)) {
            const stats = await fs.stat(zipPath);
            const maxMb = Number(process.env.EMERGENCY_ZIP_MAX_ATTACH_MB);
            const maxBytes = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 12) * 1024 * 1024;
            hasZipAttachment = stats.size <= maxBytes;
        }

        const html = this.templates.death_notification({
            lastVerificationDate: lastVerFormatted,
            notificationDate,
            downloadLink,
            hasZipAttachment
        });

        const mailOptions = {
            from: this.mailFrom(),
            to: contactEmail,
            subject: '⚠️ Mensaje de emergencia — Death Switch',
            html: html,
            attachments: hasZipAttachment && zipPath
                ? [{ filename: path.basename(zipPath), path: path.resolve(zipPath) }]
                : []
        };

        const info = await this.transporter.sendMail(mailOptions);
        this.logSendResult(info, contactEmail);
        return info;
    }

    async sendContactInfoEmail(contactEmail) {
        const lastVerificationDate = formatDateTimeEs(new Date());

        const html = this.templates.contact_info({
            ownerEmail: process.env.OWNER_EMAIL,
            lastVerificationDate
        });

        const mailOptions = {
            from: this.mailFrom(),
            to: contactEmail,
            subject: '📋 Información de contacto — Death Switch',
            html: html
        };

        const info = await this.transporter.sendMail(mailOptions);
        this.logSendResult(info, contactEmail);
        return info;
    }

    async sendToAllContacts(template, data) {
        const contactEmails = (process.env.CONTACT_EMAILS || '')
            .split(',')
            .map((email) => email.trim())
            .filter(Boolean);
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
            from: this.mailFrom(),
            to: to,
            subject: data.subject || 'Death Switch Notification',
            html: html
        };

        return await this.transporter.sendMail(mailOptions);
    }
}

module.exports = EmailService; 