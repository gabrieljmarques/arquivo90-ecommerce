import crypto from 'crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { supabase }               from '../utils/supabase.js';
import { rateLimit, getClientIp } from '../utils/ratelimit.js';
import { sendOrderConfirmation, sendPaymentPending } from '../utils/email.js';

const EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAT_RATE      = 2500;
const FREE_THRESHOLD = 25000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const action = req.query.action;
  if (action === 'process') return runProcessPayment(req, res);
  return runCreatePreference(req, res);
}

// ── Shared helpers ────────────────────────────────────────────────────────────

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

function validateCommon(body) {
  const { items, customer, shipping_address, idempotency_key } = body || {};
  if (!Array.isArray(items) || !items.length) return 'Carrinho vazio';
  if (!customer?.name?.trim() || !customer?.email) return 'Nome e email são obrigatórios';
  if (!EMAIL_RE.test(customer.email)) return 'Email inválido';
  if (!idempotency_key || !UUID_RE.test(idempotency_key)) return 'Chave de idempotência inválida';
  if (!shipping_address?.cep || !shipping_address?.rua || !shipping_address?.cidade) return 'Endereço incompleto';
  return null;
}

// Reserve stock, create order, return prepared data or { error }
async function prepareOrder(body) {
  const { items, customer, shipping_address, shipping_service, idempotency_key, coupon_code } = body;

  const cleanCustomer = {
    name:      customer.name.trim().slice(0, 100),
    email:     customer.email.toLowerCase().trim(),
    phone:     customer.phone?.trim().slice(0, 20) || null,
    cpf:       customer.cpf?.replace(/\D/g,'').slice(0, 11) || null,
    birthdate: customer.birthdate?.trim().slice(0, 10) || null
  };

  const productIds = [...new Set(items.map(i => i.product_id))];
  const { data: products, error: prodErr } = await supabase.from('products')
    .select('id, name, price, active, deleted_at').in('id', productIds).eq('active', true).is('deleted_at', null);

  if (prodErr || products.length !== productIds.length) {
    return { error: 'Um ou mais produtos não estão disponíveis' };
  }

  const productMap = Object.fromEntries(products.map(p => [p.id, p]));
  const reserved   = [];
  const orderId    = crypto.randomUUID();
  const expiresAt  = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  for (const item of items) {
    if (!item.product_id || !item.size || !item.quantity || item.quantity < 1) {
      await releaseAll(reserved, orderId); return { error: 'Item inválido no carrinho' };
    }
    const { data: ok, error: resErr } = await supabase.rpc('reserve_stock', {
      p_product_id: item.product_id, p_size: item.size,
      p_quantity: item.quantity,     p_color: item.color || null
    });
    if (resErr || !ok) {
      await releaseAll(reserved, orderId);
      return { error: `Tamanho ${item.size} sem estoque disponível para "${productMap[item.product_id]?.name}"` };
    }
    reserved.push({ p_product_id: item.product_id, p_size: item.size, p_quantity: item.quantity, p_color: item.color || null });
    try {
      await supabase.from('stock_reservations').insert({
        order_id: orderId, product_id: item.product_id, size: item.size,
        quantity: item.quantity, expires_at: expiresAt
      });
    } catch (err) { console.error('stock_reservations insert failed:', err.message); }
  }

  const subtotal       = items.reduce((s, i) => s + productMap[i.product_id].price * i.quantity, 0);
  const shippingCentavos = subtotal >= FREE_THRESHOLD
    ? 0
    : (shipping_service?.price_cents > 0 ? shipping_service.price_cents : FLAT_RATE);

  const cleanCouponCode = coupon_code
    ? coupon_code.trim().toUpperCase().slice(0, 50).replace(/[^A-Z0-9_-]/g, '')
    : null;

  let claimedCoupon  = null;
  let discountAmount = 0;
  if (cleanCouponCode) {
    const { data: claimed } = await supabase.rpc('claim_coupon', {
      p_code: cleanCouponCode, p_order_subtotal: subtotal
    });
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row) {
      await releaseAll(reserved, orderId);
      return { error: 'Cupom inválido, expirado ou esgotado' };
    }
    claimedCoupon  = row;
    discountAmount = row.type === 'percentage'
      ? Math.floor(subtotal * row.value / 100)
      : Math.min(row.value, subtotal);
  }

  const total = subtotal + shippingCentavos - discountAmount;

  const { error: orderErr } = await supabase.from('orders').insert({
    id: orderId, idempotency_key, status: 'pending',
    customer_name:  cleanCustomer.name,      customer_email: cleanCustomer.email,
    customer_phone: cleanCustomer.phone,     customer_cpf: cleanCustomer.cpf,
    customer_birthdate: cleanCustomer.birthdate,
    shipping_address, total, shipping_cost: shippingCentavos,
    shipping_service_id:   shipping_service?.id   ?? null,
    shipping_service_name: shipping_service?.name ?? null,
    carrier:               shipping_service?.company ?? null,
    shipping_deadline:     shipping_service?.delivery_time ?? null,
    coupon_code:     claimedCoupon?.code ?? null,
    discount_amount: discountAmount
  });

  if (orderErr) {
    await releaseAll(reserved, orderId);
    if (claimedCoupon) await supabase.rpc('release_coupon', { p_code: claimedCoupon.code }).catch(() => {});
    console.error('order insert error:', orderErr.message);
    return { error: 'Erro ao criar pedido' };
  }

  await supabase.from('order_items').insert(items.map(i => ({
    order_id: orderId, product_id: i.product_id, product_name: productMap[i.product_id].name,
    size: i.size, color: i.color || null, quantity: i.quantity, unit_price: productMap[i.product_id].price
  })));

  return { orderId, reserved, cleanCustomer, productMap, total, shippingCentavos, discountAmount, claimedCoupon, items };
}

