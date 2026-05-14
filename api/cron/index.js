import { MercadoPagoConfig, Payment } from 'mercadopago';
import { supabase }          from '../utils/supabase.js';
import { sendAbandonedCart } from '../utils/email.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).end(); return; }

  // Protect against unauthorized triggers
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.query.secret || req.headers['x-cron-secret'];
    if (provided !== secret) { res.status(401).json({ error: 'Unauthorized' }); return; }
  }

  const job = req.query.job || 'all';
  const results = {};

  try {
    if (job === 'expire' || job === 'all') {
      results.expire = await runExpireReservations().catch(e => ({ error: e.message }));
    }
    if (job === 'webhooks' || job === 'all') {
      results.webhooks = await runProcessWebhooks().catch(e => ({ error: e.message }));
    }
    if (job === 'abandoned' || job === 'all') {
      results.abandoned = await runAbandonedCart().catch(e => ({ error: e.message }));
    }

    res.json({ ok: true, job, ...results });
  } catch (err) {
    console.error('cron handler error:', err.message, err.stack);
    res.status(500).json({ error: err.message, job });
  }
}

// ── Expire stock reservations ────────────────────────────────────────────────

async function runExpireReservations() {
  const { data: expired, error } = await supabase.from('stock_reservations')
    .select('id, order_id, product_id, size, quantity').eq('status', 'active')
    .lt('expires_at', new Date().toISOString()).limit(50);

  if (error) { console.error('expire reservations fetch:', error.message); return { error: error.message }; }
  if (!expired?.length) return { expired: 0 };

  const orderIds = [...new Set(expired.map(r => r.order_id))];
  for (const orderId of orderIds) {
    await supabase.rpc('release_stock_for_order', { p_order_id: orderId })
      .catch(e => console.error(`release failed for order ${orderId}:`, e.message));
    await supabase.from('orders').update({ status: 'cancelled' })
      .eq('id', orderId).eq('status', 'pending').is('mp_payment_id', null);
  }

  console.log(`Expired ${orderIds.length} reservation(s).`);
  return { expired: orderIds.length };
}

// ── Process failed webhook events ────────────────────────────────────────────

async function runProcessWebhooks() {
  const mpClient      = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  const paymentClient = new Payment(mpClient);

  const { data: events, error } = await supabase.from('webhook_events')
    .select('*').eq('status', 'pending').lt('attempts', 3)
    .order('created_at', { ascending: true }).limit(10);

  if (error) { console.error('fetch webhook_events:', error.message); return { error: error.message }; }
  if (!events?.length) return { processed: 0 };

  let processed = 0;
  for (const event of events) {
    try {
      const paymentId = event.payload?.data?.id;
      if (!paymentId) throw new Error('No payment ID in payload');

      const payment = await paymentClient.get({ id: String(paymentId) });
      const orderId = payment.external_reference;
      if (!orderId) throw new Error('No external_reference in payment');

      if (payment.status === 'approved') {
        await supabase.rpc('confirm_stock_for_order', { p_order_id: orderId });
        await supabase.from('orders').update({ status: 'paid', mp_payment_id: String(paymentId), paid_at: new Date().toISOString() })
          .eq('id', orderId).eq('status', 'pending');
        const { data: items } = await supabase.from('order_items').select('product_id, size, quantity').eq('order_id', orderId);
        for (const item of items ?? []) {
          const { data: ps } = await supabase.from('product_sizes').select('id').eq('product_id', item.product_id).eq('size', item.size).maybeSingle();
          if (ps) await supabase.from('stock_transactions').insert({ product_size_id: ps.id, delta: -item.quantity, reason: 'sale', order_id: orderId, created_by: 'system' });
        }
      } else if (['rejected','cancelled'].includes(payment.status)) {
        await supabase.rpc('release_stock_for_order', { p_order_id: orderId });
        await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId).eq('status', 'pending');
      }

      await supabase.from('webhook_events').update({
        status: ['approved','rejected','cancelled'].includes(payment.status) ? 'processed' : 'pending',
        attempts: event.attempts + 1, last_attempt_at: new Date().toISOString()
      }).eq('id', event.id);
      processed++;
    } catch (err) {
      console.error(`event ${event.id} failed:`, err.message);
      await supabase.from('webhook_events').update({
        attempts: event.attempts + 1, last_attempt_at: new Date().toISOString(),
        error_message: err.message, status: event.attempts >= 2 ? 'failed' : 'pending'
      }).eq('id', event.id);
    }
  }
  return { processed };
}

// ── Abandoned cart emails ─────────────────────────────────────────────────────

async function runAbandonedCart() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: leads, error } = await supabase.from('cart_leads')
    .select('id, email, name, cart')
    .lt('updated_at', cutoff)
    .is('reminded_at', null)
    .eq('converted', false)
    .limit(20);

  if (error) { console.error('abandoned-cart fetch:', error.message); return { error: error.message }; }
  if (!leads?.length) return { sent: 0 };

  let sent = 0;
  for (const lead of leads) {
    try {
      await sendAbandonedCart(lead);
      await supabase.from('cart_leads').update({ reminded_at: new Date().toISOString() }).eq('id', lead.id);
      sent++;
    } catch (err) {
      console.error(`abandoned-cart email failed for ${lead.email}:`, err.message);
    }
  }
  return { sent, total: leads.length };
}
