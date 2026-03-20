const cron = require('cron');
const crypto = require('crypto');
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
      this.verificationJob = new cron.CronJob(
        cronExpression,
        async () => {
          await this.performVerification();
        },
        null,
        true,
        'America/Argentina/Buenos_Aires',
      );

      console.log(
        `🕐 Verificación periódica programada cada ${intervalMinutes} minutos (MODO TESTING)`,
      );
    } else {
      // Producción: revisar cada hora si ya tocaba enviar (antes solo 9:00 y se perdían ventanas)
      const cronExpr = process.env.VERIFICATION_CRON || '0 * * * *';
      this.verificationJob = new cron.CronJob(
        cronExpr,
        async () => {
          await this.performVerification();
        },
        null,
        true,
        'America/Argentina/Buenos_Aires',
      );

      console.log(
        `🕐 Comprobación de “¿toca mail de verificación?”: cron "${cronExpr}" (${process.env.VERIFICATION_CRON ? 'VERIFICATION_CRON' : 'defecto: cada hora'})`,
      );
    }

    // Verificar cada 5 minutos si hay verificaciones pendientes (más frecuente para testing)
    const checkIntervalMinutes = intervalMinutes > 0 ? 1 : 60; // 1 minuto en testing, 1 hora en producción
    this.checkInterval = setInterval(
      async () => {
        await this.checkPendingVerifications();
      },
      checkIntervalMinutes * 60 * 1000,
    );

    console.log(
      `🔍 Verificación de estado pendiente cada ${checkIntervalMinutes} minutos`,
    );
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
      if (await this.db.isDead()) {
        return;
      }
      await this.db.alignNextVerificationForTestMode();

      const status = await this.db.getVerificationStatus();

      if (!status) {
        console.log('❌ No se encontró estado de verificación');
        return;
      }

      const now = new Date();
      const nextVerification = new Date(status.next_verification);

      // Si es momento de verificar
      if (now >= nextVerification) {
        console.log(
          '📧 Toca enviar mail de verificación (next_verification ya pasó)...',
        );
        await this.sendVerification();
      } else {
        if (process.env.VERBOSE_VERIFICATION_LOG === 'true') {
          console.log(
            `⏳ No envío mail todavía. Próxima verificación: ${nextVerification.toLocaleString('es-AR')}`,
          );
        }
      }
    } catch (error) {
      console.error('❌ Error en verificación periódica:', error);
    }
  }

  async checkPendingVerifications() {
    try {
      if (await this.db.isDead()) {
        // Ya se notificó muerte, no hacer nada
        return;
      }
      const status = await this.db.getVerificationStatus();
      if (!status) {
        return;
      }
      // Log extra para debug
      const intervalMinutes =
        Number(process.env.VERIFICATION_INTERVAL_MINUTES) || 0;
      const lastVerification = new Date(status.last_verification);
      const now = new Date();
      let minutesSinceLastVerification = (now - lastVerification) / (1000 * 60);
      console.log(
        `[DEBUG] is_alive: ${
          status.is_alive
        }, minutos desde última verificación: ${minutesSinceLastVerification.toFixed(
          2,
        )}`,
      );
      if (status.is_alive) {
        return;
      }
      // En testing, esperar solo 1 minuto; en producción, 24 horas
      if (
        (intervalMinutes > 0 && minutesSinceLastVerification >= 1) ||
        (intervalMinutes === 0 && minutesSinceLastVerification >= 24 * 60)
      ) {
        console.log(
          '⚠️ No se recibió verificación en el tiempo esperado, enviando notificaciones...',
        );
        await this.handleDeathScenario();
        await this.db.markAsDead();
      }
    } catch (error) {
      console.error('❌ Error verificando estado pendiente:', error);
    }
  }

  async sendVerification() {
    if (await this.db.isDead()) {
      throw new Error(
        'No se puede enviar: el protocolo de emergencia ya se activó (estado muerto). Usá "Revivir" si fue un ensayo.',
      );
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.db.saveVerificationToken(token, expiresAt.toISOString());
    await this.emailService.sendVerificationEmail(token, expiresAt);
    await this.db.updateVerificationStatus(false);

    console.log('✅ Email de verificación enviado');
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
        nextVerification = new Date(
          Date.now() + intervalDays * 24 * 60 * 60 * 1000,
        );
      }

      return {
        success: true,
        message: 'Verificación exitosa',
        nextVerification: nextVerification,
      };
    } catch (error) {
      console.error('❌ Error en verificación:', error);
      throw error;
    }
  }

  async handleDeathScenario() {
    try {
      console.log('💀 Escenario de muerte detectado, preparando datos...');

      const zipPath = await this.createEmergencyDataZip();
      const zipName = path.basename(zipPath);
      const token = crypto.randomBytes(32).toString('hex');
      const expiryDays =
        Number(process.env.EMERGENCY_DOWNLOAD_EXPIRY_DAYS) || 90;
      const expiresAt = new Date(
        Date.now() + expiryDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      await this.db.saveEmergencyDownloadToken(token, zipName, expiresAt);

      const baseUrl =
        process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const downloadLink = `${baseUrl}/emergency/download/${token}`;

      const contactEmails = (process.env.CONTACT_EMAILS || '')
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);
      if (contactEmails.length === 0) {
        console.error(
          '❌ CONTACT_EMAILS no está definido o está vacío: no se puede notificar a contactos',
        );
        return;
      }
      const status = await this.db.getVerificationStatus();

      for (const email of contactEmails) {
        try {
          await this.emailService.sendDeathNotification(
            email,
            status.last_verification,
            downloadLink,
            zipPath,
          );
          console.log(`📧 Notificación enviada a: ${email}`);
        } catch (error) {
          console.error(`❌ Error enviando notificación a ${email}:`, error);
        }
      }

      console.log('✅ Notificaciones de muerte enviadas');
    } catch (error) {
      console.error('❌ Error manejando escenario de muerte:', error);
    }
  }

  /**
   * ZIP para contactos: copias en claro (carpeta archivos/) listas para abrir
   * sin software especial. Los .encrypted en el servidor siguen existiendo como respaldo.
   */
  async createEmergencyDataZip() {
    const originalFolder = './original_files';
    await fs.ensureDir(originalFolder);
    const dataFolder = process.env.DATA_FOLDER || './encrypted_data';
    await fs.ensureDir(dataFolder);
    const zipPath = path.join(dataFolder, `death_data_${Date.now()}.zip`);
    const readmeContent = this.generateReadmeContent();

    const entries = await fs.readdir(originalFolder);
    const fileNames = [];
    for (const name of entries) {
      const full = path.join(originalFolder, name);
      if ((await fs.stat(full)).isFile()) {
        fileNames.push(name);
      }
    }

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

      archive.append(readmeContent, { name: 'LEEME.txt' });

      for (const name of fileNames) {
        archive.file(path.join(originalFolder, name), {
          name: `archivos/${name}`,
        });
      }

      archive.finalize();
    });
  }

  generateReadmeContent() {
    return `DEATH SWITCH — INSTRUCCIONES PARA CONTACTOS
===============================================

Este archivo ZIP está pensado para que puedas abrirlo sin conocimientos técnicos.

PASOS SIMPLES
1. Descargá el ZIP desde el enlace del correo (o usá la copia adjunta si vino con el mensaje).
2. Hacé doble clic en el archivo ZIP: en Windows, Mac o celular suele abrirse solo.
3. Dentro verás la carpeta "archivos": ahí están los documentos tal como los guardó la persona.

No hace falta instalar programas especiales ni contraseñas adicionales para abrir esos archivos.

IMPORTANTE
- Usá esta información solo en las circunstancias previstas por la persona (por ejemplo, si ya no puede confirmar que está bien).
- Tratá estos datos con confidencialidad.
- Si la carpeta "archivos" está vacía, es posible que no se hubieran subido documentos al sistema.

(El servidor también guarda copias cifradas por seguridad; para recuperarlas hace falta la clave técnica del sistema y la herramienta scripts/decrypt.js del proyecto.)

Fecha: ${new Date().toLocaleString('es-ES')}
Death Switch`;
  }

  async getStatus() {
    try {
      const status = await this.db.getVerificationStatus();
      const encryptedFiles = await this.db.getEncryptedFiles();

      const intervalMinutes = process.env.VERIFICATION_INTERVAL_MINUTES || 0;
      const intervalDays = process.env.VERIFICATION_INTERVAL_DAYS || 7;

      return {
        isAlive: status ? status.is_alive : true,
        /** true si ya se disparó el protocolo (contactos notificados); bloquea nuevos mails hasta revivir */
        emergencyActivated: status ? status.is_dead === 1 : false,
        lastVerification: status ? status.last_verification : null,
        nextVerification: status ? status.next_verification : null,
        verificationCount: status ? status.verification_count : 0,
        encryptedFilesCount: encryptedFiles.length,
        verificationIntervalDays:
          intervalMinutes > 0 ? intervalMinutes : intervalDays,
        isTestingMode: intervalMinutes > 0,
      };
    } catch (error) {
      console.error('❌ Error obteniendo estado:', error);
      throw error;
    }
  }

  async forceVerification() {
    console.log('🔄 Forzando verificación (envío de correo)...');
    await this.sendVerification();
  }

  async resetVerification() {
    console.log('🔄 Reseteando verificación...');
    await this.db.updateVerificationStatus(true);
  }

  async reviveUser() {
    // Permite revivir al usuario (por ejemplo, para pruebas o si fue un falso positivo)
    await this.db.revive();
    await this.db.updateVerificationStatus(true);
  }
}

module.exports = VerificationService;
