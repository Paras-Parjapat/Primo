const { Pool } = require('pg');
const products = require('./seed-products');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    for (const p of products) {
      const colors = (p.colors || []).map(c => ({ ...c, photos: Array.isArray(c.photos) ? c.photos.slice(0,3) : (p.img ? [p.img] : []) }));
      await pool.query(`
        INSERT INTO products (id,name,category,price,image_url,description,sizes,colors)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name,
          category=EXCLUDED.category,
          price=EXCLUDED.price,
          image_url=EXCLUDED.image_url,
          description=EXCLUDED.description,
          sizes=EXCLUDED.sizes,
          colors=EXCLUDED.colors,
          updated_at=NOW()
      `, [p.id,p.name,p.cat,p.price,p.img,p.desc,JSON.stringify(p.sizes||[]),JSON.stringify(colors)]);
    }
    console.log(`Seeded ${products.length} products.`);
  } finally {
    await pool.end();
  }
})().catch(err => { console.error(err); process.exit(1); });
