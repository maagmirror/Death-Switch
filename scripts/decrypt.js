#!/usr/bin/env node

/**
 * Script de utilidad para desencriptar archivos del Death Switch
 * Uso: node scripts/decrypt.js <archivo_encriptado> <clave_desencriptacion>
 */

const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

class DecryptionUtility {
    constructor() {
        this.algorithm = 'aes-256-cbc';
    }

    // Generar clave derivada de la contraseña
    generateKey(password) {
        return crypto.scryptSync(password, 'salt', 32);
    }

    // Desencriptar un archivo
    async decryptFile(inputPath, outputPath, key) {
        try {
            const derivedKey = this.generateKey(key);
            
            const input = fs.createReadStream(inputPath);
            const output = fs.createWriteStream(outputPath);
            
            // Leer IV del inicio del archivo
            const iv = input.read(16);
            const decipher = crypto.createDecipher(this.algorithm, derivedKey);
            
            input.pipe(decipher).pipe(output);
            
            return new Promise((resolve, reject) => {
                output.on('finish', () => {
                    resolve({
                        decryptedPath: outputPath,
                        size: fs.statSync(outputPath).size
                    });
                });
                
                output.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Error desencriptando archivo: ${error.message}`);
        }
    }

    // Desencriptar múltiples archivos
    async decryptFiles(inputDir, outputDir, key) {
        await fs.ensureDir(outputDir);
        
        const files = await fs.readdir(inputDir);
        const encryptedFiles = files.filter(file => file.endsWith('.encrypted'));
        
        console.log(`🔍 Encontrados ${encryptedFiles.length} archivos encriptados`);
        
        for (const file of encryptedFiles) {
            try {
                const inputPath = path.join(inputDir, file);
                const outputFileName = file.replace('.encrypted', '');
                const outputPath = path.join(outputDir, outputFileName);
                
                console.log(`🔓 Desencriptando: ${file}`);
                await this.decryptFile(inputPath, outputPath, key);
                console.log(`✅ Desencriptado: ${outputFileName}`);
            } catch (error) {
                console.error(`❌ Error desencriptando ${file}:`, error.message);
            }
        }
    }

    // Verificar integridad de un archivo
    async verifyFile(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return {
                exists: true,
                size: stats.size,
                isFile: stats.isFile()
            };
        } catch (error) {
            return {
                exists: false,
                error: error.message
            };
        }
    }
}

// Función principal
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log(`
🔐 Death Switch - Utilidad de Desencriptación

Uso: node scripts/decrypt.js <archivo_o_directorio> <clave_desencriptacion>

Ejemplos:
  node scripts/decrypt.js archivo.txt.encrypted mi_clave_secreta
  node scripts/decrypt.js ./encrypted_data mi_clave_secreta

Opciones:
  --output <directorio>  Directorio de salida para archivos desencriptados
  --verify               Solo verificar archivos sin desencriptar
        `);
        process.exit(1);
    }

    const inputPath = args[0];
    const key = args[1];
    const outputDir = args.includes('--output') ? args[args.indexOf('--output') + 1] : './decrypted';
    const verifyOnly = args.includes('--verify');

    const decrypter = new DecryptionUtility();

    try {
        // Verificar que el archivo/directorio existe
        const inputStats = await fs.stat(inputPath);
        
        if (inputStats.isFile()) {
            // Desencriptar un archivo individual
            if (verifyOnly) {
                const verification = await decrypter.verifyFile(inputPath);
                console.log('📋 Verificación del archivo:');
                console.log(verification);
            } else {
                const outputPath = path.join(outputDir, path.basename(inputPath).replace('.encrypted', ''));
                await fs.ensureDir(path.dirname(outputPath));
                
                console.log(`🔓 Desencriptando archivo: ${inputPath}`);
                const result = await decrypter.decryptFile(inputPath, outputPath, key);
                console.log(`✅ Archivo desencriptado: ${result.decryptedPath}`);
                console.log(`📊 Tamaño: ${result.size} bytes`);
            }
        } else if (inputStats.isDirectory()) {
            // Desencriptar todos los archivos en el directorio
            if (verifyOnly) {
                const files = await fs.readdir(inputPath);
                const encryptedFiles = files.filter(file => file.endsWith('.encrypted'));
                
                console.log(`📋 Verificando ${encryptedFiles.length} archivos encriptados:`);
                
                for (const file of encryptedFiles) {
                    const filePath = path.join(inputPath, file);
                    const verification = await decrypter.verifyFile(filePath);
                    console.log(`  ${file}: ${verification.exists ? '✅' : '❌'} ${verification.size || 0} bytes`);
                }
            } else {
                console.log(`🔓 Desencriptando directorio: ${inputPath}`);
                await decrypter.decryptFiles(inputPath, outputDir, key);
                console.log(`✅ Archivos desencriptados en: ${outputDir}`);
            }
        } else {
            throw new Error('La ruta especificada no es un archivo ni un directorio válido');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    main();
}

module.exports = DecryptionUtility; 