/** In-memory state only. The browser manages the HttpOnly session cookie. */
export function createAuthClient({ fetchImpl = (...args) => fetch(...args) } = {}) {
  let state = { user: null, status: 'checking', busy: false, error: null,
    capabilities: {}, security: null, securityStatus: 'idle' };
  let csrfToken = null;
  let revision = 0;
  let securityGeneration = 0;
  let securityRequest = 0;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(state); };
  async function request(path, method = 'GET', body, csrf, binary = false) {
    const response = await fetchImpl(path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': binary ? body.type : 'application/json', 'X-CSRF-Token': csrf } : {}) },
      ...(body ? { body: binary ? body : JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'server_error'), { status: response.status });
    return data;
  }
  async function refresh() {
    if (state.busy) return state;
    const ticket = ++revision;
    try {
      const data = await request('/api/auth/session');
      if (ticket === revision) {
        csrfToken = data.csrfToken;
        const changed = state.user?.id !== data.user?.id;
        if (changed) securityGeneration++;
        publish({ user: data.user, status: data.user ? 'authenticated' : 'guest', error: null,
          capabilities: data.capabilities || state.capabilities,
          ...(changed ? { security: null, securityStatus: 'idle' } : {}) });
      }
    } catch {
      if (ticket === revision) publish({ user: null, status: 'unavailable', error: 'auth_unavailable', security: null, securityStatus: 'idle' });
    }
    return state;
  }
  async function mutate(path, method, body, binary = false) {
    if (state.busy) return null;
    const ticket = ++revision;
    securityGeneration++;
    const interruptedSecurityRead = state.securityStatus === 'loading';
    publish({ busy: true, error: null,
      ...(interruptedSecurityRead ? { securityStatus: state.security ? 'ready' : 'idle' } : {}) });
    try {
      if (!csrfToken) csrfToken = (await request('/api/auth/csrf')).csrfToken;
      const data = await request(path, method, body, csrfToken, binary);
      if (ticket !== revision) return null;
      if (Object.hasOwn(data, 'csrfToken')) csrfToken = data.csrfToken;
      const user = Object.hasOwn(data, 'user') ? data.user : state.user;
      publish({ user, status: user ? 'authenticated' : 'guest', busy: false, error: null,
        capabilities: data.capabilities || state.capabilities,
        ...(!user || state.user?.id !== user?.id ? { security: null, securityStatus: 'idle' } : {}) });
      return data;
    } catch (error) {
      if (ticket === revision) {
        if (error.message === 'csrf_failed') csrfToken = null;
        const expired = error.message === 'authentication_required';
        if (expired) csrfToken = null;
        publish({ busy: false, error: error.status ? error.message : 'network_error',
          ...(interruptedSecurityRead ? { securityStatus: 'error' } : {}),
          ...(expired ? { user: null, status: 'guest', security: null, securityStatus: 'idle' } : {}) });
      }
      throw error;
    }
  }
  async function loadSecurity() {
    if (!state.user || state.busy) return null;
    const ticket = securityGeneration;
    const requestId = ++securityRequest;
    const userId = state.user.id;
    publish({ securityStatus: 'loading' });
    try {
      const data = await request('/api/account/security');
      if (ticket === securityGeneration && requestId === securityRequest && state.user?.id === userId) publish({ security: data, securityStatus: 'ready' });
      return data;
    } catch (error) {
      if (ticket === securityGeneration && requestId === securityRequest && state.user?.id === userId) {
        if (error.message === 'authentication_required') {
          csrfToken = null;
          publish({ user: null, status: 'guest', security: null, securityStatus: 'idle', error: error.message });
        } else publish({ securityStatus: 'error' });
      }
      return null;
    }
  }
  /**
   * Zápis mimo panela účtu (sledované lety, 2026-09-27): bez globálneho `busy` — klik na
   * glóbuse nesmie zablokovať formuláre v paneli ani sa stratiť, keď panel práve pracuje.
   * Vypršaná session prepne stav na hosťa rovnako ako mutate().
   */
  async function write(path, method, body) {
    try {
      if (!csrfToken) csrfToken = (await request('/api/auth/csrf')).csrfToken;
      return await request(path, method, body, csrfToken);
    } catch (error) {
      if (error.message === 'csrf_failed') csrfToken = null;
      if (error.message === 'authentication_required' && state.user) {
        csrfToken = null; revision++; securityGeneration++;
        publish({ user: null, status: 'guest', security: null, securityStatus: 'idle', error: error.message });
      }
      throw error;
    }
  }
  async function exportAccount() {
    const ticket = revision;
    const userId = state.user?.id;
    try { return await request('/api/account/export'); }
    catch (error) {
      if (error.message === 'authentication_required' && ticket === revision && userId === state.user?.id) {
        revision++; securityGeneration++; csrfToken = null;
        publish({ user: null, status: 'guest', busy: false, security: null, securityStatus: 'idle', error: error.message });
      }
      throw error;
    }
  }
  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    refresh,
    loadSecurity,
    register: data => mutate('/api/auth/register', 'POST', data),
    login: data => mutate('/api/auth/login', 'POST', data),
    logout: () => mutate('/api/auth/logout', 'POST', {}),
    updateProfile: data => mutate('/api/account', 'PATCH', typeof data === 'string' ? { displayName: data } : data),
    uploadPhoto: file => mutate('/api/account/photo', 'PUT', file, true),
    removePhoto: () => mutate('/api/account/photo', 'DELETE', {}),
    changePassword: data => mutate('/api/account/password', 'POST', data),
    revokeSession: id => mutate('/api/account/sessions/revoke', 'POST', { id }),
    revokeOthers: () => mutate('/api/account/sessions/revoke-others', 'POST', {}),
    requestVerification: () => mutate('/api/account/verification', 'POST', {}),
    requestEmailChange: data => mutate('/api/account/email', 'POST', data),
    forgotPassword: email => mutate('/api/auth/forgot-password', 'POST', { email }),
    resetPassword: data => mutate('/api/auth/reset-password', 'POST', data),
    verifyEmail: token => mutate('/api/auth/verify-email', 'POST', { token }),
    confirmEmailChange: token => mutate('/api/auth/confirm-email', 'POST', { token }),
    exportAccount,
    follows: () => request('/api/account/follows'),
    follow: data => write('/api/account/follows', 'POST', data),
    unfollow: key => write('/api/account/follows', 'DELETE', { key }),
  };
}
