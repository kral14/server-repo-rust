const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Verilənlər bazası bağlantısı
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database.');
        // İstifadəçi cədvəlini yaradırıq
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )`);
    }
});

// API status endpointi (Versiya 1.5.0)
app.get('/api/status', (req, res) => {
    res.json({ 
        status: "OK", 
        version: "1.5.0", 
        message: "MasterDeploy Test API Uğurla İşləyir (Dashboard & SQLite Dəstəyi)!" 
    });
});

// Qeydiyyat API-si
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "İstifadəçi adı və şifrə daxil edilməlidir!" });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const query = `INSERT INTO users (username, password) VALUES (?, ?)`;
    
    db.run(query, [username, hashedPassword], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed")) {
                return res.status(400).json({ error: "Bu istifadəçi adı artıq mövcuddur!" });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: "Qeydiyyat uğurla tamamlandı!", userId: this.lastID });
    });
});

// Login API-si
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "İstifadəçi adı və şifrə daxil edilməlidir!" });
    }

    const query = `SELECT * FROM users WHERE username = ?`;
    db.get(query, [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            return res.status(400).json({ error: "İstifadəçi adı və ya şifrə səhvdir!" });
        }

        const passwordIsValid = bcrypt.compareSync(password, user.password);
        if (!passwordIsValid) {
            return res.status(400).json({ error: "İstifadəçi adı və ya şifrə səhvdir!" });
        }

        res.json({ success: true, message: "Giriş uğurludur!", username: user.username });
    });
});

// Dashboard Məlumat API-si
app.get('/api/dashboard-data', (req, res) => {
    // Bazadakı ümumi istifadəçi sayını öyrənirik
    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({
            userCount: row ? row.count : 0,
            systemTime: new Date().toLocaleTimeString('az-AZ'),
            uptime: Math.floor(process.uptime()) + " saniyə",
            dbSize: "Yüngül (SQLite)"
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
