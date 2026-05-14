import { supabase }               from '../utils/supabase.js';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const ip      = getClientIp(req);
  const allowed = await rateLimit(`lead:${ip}`, 10, 300);
  if (!allowed) { res.status(429).end(); return; }

  const { email, name, cart } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email inválido' }); return; }

  const cleanEmail = email.toLowerCase().trim();
  const cleanName  = name?.trim().slice(0, 100) || null;
  const cleanCart  = Array.isArray(cart) && cart.length > 0 ? cart : null;

  // Upsert — update cart/name on conflict, reset reminded_at so clock restarts
  await supabase.from('cart_leads').upsert({
    email:       cleanEmail,
    name:        cleanName,
    cart:        cleanCart,
    updated_at:  new Date().toISOString(),
    reminded_at: null,
    converted:   false
  }, { onConflict: 'email', ignoreDuplicates: false });

  res.status(200).json({ ok: true });
}
