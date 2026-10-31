const express = require('express'), crypto = require('crypto'), path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(express.json({ limit: '5mb' }));

const { ADMIN_PASSWORD = 'admin123', WHATSAPP = '919999999999', FIREBASE_SERVICE_ACCOUNT } = process.env;
const SECRET = process.env.SECRET || ADMIN_PASSWORD + '-kaif';

// ---------- Firebase ----------
if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error('FIREBASE_SERVICE_ACCOUNT env variable set karo (service account JSON)');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)) });
const col = admin.firestore().collection('products');

// Firestore doc -> same shape jo Mongo deta tha (_id), taaki frontend na badle
const out = d => ({ _id: d.id, ...d.data() });

// Sirf allowed fields save hon
const clean = b => {
  const o = {};
  ['name', 'category', 'description', 'image'].forEach(k => { if (b[k] !== undefined) o[k] = String(b[k]); });
  ['price', 'oldPrice'].forEach(k => { if (b[k] !== undefined && b[k] !== '') o[k] = Number(b[k]); });
  if (b.inStock !== undefined) o.inStock = !!b.inStock;
  return o;
};

// ---------- Auth (same as before) ----------
const hmac = t => crypto.createHmac('sha256', SECRET).update(String(t)).digest('hex');
const sign = () => { const t = Date.now() + 7 * 864e5; return t + '.' + hmac(t); };
const ok = t => { if (!t) return false; const [a, b] = t.split('.'); return +a > Date.now() && b === hmac(a); };
const auth = (q, r, n) => ok(q.headers['x-token']) ? n() : r.status(401).json({ error: 'Pehle login karo' });
const wrap = f => (q, r) => f(q, r).catch(e => r.status(500).json({ error: e.message }));

// ---------- Routes ----------
app.get('/api/config', (q, r) => r.json({ whatsapp: WHATSAPP }));

app.post('/api/login', (q, r) =>
  q.body.password === ADMIN_PASSWORD ? r.json({ token: sign() }) : r.status(401).json({ error: 'Galat password' }));

app.get('/api/products', wrap(async (q, r) => {
  const s = await col.orderBy('createdAt', 'desc').get();
  r.json(s.docs.map(out));
}));

app.post('/api/products', auth, wrap(async (q, r) => {
  const data = { inStock: true, ...clean(q.body), createdAt: Date.now(), updatedAt: Date.now() };
  const ref = await col.add(data);
  r.json(out(await ref.get()));
}));

app.put('/api/products/:id', auth, wrap(async (q, r) => {
  const ref = col.doc(q.params.id);
  await ref.update({ ...clean(q.body), updatedAt: Date.now() });
  r.json(out(await ref.get()));
}));

app.delete('/api/products/:id', auth, wrap(async (q, r) => {
  await col.doc(q.params.id).delete();
  r.json({ ok: 1 });
}));

app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public/admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Starter products (sirf pehli baar, jab collection khali ho) ----------
const D = {
  "Back Cover": ["Silicone Soft Back Cover|199|349", "Transparent Shockproof Cover|149|299", "Matte Hard Back Cover|179|299", "Premium Leather Look Cover|249|449"],
  "Tempered Glass": ["9H Tempered Glass|99|199", "Full Cover 11D Glass|129|249", "Privacy Anti-Spy Glass|179|299"],
  "Charger": ["33W Fast Charger|349|599", "20W Type-C Adapter|249|449", "Car Charger Dual USB|199|349"],
  "Cable": ["Type-C Fast Cable 1m|99|199", "Lightning Cable 1m|149|299", "Micro USB Cable|79|149"],
  "Neckband": ["Bass Wireless Neckband|599|1199", "Sports Neckband 30hr Battery|799|1499"],
  "Earbuds": ["TWS Bluetooth Earbuds|699|1499", "Wired Earphones with Mic|129|299"],
  "Power Bank": ["10000mAh Power Bank|799|1299", "20000mAh Fast Power Bank|1299|2199"],
  "Other Accessories": ["Mobile Stand Holder|129|249", "Selfie Ring Light|249|499"]
};

const seed = async () => {
  if (!(await col.limit(1).get()).empty) return;
  const batch = admin.firestore().batch();
  let i = 0;
  for (const [category, arr] of Object.entries(D)) {
    for (const t of arr) {
      const [name, price, oldPrice] = t.split('|');
      batch.set(col.doc(), {
        name, category, price: +price, oldPrice: +oldPrice, inStock: true,
        description: 'Best quality ' + name + '. Sab models available – WhatsApp pe model batayein.',
        createdAt: Date.now() - i++, updatedAt: Date.now()
      });
    }
  }
  await batch.commit();
};

seed()
  .then(() => app.listen(process.env.PORT || 3000, () => console.log('Running')))
  .catch(e => { console.error(e); process.exit(1); });