// ── Stock confirmation helpers ─────────────────────────────────────────────────

async function confirmPayment(orderId, paymentId, cleanCustomer) {
  await supabase.rpc('confirm_stock_for_order', { p_order_id: orderId });
  await supabase.from('orders').update({
    status: 'paid', mp_payment_id: String(paymentId), paid_at: new Date().toISOString()
  }).eq('id', orderId).eq('status', 'pending');

  const { data: orderItems } = await supabase.from('order_items')
    .select('product_id, size, quantity').eq('order_id', orderId);
  for (const item of orderItems ?? []) {
    const { data: ps } = await supabase.from('product_sizes')
      .select('id').eq('product_id', item.product_id).eq('size', item.size).maybeSingle();
    if (ps) {
      try {
        await supabase.from('stock_transactions').insert({
          product_size_id: ps.id, delta: -item.quantity,
          reason: 'sale', order_id: orderId, created_by: 'system'
        });
      } catch (err) { console.error('stock_transactions insert failed:', err.message); }
    }
  }

  const { data: fullOrder } = await supabase.from('orders')
    .select('*, order_items(*)').eq('id', orderId).maybeSingle();
  if (fullOrder) sendOrderConfirmation(fullOrder).catch(e => console.error('confirmation email failed:', e.message));
  if (cleanCustomer?.email) {
    await supabase.from('cart_leads').update({ converted: true }).eq('email', cleanCustomer.email).catch(() => {});
  }
}

// ── Checkout Pro (redirect) ───────────────────────────────────────────────────

async function runCreatePreference(req, res) {
  const ip      = getClientIp(req);
  const allowed = await rateLimit(`checkout:${ip}`, 5, 600);
  if (!allowed) { res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); return; }

  const validErr = validateCommon(req.body);
  if (validErr) { res.status(400).json({ error: validErr }); return; }

  const { items, customer, shipping_address, shipping_service, idempotency_key, coupon_code } = req.body;

  // Idempotency: return existing preference if still valid
  const { data: existing } = await supabase.from('orders')
    .select('id, mp_preference_id').eq('idempotency_key', idempotency_key).maybeSingle();
  if (existing?.mp_preference_id) {
    try {
      const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const pref     = await new Preference(mpClient).get({ preferenceId: existing.mp_preference_id });
      res.json({ init_point: pref.init_point, preference_id: existing.mp_preference_id, order_id: existing.id }); return;
    } catch { /* expired, create new */ }
  }

  const prepared = await prepareOrder(req.body);
  if (prepared.error) {
    res.status(prepared.error.includes('estoque') ? 409 : 400).json({ error: prepared.error }); return;
  }
  const { orderId, reserved, cleanCustomer, productMap, total, shippingCentavos, discountAmount, claimedCoupon } = prepared;

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
  res.json({ init_point: pref.init_point, preference_id: pref.id, order_id: orderId });
}

