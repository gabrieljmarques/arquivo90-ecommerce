import { supabase }               from '../utils/supabase.js';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';

const CODE_RE = /^[A-Z0-9_-]{1,50}$/;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Rate-limit: 10 attempts per minute per IP — prevents coupon enumeration
  const ip      = getClientIp(req);
  const allowed = await rateLimit(`coupon:${ip}`, 10, 60);
  if (!allowed) { res.status(429).json({ error: 'Muitas tentativas. Aguarde um momento.' }); return; }

  const { code, subtotal } = req.body || {};

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Código inválido' }); return;
  }

  const cleanCode = code.trim().toUpperCase().slice(0, 50);

  if (!CODE_RE.test(cleanCode)) {
    res.status(400).json({ error: 'Código inválido' }); return;
  }

  const orderSubtotal = typeof subtotal === 'number' && subtotal > 0 ? Math.floor(subtotal) : 0;

  const { data: coupon } = await supabase.from('coupons')
    .select('id, code, type, value, min_order, max_uses, uses_count, expires_at, active')
    .eq('code', cleanCode)
    .maybeSingle();

  // Provide a generic message for all failure cases — prevents enumeration
  const INVALID_MSG = 'Cupom inválido ou expirado';

  if (!coupon)           { res.status(404).json({ error: INVALID_MSG }); return; }
  if (!coupon.active)    { res.status(400).json({ error: INVALID_MSG }); return; }
  if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
    res.status(400).json({ error: INVALID_MSG }); return;
  }
  if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
    res.status(400).json({ error: 'Cupom esgotado' }); return;
  }
  if (orderSubtotal > 0 && orderSubtotal < coupon.min_order) {
    const minFmt = `R$ ${(coupon.min_order / 100).toFixed(2).replace('.', ',')}`;
    res.status(400).json({ error: `Pedido mínimo de ${minFmt} para este cupom` }); return;
  }

  // Calculate discount amount (applied to subtotal only, not shipping)
  const base           = orderSubtotal || 0;
  const discountAmount = coupon.type === 'percentage'
    ? Math.floor(base * coupon.value / 100)
    : Math.min(coupon.value, base);

  res.json({
    valid: true,
    coupon: { code: coupon.code, type: coupon.type, value: coupon.value },
    discount_amount: discountAmount
  });
}
