// server.js - Express + Socket.IO + SQLite3 for multi-user & realtime

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server); 
const PORT = process.env.PORT || 3000;

// === Database setup (SQLite3) ===
// File database akan dibuat secara otomatis dengan nama 'stocks.db' di direktori akar
const dbPath = path.resolve(__dirname, 'stocks.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Gagal membuka database SQLite:', err.message);
    } else {
        console.log('Terhubung ke database SQLite.');
    }
});

// Fungsi untuk memastikan tabel ada (Sintaks SQLite)
function initializeDb() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS stocks (
                name TEXT PRIMARY KEY,
                provider TEXT,
                validity TEXT,
                quota TEXT,
                atas INTEGER DEFAULT 0,
                bawah INTEGER DEFAULT 0,
                belakang INTEGER DEFAULT 0,
                komputer INTEGER DEFAULT 0,
                total_fisik INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) console.error('Error initializing table:', err.message);
            else console.log('Database table "stocks" initialized (SQLite).');
        });
    });
}
initializeDb();

// === Middleware ===
app.use(express.static(path.join(__dirname))); 
app.use(express.json()); 

// === API Endpoints ===

// [GET] Mengambil semua data stok
app.get('/api/stocks', (req, res) => {
    const sql = 'SELECT * FROM stocks ORDER BY name';
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Fetch error:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// [POST] Memperbarui atau Menyimpan (UPSERT) satu item stok
app.post('/api/stocks', (req, res) => {
    const { name, provider, quota, validity, atas, bawah, belakang, komputer, total_fisik } = req.body;
    
    if (!name) return res.status(400).json({ error: 'Field "name" is required' });

    // SQLite menggunakan "INSERT OR REPLACE" untuk fungsi UPSERT sederhana
    const sql = `
        INSERT INTO stocks (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
            atas = excluded.atas,
            bawah = excluded.bawah,
            belakang = excluded.belakang,
            komputer = excluded.komputer,
            total_fisik = excluded.total_fisik,
            updated_at = CURRENT_TIMESTAMP
    `;

    const params = [name, provider || '', validity || '', quota || '', atas, bawah, belakang, komputer, total_fisik];

    db.run(sql, params, function(err) {
        if (err) {
            console.error('Update error:', err.message);
            return res.status(500).json({ error: err.message });
        }

        // Ambil data yang baru diupdate untuk dikirim via Socket.IO
        db.get('SELECT * FROM stocks WHERE name = ?', [name], (err, row) => {
            if (!err && row) {
                io.emit('stock_update', row); // Real-time emit
                res.json({ ok: true, data: row });
            }
        });
    });
});

// [POST] Bulk upsert stocks
app.post('/api/stocks/bulk', (req, res) => {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Body should be an array.' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const sql = `
            INSERT INTO stocks (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
                provider=excluded.provider,
                validity=excluded.validity,
                quota=excluded.quota,
                atas=excluded.atas,
                bawah=excluded.bawah,
                belakang=excluded.belakang,
                komputer=excluded.komputer,
                total_fisik=excluded.total_fisik,
                updated_at=CURRENT_TIMESTAMP
        `;

        const stmt = db.prepare(sql);
        items.forEach(item => {
            stmt.run([
                item.name, item.provider || '', item.validity || '', item.quota || '',
                item.atas || 0, item.bawah || 0, item.belakang || 0, item.komputer || 0, item.total_fisik || 0
            ]);
        });
        stmt.finalize();
        
        db.run("COMMIT", (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ok: true, count: items.length });
        });
    });
});

// === Socket.IO ===
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// === Server Listen ===
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
