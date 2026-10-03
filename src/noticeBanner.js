// OKO — oznam prevádzkovateľa a vypnuté zdroje na glóbuse (2026-10-03).
//
// Text nastavuje vlastník v admin paneli (/admin.html → Oznam). Keď admin
// vypne feed, banner to povie aj bez oznamu — vrstva bez dát nesmie
// vyzerať živo (CLAUDE.md pravidlo 2). Zavretie platí pre daný text do
// zatvorenia karty (sessionStorage), nový text sa ukáže znova.

const REFRESH_MS = 5 * 60_000;
const DISMISS_KEY = 'oko.notice.dismissed';

function readDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
}
function writeDismissed(id) {
  try { sessionStorage.setItem(DISMISS_KEY, id); } catch { /* súkromné okno */ }
}

/** Text banneru z odpovede /api/notice; null = nič neukazovať. */
export function noticeContent(data) {
  if (!data || typeof data !== 'object') return null;
  const parts = [];
  if (data.notice?.text) parts.push(String(data.notice.text));
  const disabled = Array.isArray(data.disabled) ? data.disabled.filter(label => typeof label === 'string') : [];
  if (disabled.length) parts.push(`Dočasne vypnuté: ${disabled.join(', ')}.`);
  if (!parts.length) return null;
  return {
    id: `${data.notice?.id || ''}|${disabled.join(',')}`,
    level: data.notice?.level === 'warn' || (!data.notice && disabled.length) ? 'warn' : 'info',
    text: parts.join(' '),
  };
}

export function initNoticeBanner({ doc = document, fetchImpl = (...args) => fetch(...args) } = {}) {
  let banner = null;
  let timer = null;
  const render = content => {
    if (!content || readDismissed() === content.id) { banner?.remove(); banner = null; return; }
    if (!banner) {
      banner = doc.createElement('div');
      banner.className = 'oko-notice';
      banner.setAttribute('role', 'status');
      const text = doc.createElement('span');
      text.className = 'oko-notice-text';
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'oko-notice-close';
      close.setAttribute('aria-label', 'Zavrieť oznam');
      close.textContent = '×';
      close.addEventListener('click', () => { writeDismissed(banner?.dataset.id || ''); banner?.remove(); banner = null; });
      banner.append(text, close);
      doc.body.append(banner);
    }
    banner.dataset.id = content.id;
    banner.dataset.level = content.level;
    banner.querySelector('.oko-notice-text').textContent = content.text;
  };
  const refresh = async () => {
    try {
      const response = await fetchImpl('/api/notice', { credentials: 'omit' });
      if (response.ok) render(noticeContent(await response.json()));
    } catch { /* bez backendu nič */ }
  };
  void refresh();
  timer = setInterval(refresh, REFRESH_MS);
  return { refresh, stop() { clearInterval(timer); banner?.remove(); } };
}
