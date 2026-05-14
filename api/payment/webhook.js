import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase }                   from '../utils/supabase.js';
import { addToMECart }                from '../shipping/me-cart.js';
import { sendOrderConfirmation, sendPaymentPending } from '../utils/email.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const xSignature = req.headers['x-signature']  || '';
  const xRequestId = req.headers['x-request-id'] || '';
  const dataId     = req.query['data.id'] || req.query['id'] || '';

  if (process.env.MP_WEBHOOK_SECRET && xSignature) {
    const parts = Object.fromEntries(
      xSignature.split(',').map(p => { const [k, ...v] = p.split('='); return [k.trim(), v.join('=').trim()]; })
    );
    const ts = parts['ts'] || '';
    const v1 = parts['v1'] || '';
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
    const expBuf = Buffer.from(expected);
    const recBuf = Buffer.alloc(expBuf.length);
    Buffer.from(v1).copy(recBuf);
    if (!crypto.timingSafeEqual(expBuf, recBuf)) { console.warn('webhook signature mismatch'); res.status(401).end(); return; }
  }

  const payload = req.body;
  if (!payload || payload.type !== 'payment') { res.status(200).end(); return; }

  const notificationId = `payment:${payload.data?.id}`;

  const { data: existing } = await supabase
    .from('webhook_events').select('id').eq('mp_notification_id', notificationId).maybeSingle();
  if (existing) { res.status(200).end(); return; }

  const { data: event, error } = await supabase.from('webhook_events').insert({
    mp_notification_id: notificationId, payload, status: 'pending'
  }).select().single();

  if (error) { console.error('webhook insert error:', error.message); res.status(500).end(); return; }

  res.status(200).end();

  // Processa após responder ao MP
  processEvent(event).catch(async err => {
    console.error(`webhook processing failed for ${event.id}:`, err.message);
    await supabase.from('webhook_events').update({
      attempts: 1, last_attempt_at: new Date().toISOString(),
      error_message: err.message, status: 'failed'
    }).eq('id', event.id);
  });
}

async function processEvent(event) {
  const paymentId = event.payload?.data?.id;
  if (!paymentId) throw new Error('No payment ID in payload');

  const mpClient      = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  const paymentClient = new Payment(mpClient);
  const payment = await paymentClient.get({ id: String(paymentId) });
  const orderId = payment.external_reference;
  if (!orderId) throw new Error('No external_reference in payment');

  if (payment.status === 'approved') {
    await supabase.rpc('confirm_stock_for_order', { p_order_id: orderId });
    await supabase.from('orders').update({
      status: 'paid', mp_payment_id: String(paymentId), paid_at: new Date().toISOString()
    }).eq('id', orderId).eq('status', 'pending');

    // Fetch order + items + products for ME cart
    const { data: order } = await supabase.from('orders')
      .select('*, order_items(product_id, product_name, size, color, quantity, unit_price)')
      .eq('id', orderId).single();

    const orderItems = order?.order_items ?? [];

    // Stock transactions
    for (const item of orderItems) {
      const { data: ps } = await supabase.from('product_sizes').select('id')
        .eq('product_id', item.product_id).eq('size', item.size).maybeSingle();
      if (ps) await supabase.from('stock_transactions').insert({
        product_size_id: ps.id, delta: -item.quantity, reason: 'sale', order_id: orderId, created_by: 'system'
      });
    }

    // Confirmation email (non-blocking)
    sendOrderConfirmation(order).catch(err => console.error('sendOrderConfirmation failed:', err.message));

    // Add to Melhor Envio cart (non-blocking — order is already confirmed)
    if (order?.shipping_service_id) {
      const productIds = [...new Set(orderItems.map(i => i.product_id))];
      const { data: products } = await supabase.from('products')
        .select('id, peso_g').in('id', productIds);
      const productMap = Object.fromEntries((products || []).map(p => [p.id, p]));

      const meOrderId = await addToMECart({ order, orderItems, productMap }).catch(err => {
        console.error('addToMECart failed:', err.message); return null;
      });

      if (meOrderId) {
        await supabase.from('orders').update({ me_order_id: meOrderId }).eq('id', orderId);
      }
    }
  } else if (payment.status === 'pending') {
    // PIX / boleto — payment not yet confirmed
    const { data: order } = await supabase.from('orders')
      .select('*, order_items(product_id, product_name, size, color, quantity, unit_price)')
      .eq('id', orderId).single();
    if (order) sendPaymentPending(order).catch(err => console.error('sendPaymentPending failed:', err.message));

  } else if (['rejected', 'cancelled'].includes(payment.status)) {
    await supabase.rpc('release_stock_for_order', { p_order_id: orderId });
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId).eq('status', 'pending');
  }

  await supabase.from('webhook_events').update({
    status: ['approved','rejected','cancelled'].includes(payment.status) ? 'processed' : 'pending',
    attempts: 1, last_attempt_at: new Date().toISOString()
  }).eq('id', event.id);
}
