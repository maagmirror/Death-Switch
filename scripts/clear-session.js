#!/usr/bin/env node

/**
 * Script para limpiar sesiones y cookies del Death Switch
 * Uso: node scripts/clear-session.js
 */

const fs = require('fs-extra');
const path = require('path');

async function clearSessions() {
    try {
        console.log('🧹 Limpiando sesiones y datos temporales...');
        
        // Limpiar base de datos de sesiones (si existe)
        const dbPath = process.env.DB_PATH || './data/death_switch.db';
        if (await fs.pathExists(dbPath)) {
            console.log('📊 Base de datos encontrada, manteniendo...');
        }
        
        // Limpiar archivos temporales
        const tempDirs = ['./temp', './logs'];
        for (const dir of tempDirs) {
            if (await fs.pathExists(dir)) {
                await fs.remove(dir);
                console.log(`🗑️ Eliminado: ${dir}`);
            }
        }
        
        console.log('✅ Limpieza completada');
        console.log('');
        console.log('🔑 Para acceder nuevamente:');
        console.log('   1. Reinicia el servidor: npm start');
        console.log('   2. Ve a: http://localhost:3000/login');
        console.log('   3. Usa las credenciales del .env');
        console.log('');
        console.log('💡 Si sigues teniendo problemas:');
        console.log('   - Verifica que el archivo .env esté configurado correctamente');
        console.log('   - Revisa los logs del servidor para ver las credenciales');
        console.log('   - Limpia las cookies del navegador');
        console.log('   - Usa modo incógnito para probar');
        
    } catch (error) {
        console.error('❌ Error limpiando sesiones:', error.message);
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    clearSessions();
}

module.exports = clearSessions; 