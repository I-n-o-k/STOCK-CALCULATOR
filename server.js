// server.js - Express + Socket.IO + PostgreSQL for multi-user & realtime

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Pool } = require('pg'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server); // Inisialisasi Socket.IO
const PORT = process.env.PORT || 3000;

// === Database setup (PostgreSQL Pool) ===
// Render secara otomatis menyediakan URL koneksi ke DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Opsi SSL ini penting untuk koneksi yang aman di Render/cloud
  ssl: {
    rejectUnauthorized: false
  }
});

// Fungsi untuk memastikan tabel ada
async function initializeDb() {
    const client = await pool.connect();
    try {
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
        console.log('Database table "stocks" initialized or already exists (PostgreSQL).');
    } catch (err) {
        console.error('Error initializing database:', err.message);
        // Menjaga aplikasi tetap berjalan bahkan jika inisialisasi gagal (misalnya, DB down)
    } finally {
        client.release();
    }
}
initializeDb();


// === Middleware ===
app.use(express.static(path.join(__dirname))); 
app.use(express.json()); // Middleware untuk parsing JSON body


// === API Endpoints ===

// [GET] Mengambil semua data stok dari DB
app.get('/api/stocks', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM stocks ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Fetch all stocks error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// [POST] Memperbarui atau Menyimpan (UPSERT) satu item stok
// Endpoint ini dipanggil saat user mengubah salah satu kolom stok fisik
app.post('/api/stocks', express.json(), async (req, res) => {
  // Data yang dikirim dari client (script.js:sendRowUpdate)
  const { name, provider, quota, validity, atas, bawah, belakang, komputer, total_fisik } = req.body;
  
  if (!name) {
      return res.status(400).json({ error: 'Field "name" is required' });
  }

  try {
    // Gunakan UPSERT (INSERT OR UPDATE) berdasarkan 'name' sebagai PRIMARY KEY
    const sql = `
      INSERT INTO stocks (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        atas = $5, 
        bawah = $6, 
        belakang = $7, 
        komputer = $8, 
        total_fisik = $9, 
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;`; // Mengambil data baris yang baru saja di-update
    
    const result = await pool.query(sql, [name, provider || '', validity || '', quota || '', atas, bawah, belakang, komputer, total_fisik]);
    
    const updatedRow = result.rows[0];
    
    // ⭐ KEY REALTIME: Emit pembaruan ke semua klien yang terhubung
    // Klien akan mendengarkan event 'stock_update' dan memperbarui UI mereka
    io.emit('stock_update', updatedRow); 
    console.log(`Realtime update emitted for: ${updatedRow.name}`);
    
    res.json({ ok: true, data: updatedRow });
  } catch (err) {
    console.error('Single update (UPSERT) error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// [POST] Bulk upsert stocks (untuk inisialisasi atau update massal)
app.post('/api/stocks/bulk', express.json(), async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Body should be a non-empty array of stock items.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // Mulai transaksi

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
    
    // Loop melalui setiap item dan jalankan query dengan parameter
    for (const item of items) {
      if (!item || !item.name) continue;
      const {
        name, provider = '', validity = '', quota = '',
        atas = 0, bawah = 0, belakang = 0, komputer = 0, total_fisik = 0
      } = item;

      await client.query(sql, [name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik]);
    }

    await client.query('COMMIT'); // Commit transaksi jika berhasil
    
    // io.emit('stocks_bulk_update', { count: items.length }); 
    // Untuk bulk update, kita tidak perlu emit setiap item. 
    // Cukup minta client untuk refresh data (loadServerStocks) jika diperlukan.
    // Tapi untuk kasus 'realtime single update' sudah diatasi di endpoint POST /api/stocks.
    
    res.json({ ok: true, count: items.length });

  } catch (err) {
    await client.query('ROLLBACK'); // Rollback jika ada error
    console.error('Bulk update transaction failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release(); // Lepaskan client kembali ke pool
  }
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