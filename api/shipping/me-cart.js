// Utility: add a paid order to the Melhor Envio cart.
// Returns the ME shipment ID (string) or null on failure.

const ME_BASE = process.env.ME_SANDBOX === '1'
  ? 'https://sandbox.melhorenvio.com.br/api/v2'
  : 'https://melhorenvio.com.br/api/v2';

const ME_CONTACT = process.env.ME_CONTACT_EMAIL || 'contato@arquivo90.com.br';

/**
 * @param {object} order        - orders row (must include shipping_address, customer_*, shipping_service_id)
 * @param {array}  orderItems   - order_items rows (product_id, quantity, unit_price)
 * @param {object} productMap   - { [product_id]: { peso_g, ... } }
 */
export async function addToMECart({ order, orderItems, productMap }) {
  if (!process.env.ME_TOKEN) return null;
  if (!order.shipping_service_id) return null;

  // Origin address must be set as JSON env var, e.g.:
  // ME_ORIGIN_JSON = {"name":"Arquivo 90","phone":"11914267653","email":"contato@arquivo90.com.br",
  //   "document":"000.000.000-00","postal_code":"01310100","address":"Av Paulista",
  //   "number":"1000","complement":"","district":"Bela Vista","city":"São Paulo","state_abbr":"SP","country_id":"BR"}
  let from = null;
  try { from = JSON.parse(process.env.ME_ORIGIN_JSON || 'null'); } catch { /* */ }
  if (!from) {
    console.warn('ME_ORIGIN_JSON not set — skipping ME cart');
    return null;
  }

  const addr = order.shipping_address || {};
  const to = {
    name:        order.customer_name,
    email:       order.customer_email,
    phone:       (order.customer_phone || '').replace(/\D/g, ''),
    postal_code: String(addr.cep || '').replace(/\D/g, ''),
    address:     addr.rua         || '',
    number:      addr.numero      || 'S/N',
    complement:  addr.complemento || '',
    district:    addr.bairro      || '',
    city:        addr.cidade      || '',
    state_abbr:  addr.estado      || '',
    country_id:  'BR'
  };

  // Aggregate weight / value
  let totalWeightKg = 0;
  let totalValue    = 0;
  let totalQty      = 0;
  for (const item of orderItems) {
    const p   = productMap[item.product_id];
    const qty = item.quantity || 1;
    totalWeightKg += ((p?.peso_g || 300) / 1000) * qty;
    totalValue    += (item.unit_price / 100)      * qty; // unit_price stored in centavos
    totalQty      += qty;
  }

  const payload = {
    service:  order.shipping_service_id,
    from,
    to,
    products: orderItems.map(item => ({
      name:           item.product_name || 'Camiseta Arquivo 90',
      quantity:       item.quantity,
      unitary_value:  +(item.unit_price / 100).toFixed(2),
      weight:         +(((productMap[item.product_id]?.peso_g || 300) / 1000) * item.quantity).toFixed(3)
    })),
    volumes: [{
      height: Math.min(5 * totalQty, 30),
      width:  30,
      length: 40,
      weight: +totalWeightKg.toFixed(3)
    }],
    options: {
      insurance_value: +totalValue.toFixed(2),
      receipt:         false,
      own_hand:        false,
      reverse:         false,
      non_commercial:  true
    },
    tag: order.id
  };

  try {
    const r = await fetch(`${ME_BASE}/me/cart`, {
      method:  'POST',
      headers: {
        'Accept':        'application/json',
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.ME_TOKEN}`,
        'User-Agent':    `Arquivo90 (${ME_CONTACT})`
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text();
      console.error(`ME cart add ${r.status}:`, text);
      return null;
    }

    const data = await r.json();
    return data?.id ? String(data.id) : null;
  } catch (err) {
    console.error('ME cart error:', err.message);
    return null;
  }
}
