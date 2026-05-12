import { supabase }               from '../utils/supabase.js';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';

const ME_BASE = process.env.ME_SANDBOX === '1'
  ? 'https://sandbox.melhorenvio.com.br/api/v2'
  : 'https://melhorenvio.com.br/api/v2';

const ME_CONTACT = process.env.ME_CONTACT_EMAIL || 'contato@arquivo90.com.br';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const ip      = getClientIp(req);
  const allowed = await rateLimit(`shipping:${ip}`, 30, 60);
  if (!allowed) { res.status(429).json({ error: 'Muitas requisições' }); return; }

  const { cep, items } = req.body || {};
  const cleanCep = String(cep || '').replace(/\D/g, '');

  if (cleanCep.length !== 8) {
    res.status(400).json({ error: 'CEP inválido' }); return;
  }
  if (!Array.isArray(items) || !items.length) {
    res.status(400).json({ error: 'Itens obrigatórios' }); return;
  }

  // If ME not configured, signal fallback to flat rate
  const originCep = String(process.env.ME_ORIGIN_CEP || '').replace(/\D/g, '');
  if (!originCep || originCep.length !== 8 || !process.env.ME_TOKEN) {
    res.json({ options: null, fallback: true }); return;
  }

  // Fetch product weights from DB
  const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
  const { data: products } = await supabase
    .from('products').select('id, price, peso_g').in('id', productIds);
  const productMap = Object.fromEntries((products || []).map(p => [p.id, p]));

  // Consolidate package dimensions
  let totalWeightKg = 0;
  let totalValue    = 0;
  let totalQty      = 0;
  for (const item of items) {
    const p   = productMap[item.product_id];
    const qty = item.quantity || 1;
    totalWeightKg += ((p?.peso_g || 300) / 1000) * qty;
    totalValue    += ((p?.price  || 0)   / 100)  * qty;
    totalQty      += qty;
  }

  const meBody = {
    from: { postal_code: originCep },
    to:   { postal_code: cleanCep  },
    products: [{
      id:               '1',
      width:            30,
      height:           Math.min(5 * totalQty, 30), // camisetas empilhadas
      length:           40,
      weight:           +totalWeightKg.toFixed(3),
      insurance_value:  +totalValue.toFixed(2),
      quantity:         1
    }]
  };

  try {
    const r = await fetch(`${ME_BASE}/me/shipment/calculate`, {
      method:  'POST',
      headers: {
        'Accept':        'application/json',
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.ME_TOKEN}`,
        'User-Agent':    `Arquivo90 (${ME_CONTACT})`
      },
      body: JSON.stringify(meBody)
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`ME calculate ${r.status}:`, errText);
      res.json({ options: null, fallback: true }); return;
    }

    const data = await r.json();
    const options = (Array.isArray(data) ? data : [])
      .filter(s => !s.error && s.price)
      .map(s => ({
        id:            s.id,
        name:          s.name,
        company:       s.company?.name  || '',
        company_id:    s.company?.id    ?? null,
        price_cents:   Math.round(parseFloat(s.price) * 100),
        delivery_time: s.delivery_time  ?? null,
        delivery_min:  s.delivery_range?.min ?? null,
        delivery_max:  s.delivery_range?.max ?? null
      }))
      .sort((a, b) => a.price_cents - b.price_cents);

    res.setHeader('Cache-Control', 'no-store');
    res.json({ options });
  } catch (err) {
    console.error('ME shipping error:', err.message);
    res.json({ options: null, fallback: true });
  }
}
