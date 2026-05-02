// ── Mobile nav drawer ──────────────────────────────────────────────────────

const DRAWER_HTML = `
  <div class="nav-overlay" id="nav-overlay"></div>
  <div class="nav-drawer" id="nav-drawer" aria-label="Menu">
    <div class="nav-drawer__head">
      <span class="nav-drawer__title">Menu</span>
      <button class="nav-drawer__close" id="nav-drawer-close" aria-label="Fechar menu">✕</button>
    </div>
    <div class="nav-drawer__search">
      <input type="search" class="search-input" id="nav-drawer-search" placeholder="Pesquisar produtos..." autocomplete="off">
    </div>
    <nav class="nav-drawer__body" id="nav-drawer-body"></nav>
  </div>`;

function injectDrawer() {
  const el = document.createElement('div');
  el.innerHTML = DRAWER_HTML;
  document.body.appendChild(el.children[0]); // overlay
  document.body.appendChild(el.children[0]); // drawer
}

function openNav() {
  document.getElementById('nav-drawer')?.classList.add('open');
  document.getElementById('nav-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeNav() {
  document.getElementById('nav-drawer')?.classList.remove('open');
  document.getElementById('nav-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

export function initNav(activePath) {
  injectDrawer();

  document.getElementById('hamburger-btn')?.addEventListener('click', openNav);
  document.getElementById('nav-drawer-close')?.addEventListener('click', closeNav);
  document.getElementById('nav-overlay')?.addEventListener('click', closeNav);

  document.getElementById('nav-drawer-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) location.href = `/produtos?q=${encodeURIComponent(q)}`;
    }
  });
}

export function buildNavDrawer(products, activePath) {
  const body = document.getElementById('nav-drawer-body');
  if (!body) return;

  const tipos    = [...new Set(products.map(p => p.tipo).filter(Boolean))].sort();
  const esportes = [...new Set(products.map(p => p.esporte).filter(Boolean))].sort();
  const subcats  = [...new Set(products.map(p => p.subcategoria).filter(Boolean))].sort();
  const times    = [...new Set(products.map(p => p.time_ref).filter(Boolean))].sort();

  function section(label, items, param) {
    if (!items.length) return '';
    return `
      <div class="nav-drawer__section">
        <p class="nav-drawer__section-label">${label}</p>
        ${items.map(v => `<a href="/produtos?${param}=${encodeURIComponent(v)}" class="nav-drawer__link">${v}</a>`).join('')}
      </div>`;
  }

  body.innerHTML = `
    <a href="/" class="nav-drawer__link nav-drawer__link--top${activePath === '/' ? ' active' : ''}">Início</a>
    ${section('Produtos', tipos, 'tipo')}
    ${section('Esportes', esportes, 'esporte')}
    ${section('Categorias', subcats, 'subcategoria')}
    ${section('Times', times, 'time_ref')}
    <a href="/sobre" class="nav-drawer__link nav-drawer__link--top${activePath === '/sobre' ? ' active' : ''}">Sobre</a>`;
}
