import { verifyAdmin }       from '../utils/auth.js';
import { sendOrderConfirmation, sendOrderShipped, sendPaymentPending } from '../utils/email.js';

const MOCK_ORDER = {
  id:                  'aabbccdd-1234-5678-abcd-000000000001',
  created_at:          new Date().toISOString(),
  paid_at:             new Date().toISOString(),
  shipped_at:          new Date().toISOString(),
  status:              'paid',
  customer_name:       'Gabriel Janssen',
  customer_email:      null, // preenchido abaixo com o email do admin
  total:               18990,
  shipping_cost:       0,
  shipping_service_name: 'SEDEX',
  carrier:             'Correios',
  tracking_code:       'BR123456789BR',
  coupon_code:         'TESTE10',
  discount_amount:     1900,
  shipping_address: {
    rua:          'Rua Augusta',
    numero:       '1500',
    complemento:  'Apto 42',
    bairro:       'Consolação',
    cidade:       'São Paulo',
    estado:       'SP',
    cep:          '01304-001'
  },
  order_items: [
    { product_name: 'Camiseta Arquivo 90 Classic', size: 'M', color: 'Preto', quantity: 1, unit_price: 12990 },
    { product_name: 'Moletom Retrô SP',            size: 'G', color: null,    quantity: 1, unit_price: 7900  }
  ]
};

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { type, email } = req.body || {};
  const to = email?.trim() || user.email;

  if (!['confirmation', 'pending', 'shipped'].includes(type)) {
    res.status(400).json({ error: 'type deve ser confirmation | pending | shipped' }); return;
  }

  const order = { ...MOCK_ORDER, customer_email: to };

  try {
    let result;
    if (type === 'confirmation') result = await sendOrderConfirmation(order);
    if (type === 'pending')      result = await sendPaymentPending(order);
    if (type === 'shipped')      result = await sendOrderShipped(order);

    // Surface Resend response for debugging
    const resendData  = result?.data  ?? null;
    const resendError = result?.error ?? null;
    console.log('Resend result:', JSON.stringify(result));

    if (resendError) {
      return res.status(500).json({ error: 'Resend error', detail: resendError });
    }

    res.json({ ok: true, sent_to: to, type, resend_id: resendData?.id ?? null });
  } catch (err) {
    console.error('test-email error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
