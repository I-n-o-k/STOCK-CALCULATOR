// server.js - Express + Socket.IO + PostgreSQL for multi-user & realtime

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg'); // Import Pool dari 'pg'

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// === Database setup (PostgreSQL Pool) ===
// Render secara otomatis menggunakan DATABASE_URL dari Environment Variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Opsi SSL ini penting untuk koneksi yang aman di Render/cloud
  ssl: {
    rejectUnauthorized: false
  }
});

// Fungsi untuk memastikan tabel ada
async function initializeDb() {
    try {
        const client = await pool.connect();
        await client.query(`
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
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        client.release();
        console.log('Database table "stocks" initialized or already exists (PostgreSQL).');
    } catch (err) {
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error('Error connecting to Database or initializing table. Check DATABASE_URL in Render environment.');
        console.error('Detail Error:', err.message);
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    }
}
initializeDb();

app.use(express.json());
// Serve static files (index.html, style.css, script.js, data.xml, etc)
app.use(express.static(__dirname));

// === REST APIs ===

// Get all stocks (for initial hydration)
app.get('/api/stocks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stocks');
    res.json(result.rows || []);
  } catch (err) {
    console.error('Error fetching stocks:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint untuk pembaruan stok tunggal (Memicu Real-time Update)
app.post('/api/stocks/update', express.json(), async (req, res) => {
  const { name, atas, bawah, belakang, komputer, total_fisik } = req.body;
  try {
    const sql = `
      UPDATE stocks SET 
        atas = $1, 
        bawah = $2, 
        belakang = $3, 
        komputer = $4, 
        total_fisik = $5, 
        updated_at = CURRENT_TIMESTAMP 
      WHERE name = $6 
      RETURNING *;`;
    
    const result = await pool.query(sql, [atas, bawah, belakang, komputer, total_fisik, name]);
    
    if (result.rowCount === 0) {
      // Jika item tidak ditemukan, coba INSERT (karena mungkin item baru)
      const { provider, validity, quota } = req.body;
      const insertSql = `
        INSERT INTO stocks (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        RETURNING *;`;
      
      const insertResult = await pool.query(insertSql, [name, provider || '', validity || '', quota || '', atas, bawah, belakang, komputer, total_fisik]);
      
      if (insertResult.rowCount === 0) {
          return res.status(500).json({ error: 'Item not found and failed to insert.' });
      }
      
      const updatedRow = insertResult.rows[0];
      io.emit('stock_update', updatedRow); // Emit pembaruan realtime
      return res.json({ ok: true, data: updatedRow });
    }

    const updatedRow = result.rows[0];
    io.emit('stock_update', updatedRow); // <-- INI YANG MEMICU SINKRONISASI
    res.json({ ok: true, data: updatedRow });
  } catch (err) {
    console.error('Single update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Bulk upsert stocks (for initial XML load & manual entry)
app.post('/api/stocks/bulk', express.json(), async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Data items must be a non-empty array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sql = `
      INSERT INTO stocks (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        provider=EXCLUDED.provider,
        validity=EXCLUDED.validity,
        quota=EXCLUDED.quota,
        atas=EXCLUDED.atas,
        bawah=EXCLUDED.bawah,
        belakang=EXCLUDED.belakang,
        komputer=EXCLUDED.komputer,
        total_fisik=EXCLUDED.total_fisik,
        updated_at=CURRENT_TIMESTAMP
    `;
    
    for (const item of items) {
      if (!item || !item.name) continue;
      const {
        name, provider = '', validity = '', quota = '',
        atas = 0, bawah = 0, belakang = 0, komputer = 0, total_fisik = 0
      } = item;

      await client.query(sql, [name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik]);
    }

    await client.query('COMMIT'); 
    
    // Tidak perlu emit sinyal di bulk update, karena ini hanya digunakan untuk sinkronisasi awal
    res.json({ ok: true, count: items.length });

  } catch (err) {
    await client.query('ROLLBACK'); 
    console.error('Bulk update transaction failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// === Socket.IO ===
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  // Tambahkan logika lain jika diperlukan saat koneksi
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// === SERVER LISTEN ===
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
