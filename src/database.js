const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.dbPath = process.env.DB_PATH || './data/death_switch.db';
        this.db = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.createTables()
                    .then(resolve)
                    .catch(reject);
            });
        });
    }

    async createTables() {
        const queries = [
            `CREATE TABLE IF NOT EXISTS verification_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                last_verification DATETIME DEFAULT CURRENT_TIMESTAMP,
                next_verification DATETIME,
                is_alive BOOLEAN DEFAULT 1,
                verification_count INTEGER DEFAULT 0
            )`,
            
            `CREATE TABLE IF NOT EXISTS encrypted_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                encrypted_path TEXT NOT NULL,
                original_size INTEGER,
                encrypted_size INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                checksum TEXT
            )`,
            
            `CREATE TABLE IF NOT EXISTS verification_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                expires_at DATETIME NOT NULL,
                used BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const query of queries) {
            await this.run(query);
        }
        
        // Insertar registro inicial si no existe
        const intervalMinutes = process.env.VERIFICATION_INTERVAL_MINUTES || 0;
        const intervalDays = process.env.VERIFICATION_INTERVAL_DAYS || 7;
        
        let timeExpression;
        if (intervalMinutes > 0) {
            timeExpression = `+${intervalMinutes} minutes`;
        } else {
            timeExpression = `+${intervalDays} days`;
        }
        
        await this.run(`
            INSERT OR IGNORE INTO verification_status (id, last_verification, next_verification, is_alive, verification_count)
            VALUES (1, CURRENT_TIMESTAMP, datetime('now', '${timeExpression}'), 1, 0)
        `);
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getVerificationStatus() {
        return await this.get('SELECT * FROM verification_status WHERE id = 1');
    }

    async updateVerificationStatus(isAlive = true) {
        const intervalMinutes = process.env.VERIFICATION_INTERVAL_MINUTES || 0;
        const intervalDays = process.env.VERIFICATION_INTERVAL_DAYS || 7;
        
        let timeExpression;
        if (intervalMinutes > 0) {
            timeExpression = `+${intervalMinutes} minutes`;
        } else {
            timeExpression = `+${intervalDays} days`;
        }
        
        await this.run(`
            UPDATE verification_status 
            SET last_verification = CURRENT_TIMESTAMP,
                next_verification = datetime('now', '${timeExpression}'),
                is_alive = ?,
                verification_count = verification_count + 1
            WHERE id = 1
        `, [isAlive ? 1 : 0]);
    }

    async saveVerificationToken(token, expiresAt) {
        await this.run(`
            INSERT INTO verification_tokens (token, expires_at)
            VALUES (?, ?)
        `, [token, expiresAt]);
    }

    async useVerificationToken(token) {
        const result = await this.run(`
            UPDATE verification_tokens 
            SET used = 1 
            WHERE token = ? AND used = 0 AND expires_at > CURRENT_TIMESTAMP
        `, [token]);
        
        return result.changes > 0;
    }

    async saveEncryptedFile(filename, encryptedPath, originalSize, encryptedSize, checksum) {
        return await this.run(`
            INSERT INTO encrypted_files (filename, encrypted_path, original_size, encrypted_size, checksum)
            VALUES (?, ?, ?, ?, ?)
        `, [filename, encryptedPath, originalSize, encryptedSize, checksum]);
    }

    async getEncryptedFiles() {
        return await this.all('SELECT * FROM encrypted_files ORDER BY created_at DESC');
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close(resolve);
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database; 