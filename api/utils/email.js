import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM     = 'Arquivo 90 <suporte@arquivo90.com.br>';
const REPLY_TO = 'suporte@arquivo90.com.br';
const SITE   = process.env.SITE_URL || 'https://arquivo90.com.br';

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((n || 0) / 100);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── Shared layout ─────────────────────────────────────────────────────────────

function layout(content) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arquivo 90</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8e0d8;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

      <!-- Logo -->
      <tr><td style="padding-bottom:32px;text-align:center;">
        <a href="${SITE}" style="text-decoration:none;">
          <span style="font-size:22px;font-weight:700;letter-spacing:0.12em;color:#e8e0d8;text-transform:uppercase;">ARQUIVO 90</span>
        </a>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:#161616;border-radius:8px;padding:40px 36px;">
        ${content}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding-top:24px;text-align:center;font-size:12px;color:#6b6159;line-height:1.6;">
        Arquivo 90 — São Paulo, SP<br>
        <a href="mailto:suporte@arquivo90.com.br" style="color:#a0978f;text-decoration:none;">suporte@arquivo90.com.br</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Item rows (shared between confirmation and shipped) ───────────────────────

function itemRows(items) {
  return (items || []).map(i => {
    const meta = [i.size, i.color].filter(Boolean).join(' · ');
    return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #222;">
        <span style="display:block;font-size:14px;color:#e8e0d8;">${i.product_name}</span>
        <span style="display:block;font-size:12px;color:#6b6159;margin-top:2px;">${meta} · Qtd ${i.quantity}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #222;text-align:right;font-size:14px;color:#e8e0d8;white-space:nowrap;">
        ${fmt(i.unit_price * i.quantity)}
      </td>
    </tr>`;
  }).join('');
}

// ── 1. Order confirmation ─────────────────────────────────────────────────────

export async function sendOrderConfirmation(order) {
  if (!process.env.RESEND_API_KEY) return;

  const items       = order.order_items || [];
  const subtotal    = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const hasDiscount = order.discount_amount > 0;
  const hasFrete    = order.shipping_cost > 0;
  const addr        = order.shipping_address || {};

  const html = layout(`
    <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e8e0d8;letter-spacing:0.04em;">Pedido confirmado</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#a0978f;">Pedido #${order.id.slice(0, 8).toUpperCase()} · ${fmtDate(order.paid_at || order.created_at)}</p>

    <p style="margin:0 0 16px;font-size:14px;color:#e8e0d8;">Oi, <strong>${order.customer_name?.split(' ')[0]}</strong>. Seu pagamento foi aprovado — já estamos separando seu pedido.</p>

    <!-- Items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <th style="text-align:left;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Produto</th>
        <th style="text-align:right;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Valor</th>
      </tr>
      ${itemRows(items)}
    </table>

    <!-- Totals -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="font-size:13px;color:#a0978f;padding:4px 0;">Subtotal</td>
        <td style="font-size:13px;color:#a0978f;text-align:right;padding:4px 0;">${fmt(subtotal)}</td>
      </tr>
      ${hasFrete ? `
      <tr>
        <td style="font-size:13px;color:#a0978f;padding:4px 0;">Frete${order.shipping_service_name ? ` (${order.shipping_service_name})` : ''}</td>
        <td style="font-size:13px;color:#a0978f;text-align:right;padding:4px 0;">${fmt(order.shipping_cost)}</td>
      </tr>` : `
      <tr>
        <td style="font-size:13px;color:#4ade80;padding:4px 0;">Frete</td>
        <td style="font-size:13px;color:#4ade80;text-align:right;padding:4px 0;">Grátis</td>
      </tr>`}
      ${hasDiscount ? `
      <tr>
        <td style="font-size:13px;color:#a0978f;padding:4px 0;">Desconto${order.coupon_code ? ` (${order.coupon_code})` : ''}</td>
        <td style="font-size:13px;color:#4ade80;text-align:right;padding:4px 0;">− ${fmt(order.discount_amount)}</td>
      </tr>` : ''}
      <tr>
        <td style="font-size:15px;font-weight:700;color:#e8e0d8;padding:12px 0 0;border-top:1px solid #333;margin-top:8px;">Total</td>
        <td style="font-size:15px;font-weight:700;color:#e8e0d8;text-align:right;padding:12px 0 0;border-top:1px solid #333;">${fmt(order.total)}</td>
      </tr>
    </table>

    <!-- Address -->
    <div style="background:#1e1e1e;border-radius:6px;padding:16px 20px;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;">Endereço de entrega</p>
      <p style="margin:0;font-size:13px;color:#a0978f;line-height:1.7;">
        ${addr.rua || ''}${addr.numero ? ', ' + addr.numero : ''}${addr.complemento ? ' ' + addr.complemento : ''}<br>
        ${addr.bairro ? addr.bairro + ' · ' : ''}${addr.cidade || ''}${addr.estado ? ' / ' + addr.estado : ''}<br>
        CEP ${addr.cep || ''}
      </p>
    </div>

    <p style="margin:0;font-size:13px;color:#6b6159;line-height:1.6;">
      Te avisamos por email quando o pedido for despachado. Qualquer dúvida, responda esse email.
    </p>
  `);

  return resend.emails.send({
    from:     FROM,
    reply_to: REPLY_TO,
    to:       order.customer_email,
    subject: `Pedido confirmado — #${order.id.slice(0, 8).toUpperCase()}`,
    html
  });
}

