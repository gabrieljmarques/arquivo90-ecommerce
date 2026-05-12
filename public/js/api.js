// Arquivo 90 — API client compartilhado
const BASE = '/api';

export async function fetchProducts() {
  const r = await fetch(`${BASE}/products`);
  if (!r.ok) throw new Error('Erro ao carregar produtos');
  return r.json();
}

export async function fetchProduct(slug) {
  const r = await fetch(`${BASE}/products/${slug}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Erro ao carregar produto');
  return r.json();
}

export async function calculateShipping({ cep, items }) {
  const r = await fetch(`${BASE}/shipping/calculate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ cep, items })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Erro ao calcular frete');
  return data; // { options: [...] | null, fallback: bool }
}

export async function validateCoupon({ code, subtotal }) {
  const r = await fetch(`${BASE}/coupons/validate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code, subtotal })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Cupom inválido');
  return data; // { valid, coupon, discount_amount }
}

export async function createPayment({ items, customer, shippingAddress, shippingService, couponCode }) {
  const idempotency_key = crypto.randomUUID();
  const r = await fetch(`${BASE}/payment/create`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      items, customer,
      shipping_address: shippingAddress,
      shipping_service:  shippingService || null,
      coupon_code:       couponCode      || null,
      idempotency_key
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Erro ao processar pagamento');
  return data;
}

// ── Cart (localStorage) ────────────────────────────────────────────────────
const CART_KEY = 'a90_cart';

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}

export function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(i => i.product_id === item.product_id && i.size === item.size);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push(item);
  }
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  return cart;
}

export function removeFromCart(product_id, size, color) {
  const c = color || null;
  const cart = getCart().filter(i => !(i.product_id === product_id && i.size === size && (i.color||null) === c));
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  return cart;
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// ── Helpers de UI ──────────────────────────────────────────────────────────
export function fmt(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
}

let toastTimer;
export function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

export function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled  = true;
  } else {
    btn.textContent = btn.dataset.label || '';
    btn.disabled    = false;
  }
}
