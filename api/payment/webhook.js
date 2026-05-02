import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase } from '../utils/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  const xSignature  = req.headers.get('x-signature')  || '';
  const xRequestId  = req.headers.get('x-request-id') || '';
  const url         = new URL(req.url);
  const dataId      = url.searchParams.get('data.id') || url.searchParams.get('id') || '';

  if (process.env.MP_WEBHOOK_SECRET && xSignature) {
    const parts = Object.fromEntries(
      xSignature.split(',').map(p => {
        const [k, ...v] = p.split('=');
        return [k.trim(), v.join('=').trim()];
      })
    );
    const ts = parts['ts'] || '';
    const v1 = parts['v1'] || '';

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected = crypto
      .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
      .update(manifest)
      .digest('hex');

    const expBuf = Buffer.from(expected);
    const recBuf = Buffer.alloc(expBuf.length);
    Buffer.from(v1).copy(recBuf);

    if (!crypto.timingSafeEqual(expBuf, recBuf)) {
      console.warn('webhook signature mismatch');
      return new Response(null, { status: 401 });
    }
  }

  let payload;
  try { payload = await req.json(); }
  catch { return new Response(null, { status: 400 }); }

  if (payload.type !== 'payment') {
    return new Response(null, { status: 200 });
  }

  const notificationId = `payment:${payload.data?.id}`;

  // Dedup: se já existe, retorna 200 imediatamente
  const { data: existing } = await supabase
    .from('webhook_events')
    .select('id, status')
    .eq('mp_notification_id', notificationId)
    .maybeSingle();

  if (existing) {
    return new Response(null, { status: 200 });
  }

  // Registra o evento
  const { data: event, error } = await supabase.from('webhook_events').insert({
    mp_notification_id: notificationId,
    payload,
    status: 'pending'
  }).select().single();

  if (error) {
    console.error('webhook insert error:', error.message);
    return new Response(null, { status: 500 });
  }

  // Processa inline — sem cron necessário
  try {
    await processEvent(event);
  } catch (err) {
    console.error(`webhook processing failed for ${event.id}:`, err.message);
    await supabase.from('webhook_events').update({
      attempts:        1,
      last_attempt_at: new Date().toISOString(),
      error_message:   err.message,
      status:          'failed'
    }).eq('id', event.id);
  }

  return new Response(null, { status: 200 });
};

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
      status:        'paid',
      mp_payment_id: String(paymentId),
      paid_at:       new Date().toISOString()
    })
    .eq('id', orderId)
    .eq('status', 'pending');

    const { data: items } = await supabase
      .from('order_items')
      .select('product_id, size, quantity')
      .eq('order_id', orderId);

    for (const item of items ?? []) {
      const { data: ps } = await supabase
        .from('product_sizes')
        .select('id')
        .eq('product_id', item.product_id)
        .eq('size', item.size)
        .maybeSingle();

      if (ps) {
        await supabase.from('stock_transactions').insert({
          product_size_id: ps.id,
          delta:           -item.quantity,
          reason:          'sale',
          order_id:        orderId,
          created_by:      'system'
        });
      }
    }

  } else if (['rejected', 'cancelled'].includes(payment.status)) {
    await supabase.rpc('release_stock_for_order', { p_order_id: orderId });
    await supabase.from('orders').update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('status', 'pending');
  }

  await supabase.from('webhook_events').update({
    status:          ['approved','rejected','cancelled'].includes(payment.status) ? 'processed' : 'pending',
    attempts:        1,
    last_attempt_at: new Date().toISOString()
  }).eq('id', event.id);
}