// ── 2. Payment pending (PIX / boleto) ────────────────────────────────────────

export async function sendPaymentPending(order) {
  if (!process.env.RESEND_API_KEY) return;

  const items    = order.order_items || [];
  const html = layout(`
    <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e8e0d8;letter-spacing:0.04em;">Pagamento pendente</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#a0978f;">Pedido #${order.id.slice(0, 8).toUpperCase()} · ${fmtDate(order.created_at)}</p>

    <p style="margin:0 0 16px;font-size:14px;color:#e8e0d8;">Oi, <strong>${order.customer_name?.split(' ')[0]}</strong>. Recebemos seu pedido, mas o pagamento ainda está sendo processado.</p>

    <div style="background:#1a1500;border:1px solid #4a3800;border-radius:6px;padding:16px 20px;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.08em;color:#d4a017;text-transform:uppercase;">Aguardando pagamento</p>
      <p style="margin:0;font-size:13px;color:#a0978f;line-height:1.6;">
        Assim que o pagamento for confirmado pelo banco, você receberá outro email e seu pedido será separado automaticamente.
      </p>
    </div>

    <!-- Items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <th style="text-align:left;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Produto</th>
        <th style="text-align:right;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Valor</th>
      </tr>
      ${itemRows(items)}
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="font-size:15px;font-weight:700;color:#e8e0d8;padding:12px 0 0;border-top:1px solid #333;">Total</td>
        <td style="font-size:15px;font-weight:700;color:#e8e0d8;text-align:right;padding:12px 0 0;border-top:1px solid #333;">${fmt(order.total)}</td>
      </tr>
    </table>

    <p style="margin:0;font-size:13px;color:#6b6159;line-height:1.6;">
      Dúvidas? Responda esse email.
    </p>
  `);

  return resend.emails.send({
    from:     FROM,
    reply_to: REPLY_TO,
    to:       order.customer_email,
    subject: `Pagamento pendente — #${order.id.slice(0, 8).toUpperCase()}`,
    html
  });
}

// ── 3. Order shipped ──────────────────────────────────────────────────────────

