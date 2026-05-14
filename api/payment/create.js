import crypto from 'crypto';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { supabase }               from '../utils/supabase.js';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const ip = getClientIp(req);
  const allowed = await rateLimit(`checkout:${ip}`, 5, 600);
  if (!allowed) { res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); return; }

  const { items, customer, shipping_address, shipping_service, idempotency_key, coupon_code } = req.body || {};

  if (!Array.isArray(items) || !items.length) { res.status(400).json({ error: 'Carrinho vazio' }); return; }
  if (!customer?.name?.trim() || !customer?.email) { res.status(400).json({ error: 'Nome e email são obrigatórios' }); return; }
  if (!EMAIL_RE.test(customer.email)) { res.status(400).json({ error: 'Email inválido' }); return; }
  if (!idempotency_key || !UUID_RE.test(idempotency_key)) { res.status(400).json({ error: 'Chave de idempotência inválida' }); return; }
  if (!shipping_address?.cep || !shipping_address?.rua || !shipping_address?.cidade) { res.status(400).json({ error: 'Endereço incompleto' }); return; }

  const cleanCustomer = {
    name:      customer.name.trim().slice(0, 100),
    email:     customer.email.toLowerCase().trim(),
    phone:     customer.phone?.trim().slice(0, 20) || null,
    cpf:       customer.cpf?.replace(/\D/g,'').slice(0, 11) || null,
    birthdate: customer.birthdate?.trim().slice(0, 10) || null
  };

  const { data: existing } = await supabase.from('orders').select('id, mp_preference_id').eq('idempotency_key', idempotency_key).maybeSingle();
  if (existing?.mp_preference_id) {
    try {
      const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const pref = await new Preference(mpClient).get({ preferenceId: existing.mp_preference_id });
      res.json({ init_point: pref.init_point, order_id: existing.id }); return;
    } catch { /* expirou, cria nova */ }
  }

  const productIds = [...new Set(items.map(i => i.product_id))];
  const { data: products, error: prodErr } = await supabase.from('products')
    .select('id, name, price, active, deleted_at').in('id', productIds).eq('active', true).is('deleted_at', null);

  if (prodErr || products.length !== productIds.length) { res.status(400).json({ error: 'Um ou mais produtos não estão disponíveis' }); return; }

  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const reserved   = [];
  const orderId    = crypto.randomUUID();
  const expiresAt  = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  for (const item of items) {
    if (!item.product_id || !item.size || !item.quantity || item.quantity < 1) {
      await releaseAll(reserved, orderId); res.status(400).json({ error: 'Item inválido no carrinho' }); return;
    }
    const { data: ok, error: resErr } = await supabase.rpc('reserve_stock', {
      p_product_id: item.product_id, p_size: item.size, p_quantity: item.quantity, p_color: item.color || null
    });
    if (resErr || !ok) {
      await releaseAll(reserved, orderId);
      res.status(409).json({ error: `Tamanho ${item.size} sem estoque disponível para "${productMap[item.product_id]?.name}"` }); return;
    }
    reserved.push({ p_product_id: item.product_id, p_size: item.size, p_quantity: item.quantity, p_color: item.color || null });

    // Inserir reserva imediatamente — garante que o cron de expiração consegue limpar
    // mesmo se o fluxo abortar mais adiante
    try {
      await supabase.from('stock_reservations').insert({
        order_id: orderId, product_id: item.product_id, size: item.size,
        quantity: item.quantity, expires_at: expiresAt
      });
    } catch (err) { console.error('stock_reservations insert failed:', err.message); }
  }

  const FLAT_RATE        = 2500;   // fallback sem ME configurado
  const FREE_THRESHOLD   = 25000; // R$ 250 — frete grátis

  const subtotal = items.reduce((sum, i) => sum + (productMap[i.product_id].price * i.quantity), 0);

  // Server-side free shipping enforcement — ignora o que o frontend enviou
  let shippingCentavos;
  if (subtotal >= FREE_THRESHOLD) {
    shippingCentavos = 0;
  } else {
    shippingCentavos = shipping_service?.price_cents > 0 ? shipping_service.price_cents : FLAT_RATE;
  }

  // ── Coupon claim (atomic — prevents double-use race conditions) ─────────
  let claimedCoupon   = null;
  let discountAmount  = 0;
  const cleanCouponCode = coupon_code
    ? coupon_code.trim().toUpperCase().slice(0, 50).replace(/[^A-Z0-9_-]/g, '')
    : null;

  if (cleanCouponCode) {
    const { data: claimed } = await supabase.rpc('claim_coupon', {
      p_code:            cleanCouponCode,
      p_order_subtotal:  subtotal
    });
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row) {
      await releaseAll(reserved, orderId);
      res.status(400).json({ error: 'Cupom inválido, expirado ou esgotado' }); return;
    }
    claimedCoupon  = row;
    discountAmount = row.type === 'percentage'
      ? Math.floor(subtotal * row.value / 100)
      : Math.min(row.value, subtotal);
  }

  const total = subtotal + shippingCentavos - discountAmount;

  const { error: orderErr } = await supabase.from('orders').insert({
    id: orderId, idempotency_key, status: 'pending',
    customer_name: cleanCustomer.name, customer_email: cleanCustomer.email, customer_phone: cleanCustomer.phone,
    customer_cpf: cleanCustomer.cpf, customer_birthdate: cleanCustomer.birthdate,
    shipping_address, total, shipping_cost: shippingCentavos,
    shipping_service_id:   shipping_service?.id   ?? null,
    shipping_service_name: shipping_service?.name ?? null,
    carrier:               shipping_service?.company ?? null,
    shipping_deadline:     shipping_service?.delivery_time ?? null,
    coupon_code:           claimedCoupon?.code    ?? null,
    discount_amount:       discountAmount
  });

  if (orderErr) {
    await releaseAll(reserved, orderId);
    if (claimedCoupon) await supabase.rpc('release_coupon', { p_code: claimedCoupon.code }).catch(() => {});
    console.error('order insert error:', orderErr.message);
    res.status(500).json({ error: 'Erro ao criar pedido' }); return;
  }

  await supabase.from('order_items').insert(items.map(i => ({
    order_id: orderId, product_id: i.product_id, product_name: productMap[i.product_id].name,
    size: i.size, color: i.color || null, quantity: i.quantity, unit_price: productMap[i.product_id].price
  })));

  const mpClient   = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN, options: { timeout: 8000 } });
  const prefClient = new Preference(mpClient);

  let pref;
  try {
    pref = await prefClient.create({ body: {
      external_reference: orderId,
      items: [
        ...items.map(i => ({
          id: i.product_id,
          title: `${productMap[i.product_id].name} — ${i.size}${i.color ? ' / ' + i.color : ''}`,
          quantity: i.quantity,
          unit_price: +(productMap[i.product_id].price / 100).toFixed(2),
          currency_id: 'BRL'
        })),
        ...(shippingCentavos > 0 ? [{
          id: 'frete',
          title: shipping_service?.name
            ? `Frete — ${shipping_service.company} ${shipping_service.name}`
            : 'Frete',
          quantity: 1,
          unit_price: +(shippingCentavos / 100).toFixed(2),
          currency_id: 'BRL'
        }] : [])
      ],
      payer: { name: cleanCustomer.name, email: cleanCustomer.email },
      payment_methods: { installments: 12, default_installments: 1 },
      back_urls: {
        success: `${process.env.SITE_URL}/obrigado?order=${orderId}`,
        failure: `${process.env.SITE_URL}/checkout?erro=pagamento`,
        pending: `${process.env.SITE_URL}/obrigado?order=${orderId}&status=pendente`
      },
      auto_return: 'approved',
      notification_url: `${process.env.SITE_URL}/api/payment/webhook`,
      metadata: { order_id: orderId }
    }});
  } catch (mpErr) {
    console.error('MP preference error:', mpErr.message);
    await releaseAll(reserved, orderId);
    if (claimedCoupon) await supabase.rpc('release_coupon', { p_code: claimedCoupon.code }).catch(() => {});
    await supabase.from('orders').delete().eq('id', orderId);
    res.status(502).json({ error: 'Erro ao iniciar pagamento. Tente novamente.' }); return;
  }

  await supabase.from('orders').update({ mp_preference_id: pref.id }).eq('id', orderId);
  res.json({ init_point: pref.init_point, order_id: orderId });
}

async function releaseAll(reservations, orderId) {
  for (const r of reservations) {
    try { await supabase.rpc('release_stock', r); }
    catch (err) { console.error('release_stock failed:', err.message); }
  }
  if (orderId) {
    try { await supabase.from('stock_reservations').delete().eq('order_id', orderId); }
    catch (err) { console.error('delete stock_reservations failed:', err.message); }
  }
}
