import { applyDomTranslations } from '../i18n.js';
import { initAuthPanel } from './panel.js';

// Secrets in fragments never reach the web server/referrer. Remove them from
// the current history entry before further UI initialization; keep only in memory.
const params = new URLSearchParams(location.hash.slice(1));
const action = params.get('action');
const token = params.get('token');
const linkAction = ['reset', 'verify', 'email'].includes(action) ? { action, token } : null;
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
applyDomTranslations();
const account = initAuthPanel({ mount: document.getElementById('account-page-actions'), linkAction });
void account.open();
