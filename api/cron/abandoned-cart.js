import { supabase }           from '../utils/supabase.js';
import { sendAbandonedCart }  from '../utils/email.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).end(); return; }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago

  const { data: leads, error } = await supabase
    .from('cart_leads')
    .select('id, email, name, cart')
    .lt('updated_at', cutoff)
    .is('reminded_at', null)
    .eq('converted', false)
    .limit(20);

  if (error) { console.error('abandoned-cart fetch:', error.message); res.status(500).json({ error: error.message }); return; }
  if (!leads?.length) { res.json({ sent: 0 }); return; }

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

  console.log(`Abandoned cart: sent ${sent}/${leads.length}`);
  res.json({ sent, total: leads.length });
}
