const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.key = process.env.DECRYPTION_KEY || 'default-key-change-this';
  }

  // Generar clave derivada de la contraseña
  generateKey(password) {
    return crypto.scryptSync(password, 'salt', 32);
  }

  // Encriptar un archivo
  async encryptFile(inputPath, outputPath) {
    try {
      const key = this.generateKey(this.key);
      const iv = crypto.randomBytes(16);

      const input = fs.createReadStream(inputPath);
      const output = fs.createWriteStream(outputPath);
      const cipher = crypto.createCipher(this.algorithm, key);

      // Escribir IV al inicio del archivo
      output.write(iv);

      input.pipe(cipher).pipe(output);

      return new Promise((resolve, reject) => {
        output.on('finish', () => {
          resolve({
            originalPath: inputPath,
            encryptedPath: outputPath,
            originalSize: fs.statSync(inputPath).size,
            encryptedSize: fs.statSync(outputPath).size,
            checksum: this.calculateChecksum(inputPath),
          });
        });

        output.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Error encriptando archivo: ${error.message}`);
    }
  }

  // Desencriptar un archivo
  async decryptFile(inputPath, outputPath) {
    try {
      const key = this.generateKey(this.key);

      const input = fs.createReadStream(inputPath);
      const output = fs.createWriteStream(outputPath);

      // Leer IV del inicio del archivo
      const iv = input.read(16);
      const decipher = crypto.createDecipher(this.algorithm, key);

      input.pipe(decipher).pipe(output);

      return new Promise((resolve, reject) => {
        output.on('finish', () => {
          resolve({
            decryptedPath: outputPath,
            size: fs.statSync(outputPath).size,
          });
        });

        output.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Error desencriptando archivo: ${error.message}`);
    }
  }

  // Encriptar múltiples archivos (cada elemento: ruta string o { path, originalname })
  async encryptFiles(fileEntries, dbInstance) {
    const dataFolder = process.env.DATA_FOLDER || './encrypted_data';
    await fs.ensureDir(dataFolder);

    const results = [];

    for (const entry of fileEntries) {
      const filePath = typeof entry === 'string' ? entry : entry.path;
      const fileName = path.basename(
        typeof entry === 'string'
          ? filePath
          : entry.originalname || filePath
      );
      try {
        const encryptedFileName = `${fileName}.encrypted`;
        const encryptedPath = path.join(dataFolder, encryptedFileName);

        const result = await this.encryptFile(filePath, encryptedPath);
        if (dbInstance) {
          await dbInstance.saveEncryptedFile(
            fileName,
            encryptedPath,
            result.originalSize,
            result.encryptedSize,
            result.checksum
          );
        }
        results.push(result);

        console.log(`✅ Archivo encriptado: ${fileName}`);
      } catch (error) {
        console.error(`❌ Error encriptando ${filePath}:`, error);
        results.push({
          originalPath: filePath,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Encriptar un directorio completo
  async encryptDirectory(directoryPath) {
    const dataFolder = process.env.DATA_FOLDER || './encrypted_data';
    await fs.ensureDir(dataFolder);

    const files = await this.getAllFiles(directoryPath);
    const results = [];

    for (const file of files) {
      try {
        const relativePath = path.relative(directoryPath, file);
        const encryptedFileName = `${relativePath.replace(
          /[\/\\]/g,
          '_'
        )}.encrypted`;
        const encryptedPath = path.join(dataFolder, encryptedFileName);

        const result = await this.encryptFile(file, encryptedPath);
        results.push(result);

        console.log(`✅ Archivo encriptado: ${relativePath}`);
      } catch (error) {
        console.error(`❌ Error encriptando ${file}:`, error);
        results.push({
          originalPath: file,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Obtener todos los archivos de un directorio recursivamente
  async getAllFiles(dirPath) {
    const files = [];

    const items = await fs.readdir(dirPath);

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        const subFiles = await this.getAllFiles(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  // Calcular checksum de un archivo
  calculateChecksum(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  // Verificar integridad de un archivo encriptado
  async verifyEncryptedFile(encryptedPath, originalChecksum) {
    try {
      const tempPath = path.join(
        process.env.DATA_FOLDER || './encrypted_data',
        'temp_verify'
      );
      await this.decryptFile(encryptedPath, tempPath);

      const decryptedChecksum = this.calculateChecksum(tempPath);
      await fs.remove(tempPath);

      return decryptedChecksum === originalChecksum;
    } catch (error) {
      return false;
    }
  }

  // Encriptar texto
  encryptText(text) {
    const key = this.generateKey(this.key);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, key);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
  }

  // Desencriptar texto
  decryptText(encryptedText) {
    const key = this.generateKey(this.key);
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = crypto.createDecipher(this.algorithm, key);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // Generar clave aleatoria
  generateRandomKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Cambiar clave de encriptación
  async changeEncryptionKey(newKey, dataFolder) {
    const files = await this.getAllFiles(dataFolder);

    for (const file of files) {
      if (file.endsWith('.encrypted')) {
        const tempPath = file + '.temp';
        const originalPath = file.replace('.encrypted', '');

        // Desencriptar con clave antigua
        await this.decryptFile(file, tempPath);

        // Cambiar clave
        const oldKey = this.key;
        this.key = newKey;

        // Encriptar con nueva clave
        await this.encryptFile(tempPath, file);

        // Limpiar archivo temporal
        await fs.remove(tempPath);

        console.log(`✅ Clave cambiada para: ${path.basename(file)}`);
      }
    }
  }
}

module.exports = EncryptionService;