export async function sendOrderShipped(order) {
  if (!process.env.RESEND_API_KEY) return;

  const items   = order.order_items || [];
  const carrier = order.carrier || order.shipping_service_name || 'Transportadora';
  const tracking = order.tracking_code;

  const trackingBlock = tracking ? `
    <div style="background:#0f1a0f;border:1px solid #1a4a1a;border-radius:6px;padding:16px 20px;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#4ade80;text-transform:uppercase;">Código de rastreio</p>
      <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#e8e0d8;letter-spacing:0.08em;">${tracking}</p>
      <p style="margin:0;font-size:13px;color:#6b6159;">${carrier}</p>
    </div>` : `
    <div style="background:#1e1e1e;border-radius:6px;padding:16px 20px;margin-bottom:28px;">
      <p style="margin:0;font-size:13px;color:#a0978f;">O código de rastreio será disponibilizado assim que o pacote for coletado pela transportadora.</p>
    </div>`;

  const html = layout(`
    <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e8e0d8;letter-spacing:0.04em;">Pedido despachado</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#a0978f;">Pedido #${order.id.slice(0, 8).toUpperCase()} · Enviado em ${fmtDate(order.shipped_at)}</p>

    <p style="margin:0 0 24px;font-size:14px;color:#e8e0d8;">Oi, <strong>${order.customer_name?.split(' ')[0]}</strong>. Seu pedido foi despachado e já está a caminho.</p>

    ${trackingBlock}

    <!-- Items -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <th style="text-align:left;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Produto</th>
        <th style="text-align:right;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Qtd</th>
      </tr>
      ${(items || []).map(i => {
        const meta = [i.size, i.color].filter(Boolean).join(' · ');
        return `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #222;font-size:14px;color:#e8e0d8;">
            ${i.product_name}
            <span style="display:block;font-size:12px;color:#6b6159;margin-top:2px;">${meta}</span>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #222;text-align:right;font-size:14px;color:#a0978f;">${i.quantity}</td>
        </tr>`;
      }).join('')}
    </table>

    <p style="margin:0;font-size:13px;color:#6b6159;line-height:1.6;">
      Qualquer problema com a entrega, responda esse email e a gente resolve.
    </p>
  `);

  return resend.emails.send({
    from:     FROM,
    reply_to: REPLY_TO,
    to:       order.customer_email,
    subject: `Seu pedido foi despachado — #${order.id.slice(0, 8).toUpperCase()}`,
    html
  });
}

// ── 4. Abandoned cart ─────────────────────────────────────────────────────────

export async function sendAbandonedCart(lead) {
  if (!process.env.RESEND_API_KEY) return;

  const name  = lead.name?.split(' ')[0] || 'ei';
  const items = Array.isArray(lead.cart) ? lead.cart : [];

  const itemRows = items.map(i => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #222;">
        <span style="display:block;font-size:14px;color:#e8e0d8;">${i.product_name || i.name || 'Produto'}</span>
        <span style="display:block;font-size:12px;color:#6b6159;margin-top:2px;">${i.size}${i.color ? ' · ' + i.color : ''} · Qtd ${i.quantity}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #222;text-align:right;font-size:14px;color:#e8e0d8;white-space:nowrap;">
        ${fmt((i.unit_price || i.price || 0) * i.quantity)}
      </td>
    </tr>`).join('');

  const html = layout(`
    <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#e8e0d8;letter-spacing:0.04em;">Você esqueceu algo</h1>
    <p style="margin:0 0 28px;font-size:14px;color:#a0978f;">Seus itens ainda estão te esperando</p>

    <p style="margin:0 0 24px;font-size:14px;color:#e8e0d8;">Oi${name !== 'ei' ? ', <strong>' + name + '</strong>' : ''}. Você deixou alguns itens no carrinho — ainda dá tempo de garantir.</p>

    ${items.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <th style="text-align:left;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Produto</th>
        <th style="text-align:right;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#6b6159;text-transform:uppercase;padding-bottom:10px;border-bottom:1px solid #333;">Valor</th>
      </tr>
      ${itemRows}
    </table>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td align="center">
        <a href="${SITE}/checkout" style="display:inline-block;background:#e8e0d8;color:#0a0a0a;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:14px 36px;border-radius:4px;">
          Finalizar compra
        </a>
      </td></tr>
    </table>

    <p style="margin:0;font-size:12px;color:#6b6159;line-height:1.6;text-align:center;">
      O estoque é limitado — não garantimos disponibilidade por muito tempo.
    </p>
  `);

  return resend.emails.send({
    from:     FROM,
    reply_to: REPLY_TO,
    to:       lead.email,
    subject:  `${name !== 'ei' ? name + ', o' : 'O'} seu carrinho ainda está aqui`,
    html
  });
}
