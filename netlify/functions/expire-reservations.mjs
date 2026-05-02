// Roda a cada 5 minutos. Libera reservas de estoque vencidas (checkout abandonado).
import { supabase } from './utils/supabase.js';

export default async () => {
  const { data: expired, error } = await supabase
    .from('stock_reservations')
    .select('id, order_id, product_id, size, quantity')
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString())
    .limit(50);

  if (error) { console.error('expire reservations fetch:', error.message); return; }
  if (!expired?.length) return;

  const orderIds = [...new Set(expired.map(r => r.order_id))];

  for (const orderId of orderIds) {
    await supabase.rpc('release_stock_for_order', { p_order_id: orderId }).catch(e => {
      console.error(`release failed for order ${orderId}:`, e.message);
    });

    // Cancela pedido se ainda estiver pending e sem pagamento
    await supabase.from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('status', 'pending')
      .is('mp_payment_id', null);
  }

  console.log(`Expired ${orderIds.length} reservation(s).`);
};

export const config = { schedule: '*/5 * * * *' };
