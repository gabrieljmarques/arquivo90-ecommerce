import crypto                        from 'crypto';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { supabase }                   from './utils/supabase.js';
import { rateLimit, getClientIp }     from './utils/ratelimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST')    return Response.json({ error: 'Method not allowed' }, { status: 405 });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const ip      = getClientIp(req, context);
  const allowed = await rateLimit(`checkout:${ip}`, 5, 600); // 5 tentativas / 10min
  if (!allowed) {
    return Response.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 });
  }

  // ── Parse e validação do body ──────────────────────────────────────────────
  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error: 'Payload inválido' }, { status: 400 }); }

  const { items, customer, shipping_address, idempotency_key } = body;

  if (!Array.isArray(items) || !items.length)
    return Response.json({ error: 'Carrinho vazio' }, { status: 400 });

  if (!customer?.name?.trim() || !customer?.email)
    return Response.json({ error: 'Nome e email são obrigatórios' }, { status: 400 });

  if (!EMAIL_RE.test(customer.email))
    return Response.json({ error: 'Email inválido' }, { status: 400 });

  if (!idempotency_key || !UUID_RE.test(idempotency_key))
    return Response.json({ error: 'Chave de idempotência inválida' }, { status: 400 });

  if (!shipping_address?.cep || !shipping_address?.rua || !shipping_address?.cidade)
    return Response.json({ error: 'Endereço incompleto' }, { status: 400 });

  // Sanitiza inputs
  const cleanCustomer = {
    name:  customer.name.trim().slice(0, 100),
    email: customer.email.toLowerCase().trim(),
    phone: customer.phone?.trim().slice(0, 20) || null
  };

  // ── Idempotência: pedido já existe? ───────────────────────────────────────
  const { data: existing } = await supabase
    .from('orders')
    .select('id, mp_preference_id')
    .eq('idempotency_key', idempotency_key)
    .maybeSingle();

  if (existing?.mp_preference_id) {
    const mpClient    = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const prefClient  = new Preference(mpClient);
    try {
      const pref = await prefClient.get({ preferenceId: existing.mp_preference_id });
      return Response.json({ init_point: pref.init_point, order_id: existing.id });
    } catch {
      // MP preference expirou — deixa criar um novo abaixo
    }
  }

  // ── Busca produtos para validar preços server-side ─────────────────────────
  const productIds = [...new Set(items.map(i => i.product_id))];
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, price, active, deleted_at')
    .in('id', productIds)
    .eq('active', true)
    .is('deleted_at', null);

  if (prodErr || products.length !== productIds.length) {
    return Response.json({ error: 'Um ou mais produtos não estão disponíveis' }, { status: 400 });
  }

  const productMap = Object.fromEntries(products.map(p => [p.id, p]));

  // ── Reserva de estoque (atômica por item) ─────────────────────────────────
  const reserved = [];
  for (const item of items) {
    if (!item.product_id || !item.size || !item.quantity || item.quantity < 1) {
      await releaseAll(reserved);
      return Response.json({ error: 'Item inválido no carrinho' }, { status: 400 });
    }

    const { data: ok, error: resErr } = await supabase.rpc('reserve_stock', {
      p_product_id: item.product_id,
      p_size:       item.size,
      p_quantity:   item.quantity
    });

    if (resErr || !ok) {
      await releaseAll(reserved);
      return Response.json({
        error: `Tamanho ${item.size} sem estoque disponível para "${productMap[item.product_id]?.name}"`
      }, { status: 409 });
    }

    reserved.push({ p_product_id: item.product_id, p_size: item.size, p_quantity: item.quantity });
  }

  // ── Calcula totais — preços no banco estão em centavos (inteiros) ────────
  const SHIPPING_CENTAVOS = 2500; // R$ 25,00
  const subtotal = items.reduce(
    (sum, i) => sum + (productMap[i.product_id].price * i.quantity), 0
  );
  const total = subtotal + SHIPPING_CENTAVOS; // total em centavos

  // ── Cria pedido no banco ───────────────────────────────────────────────────
  const orderId = crypto.randomUUID();

  const { error: orderErr } = await supabase.from('orders').insert({
    id:               orderId,
    idempotency_key,
    status:           'pending',
    customer_name:    cleanCustomer.name,
    customer_email:   cleanCustomer.email,
    customer_phone:   cleanCustomer.phone,
    shipping_address,
    total,
    shipping_cost:    SHIPPING_CENTAVOS
  });

  if (orderErr) {
    await releaseAll(reserved);
    console.error('order insert error:', orderErr.message);
    return Response.json({ error: 'Erro ao criar pedido' }, { status: 500 });
  }

  // Itens do pedido (snapshot de preço)
  await supabase.from('order_items').insert(
    items.map(i => ({
      order_id:     orderId,
      product_id:   i.product_id,
      product_name: productMap[i.product_id].name,
      size:         i.size,
      quantity:     i.quantity,
      unit_price:   productMap[i.product_id].price
    }))
  );

  // Reservas com expiração de 30 min
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await supabase.from('stock_reservations').insert(
    items.map(i => ({
      order_id:   orderId,
      product_id: i.product_id,
      size:       i.size,
      quantity:   i.quantity,
      expires_at: expiresAt
    }))
  );

  // ── Cria preferência no Mercado Pago ──────────────────────────────────────
  const mpClient   = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN, options: { timeout: 8000 } });
  const prefClient = new Preference(mpClient);

  let pref;
  try {
    pref = await prefClient.create({
      body: {
        external_reference: orderId,
        items: items.map(i => ({
          id:         i.product_id,
          title:      `${productMap[i.product_id].name} — ${i.size}`,
          quantity:   i.quantity,
          unit_price: +(productMap[i.product_id].price / 100).toFixed(2),
          currency_id: 'BRL'
        })),
        payer:    { name: cleanCustomer.name, email: cleanCustomer.email },
        payment_methods: { installments: 1 },
        back_urls: {
          success: `${process.env.SITE_URL}/obrigado?order=${orderId}`,
          failure: `${process.env.SITE_URL}/checkout?erro=pagamento`,
          pending: `${process.env.SITE_URL}/obrigado?order=${orderId}&status=pendente`
        },
        auto_return:      'approved',
        notification_url: `${process.env.SITE_URL}/api/payment/webhook`,
        metadata:         { order_id: orderId }
      }
    });
  } catch (mpErr) {
    console.error('MP preference error:', mpErr.message);
    await releaseAll(reserved);
    await supabase.from('orders').delete().eq('id', orderId);
    return Response.json({ error: 'Erro ao iniciar pagamento. Tente novamente.' }, { status: 502 });
  }

  // Atualiza pedido com preference_id
  await supabase.from('orders').update({ mp_preference_id: pref.id }).eq('id', orderId);

  return Response.json({ init_point: pref.init_point, order_id: orderId });
};

async function releaseAll(reservations) {
  for (const r of reservations) {
    await supabase.rpc('release_stock', r).catch(() => {});
  }
}

export const config = { path: '/api/payment/create' };