// ── Checkout Bricks (transparent) ────────────────────────────────────────────

async function runProcessPayment(req, res) {
  const ip      = getClientIp(req);
  const allowed = await rateLimit(`checkout:${ip}`, 5, 600);
  if (!allowed) { res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); return; }

  const { formData } = req.body || {};
  if (!formData?.payment_method_id) { res.status(400).json({ error: 'Dados de pagamento inválidos' }); return; }

  const validErr = validateCommon(req.body);
  if (validErr) { res.status(400).json({ error: validErr }); return; }

  const prepared = await prepareOrder(req.body);
  if (prepared.error) {
    res.status(prepared.error.includes('estoque') ? 409 : 400).json({ error: prepared.error }); return;
  }
  const { orderId, reserved, cleanCustomer, total, discountAmount, claimedCoupon } = prepared;

  // PIX discount: 5% off
  const isPix       = formData.payment_method_id === 'pix';
  const pixDiscount = isPix ? Math.round(total * 0.05) : 0;
  const finalTotal  = total - pixDiscount;

  if (isPix && pixDiscount > 0) {
    await supabase.from('orders').update({
      total:           finalTotal,
      discount_amount: discountAmount + pixDiscount
    }).eq('id', orderId);
  }

  const mpClient      = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN, options: { timeout: 12000 } });
  const paymentClient = new Payment(mpClient);

  // Build payment body
  const paymentBody = {
    transaction_amount: +(finalTotal / 100).toFixed(2),
    payment_method_id:  formData.payment_method_id,
    payer: { email: formData.payer?.email || cleanCustomer.email },
    external_reference: orderId,
    notification_url: `${process.env.SITE_URL}/api/payment/webhook`,
    metadata: { order_id: orderId }
  };

  // CPF identification (required in Brazil)
  const cpfNum = formData.payer?.identification?.number || cleanCustomer.cpf;
  if (cpfNum) {
    paymentBody.payer.identification = {
      type:   formData.payer?.identification?.type || 'CPF',
      number: cpfNum.replace(/\D/g,'')
    };
  }

  // Card-specific fields
  if (formData.token) {
    paymentBody.token        = formData.token;
    paymentBody.installments = Number(formData.installments) || 1;
    if (formData.issuer_id) paymentBody.issuer_id = formData.issuer_id;
  }

  let payment;
  try {
    payment = await paymentClient.create({ body: paymentBody });
  } catch (mpErr) {
    console.error('MP payment error:', mpErr.message);
    await releaseAll(reserved, orderId);
    if (claimedCoupon) await supabase.rpc('release_coupon', { p_code: claimedCoupon.code }).catch(() => {});
    await supabase.from('orders').delete().eq('id', orderId);
    res.status(502).json({ error: 'Erro ao processar pagamento. Tente novamente.' }); return;
  }

  // Always persist the payment ID
  await supabase.from('orders').update({ mp_payment_id: String(payment.id) }).eq('id', orderId);

  if (payment.status === 'approved') {
    await confirmPayment(orderId, payment.id, cleanCustomer);
    res.json({ status: 'approved', order_id: orderId });

  } else if (['in_process', 'pending'].includes(payment.status)) {
    // PIX or boleto — webhook will confirm
    const txData = payment.point_of_interaction?.transaction_data;
    const { data: pendingOrder } = await supabase.from('orders')
      .select('*, order_items(*)').eq('id', orderId).maybeSingle();
    if (pendingOrder) sendPaymentPending(pendingOrder).catch(e => console.error('pending email failed:', e.message));

    res.json({
      status:            'pending',
      order_id:          orderId,
      payment_method_id: payment.payment_method_id,
      pix_code:          txData?.qr_code        || null,
      pix_qr_base64:     txData?.qr_code_base64 || null,
      ticket_url:        txData?.ticket_url      || payment.transaction_details?.external_resource_url || null
    });

  } else {
    // rejected
    await releaseAll(reserved, orderId);
    if (claimedCoupon) await supabase.rpc('release_coupon', { p_code: claimedCoupon.code }).catch(() => {});
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId).eq('status', 'pending');
    res.json({ status: 'rejected', reason: payment.status_detail || 'rejected', order_id: orderId });
  }
}
