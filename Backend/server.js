require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required');
if (!process.env.ADMIN_PASSWORD_HASH) throw new Error('ADMIN_PASSWORD_HASH is required');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '30mb' }));

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
if (allowedOrigins.length) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.sendStatus(204);
    }
    next();
  });
}

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 12
  }
}));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

function normalizeColor(c, fallbackImg='') {
  return {
    n: String(c?.n || 'Color').trim(),
    h: /^#[0-9a-f]{6}$/i.test(String(c?.h || '')) ? c.h : '#ffffff',
    photos: Array.isArray(c?.photos) ? c.photos.filter(Boolean).slice(0, 3) : (fallbackImg ? [fallbackImg] : [])
  };
}
function normalizeProductInput(body) {
  const id = Number(body.id);
  const name = String(body.name || '').trim();
  const category = String(body.cat || body.category || '').trim();
  const price = Number(body.price);
  const description = String(body.desc || body.description || '').trim();
  const sizes = Array.isArray(body.sizes) ? body.sizes.map(String).map(s => s.trim()).filter(Boolean) : [];
  const colors = Array.isArray(body.colors) ? body.colors.map(c => normalizeColor(c, body.img || body.image_url || '')) : [];
  const imageUrl = String(body.img || body.image_url || colors[0]?.photos?.[0] || '').trim();
  if (!Number.isInteger(id) || id < 1) throw new Error('Product ID must be a positive integer');
  if (!name || !category || !description || !sizes.length || !colors.length) throw new Error('Incomplete product information');
  if (!Number.isFinite(price) || price < 0) throw new Error('Invalid price');
  return { id, name, category, price, imageUrl, description, sizes, colors };
}
function mapProduct(r) {
  return { id: r.id, name: r.name, cat: r.category, price: Number(r.price), img: r.image_url || '', desc: r.description || '', sizes: r.sizes || [], colors: r.colors || [] };
}
function mapOrder(r) {
  return { id: r.id, date: r.created_at, customer: { name: r.customer_name, acc: r.account_name, phone: r.phone, addr: r.address }, items: r.items || [], total: Number(r.total), status: r.status };
}
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: 'Admin authentication required' });
}

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get('/api/products', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(rows.map(mapProduct));
  } catch (e) { next(e); }
});

app.post('/api/admin/login', async (req, res, next) => {
  try {
    const password = String(req.body?.password || '');
    const ok = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });
    req.session.isAdmin = true;
    return res.json({ authenticated: true });
  } catch (e) { next(e); }
});
app.post('/api/admin/logout', (req, res, next) => req.session.destroy(err => err ? next(err) : res.json({ ok: true })));
app.get('/api/admin/me', (req, res) => res.json({ authenticated: !!req.session?.isAdmin }));

app.get('/api/orders/history', async (req, res, next) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    const search = String(req.query.search || '').trim().toUpperCase();
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone number' });
    const { rows } = await pool.query('SELECT * FROM orders WHERE phone = $1 ORDER BY created_at DESC', [phone]);
    let orders = rows.map(mapOrder);
    if (search) orders = orders.filter(o => o.id.toUpperCase() === search || o.items.some(i => String(i.productId ?? i.id) === search));
    res.json(orders);
  } catch (e) { next(e); }
});

app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id.toUpperCase()]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(mapOrder(rows[0]));
  } catch (e) { next(e); }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const c = req.body?.customer || {};
    const phone = String(c.phone || '').replace(/\D/g, '');
    const items = Array.isArray(req.body?.items) ? req.body.items.map(i => ({
      productId: Number(i.productId ?? i.id), id: Number(i.id), name: String(i.name || ''), img: String(i.img || ''),
      price: Number(i.price), size: String(i.size || ''), color: String(i.color || ''), qty: Math.max(1, Number(i.qty) || 1)
    })) : [];
    const total = Number(req.body?.total);
    if (!String(c.name||'').trim() || !String(c.acc||'').trim() || !/^[6-9]\d{9}$/.test(phone) || !String(c.addr||'').trim() || !items.length || !Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'Invalid order data' });
    }
    const id = `LUM-${Math.random().toString(36).substring(2,8).toUpperCase()}${Date.now().toString(36).slice(-2).toUpperCase()}`;
    const { rows } = await pool.query(`
      INSERT INTO orders (id, customer_name, account_name, phone, address, items, total, status)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'pending') RETURNING *
    `, [id, String(c.name).trim(), String(c.acc).trim(), phone, String(c.addr).trim(), JSON.stringify(items), total]);
    res.status(201).json(mapOrder(rows[0]));
  } catch (e) { next(e); }
});

app.get('/api/admin/orders', requireAdmin, async (req, res, next) => {
  try { const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC'); res.json(rows.map(mapOrder)); }
  catch (e) { next(e); }
});
app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (!['pending','approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id.toUpperCase()]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(mapOrder(rows[0]));
  } catch (e) { next(e); }
});
app.delete('/api/admin/orders/:id', requireAdmin, async (req, res, next) => {
  try { const result = await pool.query('DELETE FROM orders WHERE id=$1', [req.params.id.toUpperCase()]); if (!result.rowCount) return res.status(404).json({ error:'Order not found' }); res.json({ ok:true }); }
  catch (e) { next(e); }
});

app.post('/api/admin/products', requireAdmin, async (req, res, next) => {
  try {
    const p = normalizeProductInput(req.body);
    const { rows } = await pool.query(`INSERT INTO products (id,name,category,price,image_url,description,sizes,colors) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING *`, [p.id,p.name,p.category,p.price,p.imageUrl,p.description,JSON.stringify(p.sizes),JSON.stringify(p.colors)]);
    res.status(201).json(mapProduct(rows[0]));
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error:'Product ID already exists' }); next(e); }
});
app.put('/api/admin/products/:id', requireAdmin, async (req, res, next) => {
  try {
    const p = normalizeProductInput({ ...req.body, id: Number(req.params.id) });
    if (p.id !== Number(req.params.id)) return res.status(400).json({ error:'Product ID cannot be changed after creation' });
    const { rows } = await pool.query(`UPDATE products SET name=$1,category=$2,price=$3,image_url=$4,description=$5,sizes=$6::jsonb,colors=$7::jsonb,updated_at=NOW() WHERE id=$8 RETURNING *`, [p.name,p.category,p.price,p.imageUrl,p.description,JSON.stringify(p.sizes),JSON.stringify(p.colors),p.id]);
    if (!rows[0]) return res.status(404).json({ error:'Product not found' });
    res.json(mapProduct(rows[0]));
  } catch (e) { next(e); }
});
app.delete('/api/admin/products/:id', requireAdmin, async (req, res, next) => {
  try { const result = await pool.query('DELETE FROM products WHERE id=$1', [Number(req.params.id)]); if (!result.rowCount) return res.status(404).json({error:'Product not found'}); res.json({ok:true}); }
  catch (e) { next(e); }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => console.log(`LUMIÈRE backend listening on ${PORT}`));
