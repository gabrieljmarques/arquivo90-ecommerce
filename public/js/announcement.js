// Fetches admin-configured announcement text and rebuilds the scrolling bar.
// Import and call initAnnouncement() on every page that has #ann-inner.
export async function initAnnouncement() {
  try {
    const { settings } = await fetch('/api/site-settings').then(r => r.json());
    if (!settings?.announcement?.text) return;
    const annInner = document.getElementById('ann-inner');
    if (!annInner) return;
    const parts = settings.announcement.text.split(/\s*·\s*/).filter(Boolean);
    const items = parts.flatMap(t => [t, '·']);
    const doubled = [...items, ...items];
    annInner.innerHTML = doubled.map(t => `<span class="ann-item">${t}</span>`).join('');
  } catch { /* use static fallback */ }
}
