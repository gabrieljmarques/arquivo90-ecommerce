// Roda a cada minuto via cron. Processa pagamentos confirmados pelo MP.
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase } from './utils/supabase.js';

const mpClient      = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const paymentClient = new Payment(mpClient);

export default async () => {
  const { data: events, error } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('status', 'pending')
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) { console.error('fetch webhook_events:', error.message); return; }
  if (!events?.length) return;

  for (const event of events) {
    try {
      await processEvent(event);
    } catch (err) {
      console.error(`event ${event.id} failed:`, err.message);
      await supabase.from('webhook_events').update({
        attempts:         event.attempts + 1,
        last_attempt_at:  new Date().toISOString(),
        error_message:    err.message,
        status:           event.attempts >= 2 ? 'failed' : 'pending'
      }).eq('id', event.id);
    }
  }
};

async function processEvent(event) {
  const paymentId = event.payload?.data?.id;
  if (!paymentId) throw new Error('No payment ID in payload');

  const payment = await paymentClient.get({ id: String(paymentId) });
  const orderId = payment.external_reference;

  if (!orderId) throw new Error('No external_reference in payment');

  if (payment.status === 'approved') {
    // Confirma estoque (idempotente)
    await supabase.rpc('confirm_stock_for_order', { p_order_id: orderId });

    // Atualiza pedido só se ainda estiver pending (evita reprocessamento)
    await supabase.from('orders').update({
      status:        'paid',
      mp_payment_id: String(paymentId),
      paid_at:       new Date().toISOString()
    })
    .eq('id', orderId)
    .eq('status', 'pending');

    // Registra transação de estoque
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
  // Status 'in_process' / 'pending': aguarda próxima rodada

  await supabase.from('webhook_events').update({
    status:          ['approved','rejected','cancelled'].includes(payment.status) ? 'processed' : 'pending',
    attempts:        event.attempts + 1,
    last_attempt_at: new Date().toISOString()
  }).eq('id', event.id);
}

export const config = { schedule: '* * * * *' };
