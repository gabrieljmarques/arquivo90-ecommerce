// Cart module — localStorage + drawer UI
const CART_KEY       = 'a90_cart';
const FREE_THRESHOLD = 25000; // R$ 250,00 em centavos

export function fmt(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n / 100);
}

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function addItem(item) {
  const cart = getCart();
  const existing = cart.find(i => i.product_id === item.product_id && i.size === item.size && (i.color||null) === (item.color||null));
  if (existing) { existing.quantity += item.quantity; }
  else           { cart.push(item); }
  saveCart(cart);
  _render();
  return cart;
}

export function removeItem(idx) {
  const cart = getCart();
  cart.splice(idx, 1);
  saveCart(cart);
  _render();
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

// ── Drawer ──

let _mounted = false;

function _mount() {
  if (_mounted) return;
  _mounted = true;

  const overlay = Object.assign(document.createElement('div'), {
    className: 'cart-overlay', id: 'cart-overlay'
  });

  const drawer = document.createElement('aside');
  drawer.className = 'cart-drawer';
  drawer.id        = 'cart-drawer';
  drawer.setAttribute('aria-label', 'Carrinho');
  drawer.innerHTML = `
    <div class="cart-drawer__head">
      <span class="cart-drawer__title">Carrinho</span>
      <button class="cart-close" id="cart-close">Fechar</button>
    </div>
    <div class="cart-free-bar" id="cart-free-bar">
      <p class="cart-free-bar__label" id="cart-free-bar-label"></p>
      <div class="cart-free-bar__track">
        <div class="cart-free-bar__fill" id="cart-free-bar-fill"></div>
      </div>
    </div>
    <div class="cart-drawer__items" id="cart-items"></div>
    <div class="cart-drawer__foot" id="cart-foot" style="display:none">
      <div class="cart-row">
        <span class="cart-row__label">Subtotal</span>
        <span class="cart-row__value" id="cart-total"></span>
      </div>
      <div class="cart-row cart-row--ship">
        <span class="cart-row__label">Frete</span>
        <span class="cart-row__value cart-row__ship" id="cart-ship"></span>
      </div>
      <a href="/checkout" class="btn btn--primary btn--full">Finalizar compra</a>
    </div>`;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  document.getElementById('cart-close').addEventListener('click', closeCart);
  overlay.addEventListener('click', closeCart);
}

function _render() {
  _mount();
  const cart    = getCart();
  const itemsEl = document.getElementById('cart-items');
  const footEl  = document.getElementById('cart-foot');
  const countEl = document.getElementById('cart-count');
  if (!itemsEl) return;

  const total = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const count = cart.reduce((s, i) => s + i.quantity, 0);

  if (countEl) {
    countEl.textContent = count;
    countEl.classList.toggle('has-items', count > 0);
  }

  // ── Free-shipping progress bar ──
  const barEl    = document.getElementById('cart-free-bar');
  const barFill  = document.getElementById('cart-free-bar-fill');
  const barLabel = document.getElementById('cart-free-bar-label');
  if (barEl && barFill && barLabel) {
    if (!cart.length) {
      barEl.style.display = 'none';
    } else if (total >= FREE_THRESHOLD) {
      barEl.style.display = 'block';
      barFill.style.width = '100%';
      barLabel.innerHTML  = '🎉 Você ganhou frete grátis!';
    } else {
      const remaining = FREE_THRESHOLD - total;
      const pct = Math.round((total / FREE_THRESHOLD) * 100);
      barEl.style.display = 'block';
      barFill.style.width = pct + '%';
      barLabel.textContent = `Faltam ${fmt(remaining)} para frete grátis`;
    }
  }

  if (!cart.length) {
    itemsEl.innerHTML = '<div class="cart-empty">Seu carrinho está vazio.</div>';
    if (footEl) footEl.style.display = 'none';
    return;
  }

  if (footEl) {
    footEl.style.display = 'block';
    const totalEl = document.getElementById('cart-total');
    const shipEl  = document.getElementById('cart-ship');
    if (totalEl) totalEl.textContent = fmt(total);
    if (shipEl) {
      if (total >= FREE_THRESHOLD) {
        shipEl.textContent  = 'Grátis';
        shipEl.style.color  = 'var(--success)';
        shipEl.style.fontWeight = '700';
      } else {
        shipEl.textContent = 'calculado no checkout';
        shipEl.style.color = 'var(--ink-mid)';
        shipEl.style.fontWeight = '';
      }
    }
  }

  itemsEl.innerHTML = cart.map((item, idx) => `
    <div class="cart-item">
      <div class="cart-item__img">
        ${item.image ? `<img src="${item.image}" alt="${item.product_name}" style="width:100%;height:100%;object-fit:cover">` : ''}
      </div>
      <div class="cart-item__info">
        <p class="cart-item__name">${item.product_name}</p>
        <p class="cart-item__meta">${item.size}${item.color ? ' · ' + item.color : ''}</p>
        <div class="cart-item__bottom">
          <span class="cart-item__price">${fmt(item.unit_price)}</span>
          <span class="cart-item__qty">Qtd&nbsp;${item.quantity}</span>
        </div>
      </div>
      <button class="cart-item__remove" data-idx="${idx}" aria-label="Remover">×</button>
    </div>`).join('');

  itemsEl.querySelectorAll('.cart-item__remove').forEach(btn => {
    btn.addEventListener('click', () => removeItem(+btn.dataset.idx));
  });
}

export function renderCart() { _render(); }

export function openCart() {
  _mount();
  _render();
  document.getElementById('cart-drawer')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeCart() {
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

export function initCartButton(btnSelector = '#cart-toggle') {
  const btn = document.querySelector(btnSelector);
  if (btn) btn.addEventListener('click', openCart);
  _render();
}
