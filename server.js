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

// === Database setup (single SQLite file) ===
const dbPath = path.join(__dirname, 'stocks.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS stocks (
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
  )`);
});

app.use(express.json());

// Serve static files (index.html, style.css, script.js, data.xml, etc)
app.use(express.static(__dirname));

// === REST APIs ===

// Get all stocks (for initial hydration)
app.get('/api/stocks', (req, res) => {
  db.all('SELECT * FROM stocks', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Upsert a single row
app.post('/api/stocks', (req, res) => {
  const {
    name, provider = '', validity = '', quota = '',
    atas = 0, bawah = 0, belakang = 0, komputer = 0, total_fisik = 0
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name is required' });

  const sql = `INSERT INTO stocks
    (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
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
      updated_at=CURRENT_TIMESTAMP`;

  const params = [name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik];

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    const payload = { name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik };
    io.emit('stock_update', payload); // broadcast to all clients
    res.json({ ok: true, row: payload });
  });
});

// Upsert many rows at once
app.post('/api/stocks/bulk', (req, res) => {
  const body = req.body;
  let items = [];

  if (Array.isArray(body)) {
    items = body;
  } else if (body && typeof body === 'object') {
    // format: { "name": { atas, bawah, ... }, ... }
    items = Object.keys(body).map((name) => ({ name, ...(body[name] || {}) }));
  }

  if (!items.length) return res.json({ ok: true, count: 0 });

  const sql = `INSERT INTO stocks
    (name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik, updated_at)
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
      updated_at=CURRENT_TIMESTAMP`;

  db.serialize(() => {
    const stmt = db.prepare(sql);
    for (const item of items) {
      if (!item || !item.name) continue;
      const {
        name, provider = '', validity = '', quota = '',
        atas = 0, bawah = 0, belakang = 0, komputer = 0, total_fisik = 0
      } = item;
      stmt.run([name, provider, validity, quota, atas, bawah, belakang, komputer, total_fisik]);
    }
    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('stocks_bulk_update', { count: items.length });
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

server.listen(PORT, () => {
  console.log(`\nServer realtime berjalan di http://localhost:${PORT}\n`);
  console.log('Buka di banyak browser/tab untuk uji multi-user + realtime.');
});