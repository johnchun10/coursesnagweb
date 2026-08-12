// CourseSnag Discord account and cloud-watchlist client
(function() {
  'use strict';

  const config = window.COURSESNAG_CONFIG || {};
  const SESSION_KEY = 'csw.discordSession';
  const LEGACY_GOOGLE_KEY = 'csw.googleCredential';

  const state = {
    mode: 'checking',
    sessionToken: null,
    profile: null,
    syncing: false,
    discordBusy: false,
    initialized: false,
    adapter: null,
    els: {}
  };

  function trackerId(tracker) {
    return `${tracker.roster}:${String(tracker.classNbr)}`;
  }

  function isSignedIn() {
    return Boolean(state.sessionToken && state.profile?.discordConnected);
  }

  function publicState() {
    return {
      mode: state.mode,
      signedIn: isSignedIn(),
      syncing: state.syncing,
      discordConnected: isSignedIn()
    };
  }

  function announceState() {
    window.dispatchEvent(new CustomEvent('coursesnag:cloud-state', {
      detail: publicState()
    }));
  }

  function setSyncStatus(message, type = '') {
    if (!state.els.syncStatus) return;
    state.els.syncStatus.textContent = message;
    state.els.syncStatus.className = `cloud-sync-status${type ? ` ${type}` : ''}`;
  }

  function renderMode() {
    const mode = state.mode;
    state.els.modeBadge.dataset.mode = mode;

    if (mode === 'cloud') {
      state.els.modeTitle.textContent = 'Cloud active';
      state.els.modeDescription.textContent = 'Monitoring is enabled.';
    } else if (mode === 'unavailable') {
      state.els.modeTitle.textContent = 'Cloud unavailable';
      state.els.modeDescription.textContent = 'Monitoring status is unavailable.';
    } else if (mode === 'checking') {
      state.els.modeTitle.textContent = 'Checking cloud status';
      state.els.modeDescription.textContent = 'Checking monitoring status.';
    } else {
      state.els.modeTitle.textContent = 'Cloud inactive';
      state.els.modeDescription.textContent = 'Monitoring is paused.';
    }
    announceState();
  }

  function renderAccount() {
    const hasSession = Boolean(state.sessionToken);
    const connected = isSignedIn();
    const discord = state.profile?.discord;

    if (connected) {
      state.els.discordProfileName.textContent = discord?.displayName || 'Discord connected';
      state.els.discordProfileDetail.textContent = discord?.username
        ? `@${discord.username}`
        : 'Discord is connected.';
    } else if (hasSession) {
      state.els.discordProfileName.textContent = 'Restoring Discord session';
      state.els.discordProfileDetail.textContent = 'Checking the saved session.';
    } else {
      state.els.discordProfileName.textContent = 'Discord is not connected';
      state.els.discordProfileDetail.textContent = 'Connect Discord to synchronize the cloud watchlist and receive alerts.';
    }
    if (state.els.discordProfile) {
      state.els.discordProfile.hidden = !hasSession;
    }
    state.els.discordButton.hidden = hasSession;
    state.els.discordButton.textContent = state.discordBusy
      ? 'Opening Discord…'
      : 'Connect Discord and add bot';
    state.els.discordButton.disabled = state.discordBusy;
    state.els.signOutButton.hidden = !hasSession;
    state.els.signOutButton.disabled = state.discordBusy;
    announceState();
  }

  function restoreSession() {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored && /^[A-Za-z0-9_-]{32,}$/.test(stored)) {
      state.sessionToken = stored;
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
    sessionStorage.removeItem(LEGACY_GOOGLE_KEY);
  }

  function clearSession(message = '') {
    state.sessionToken = null;
    state.profile = null;
    localStorage.removeItem(SESSION_KEY);
    renderAccount();
    if (message) setSyncStatus(message);
  }

  async function request(path, options = {}, authenticated = false) {
    const headers = {
      accept: 'application/json',
      ...(options.headers || {})
    };
    if (authenticated) {
      if (!state.sessionToken) throw new Error('Connect Discord to use cloud tracking.');
      headers.authorization = `Bearer ${state.sessionToken}`;
    }
    if (options.body) headers['content-type'] = 'application/json';

    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...options,
      headers
    });

    if (authenticated && response.status === 401) {
      clearSession('The Discord session expired. Connect Discord again.');
      throw new Error('Discord session expired.');
    }
    if (!response.ok) {
      let message = `Cloud service returned HTTP ${response.status}`;
      try {
        const payload = await response.json();
        if (payload.error) message = payload.error;
      } catch {
        // Keep the HTTP status message.
      }
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function publicFetch(path, options = {}) {
    return request(path, options, false);
  }

  function cloudFetch(path, options = {}) {
    return request(path, options, true);
  }

  async function fetchMode() {
    state.mode = 'checking';
    renderMode();
    try {
      const payload = await publicFetch('/mode');
      state.mode = payload.mode === 'cloud' ? 'cloud' : 'local';
    } catch (error) {
      console.warn('Cloud mode check failed:', error);
      state.mode = 'unavailable';
    }
    renderMode();
  }

  async function deleteCloudTracker(id) {
    await cloudFetch(`/trackers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function uploadTracker(tracker) {
    return cloudFetch('/trackers', {
      method: 'POST',
      body: JSON.stringify({
        roster: tracker.roster,
        subject: tracker.subject,
        classNbr: String(tracker.classNbr),
        catalogNbr: tracker.catalogNbr || '',
        title: tracker.title || '',
        section: tracker.section || '',
        ssrComponent: tracker.ssrComponent || '',
        classTime: tracker.classTime || ''
      })
    });
  }

  async function syncNow() {
    if (state.mode !== 'cloud' || !state.sessionToken || !state.adapter || state.syncing) return;
    state.syncing = true;
    announceState();
    setSyncStatus('Loading your cloud watchlist…', 'working');

    try {
      const profilePayload = await cloudFetch('/me');
      state.profile = profilePayload.profile;
      renderAccount();

      const cloudPayload = await cloudFetch('/trackers');
      state.adapter.replaceLocalTrackers(cloudPayload.trackers || []);
      setSyncStatus('Cloud watchlist loaded.', 'success');
    } catch (error) {
      console.error('Cloud synchronization failed:', error);
      setSyncStatus(error.message, 'error');
    } finally {
      state.syncing = false;
      announceState();
    }
  }

  async function startDiscordSignIn() {
    if (state.discordBusy || state.sessionToken) return;
    state.discordBusy = true;
    renderAccount();
    setSyncStatus('Opening Discord authorization…', 'working');

    try {
      const payload = await publicFetch('/auth/discord', {
        method: 'POST',
        body: JSON.stringify({ returnOrigin: window.location.origin })
      });
      if (!payload?.authorizationUrl) throw new Error('Could not start Discord authorization.');
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      console.error('Discord sign-in failed:', error);
      setSyncStatus(error.message, 'error');
      state.discordBusy = false;
      renderAccount();
    }
  }

  async function signOut() {
    if (state.discordBusy) return;
    state.discordBusy = true;
    renderAccount();
    try {
      if (state.sessionToken) await cloudFetch('/session', { method: 'DELETE' });
    } catch (error) {
      console.warn('Cloud session revocation failed:', error);
    } finally {
      state.discordBusy = false;
      clearSession('Signed out. Your browser watchlist remains on this device.');
    }
  }

  async function handleDiscordReturn() {
    const current = new URL(window.location.href);
    const result = current.searchParams.get('discord');
    const code = current.searchParams.get('code');
    if (!result) return false;

    current.searchParams.delete('discord');
    current.searchParams.delete('code');
    window.history.replaceState({}, '', `${current.pathname}${current.search}${current.hash}`);

    let finalResult = result;
    renderAccount();
    try {
      if (result === 'connected') {
        if (!code) throw new Error('Discord login response was incomplete.');
        setSyncStatus('Completing Discord sign-in…', 'working');
        const payload = await publicFetch('/auth/session', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        if (!payload?.sessionToken || !payload?.profile) {
          throw new Error('Discord login response was incomplete.');
        }
        state.sessionToken = payload.sessionToken;
        state.profile = payload.profile;
        localStorage.setItem(SESSION_KEY, payload.sessionToken);
        renderAccount();
        setSyncStatus('Discord connected. Loading your cloud watchlist…', 'success');
        await syncNow();
      } else if (result === 'cancelled') {
        renderAccount();
        setSyncStatus('Discord sign-in was canceled.');
      } else if (result === 'delivery-unavailable') {
        finalResult = result;
        clearSession();
        setSyncStatus(
          'Discord blocked the confirmation direct message. Enable direct messages from server members, and then try again.',
          'error'
        );
      } else {
        throw new Error('Could not connect Discord. Try again.');
      }
    } catch (error) {
      finalResult = 'error';
      clearSession();
      setSyncStatus(error.message, 'error');
    }

    window.dispatchEvent(new CustomEvent('coursesnag:discord-return', {
      detail: { result: finalResult }
    }));
    return true;
  }

  async function trackerAdded(tracker) {
    if (state.mode !== 'cloud' || !state.sessionToken) return;
    try {
      setSyncStatus('Adding the section to the cloud watchlist…', 'working');
      await uploadTracker(tracker);
      setSyncStatus(`${tracker.subject} ${tracker.catalogNbr || tracker.classNbr} was added to the cloud watchlist.`, 'success');
    } catch (error) {
      setSyncStatus(error.message, 'error');
    }
  }

  async function trackerRemoved(tracker) {
    const id = trackerId(tracker);
    if (state.mode !== 'cloud' || !state.sessionToken) return;
    try {
      setSyncStatus('Removing the section from the cloud watchlist…', 'working');
      await deleteCloudTracker(id);
      setSyncStatus('The section was removed from the browser and cloud watchlists.', 'success');
    } catch (error) {
      setSyncStatus(error.message, 'error');
    }
  }

  async function initialize(adapter) {
    if (state.initialized) return;
    state.initialized = true;
    state.adapter = adapter;
    state.els = {
      modeBadge: document.getElementById('cloud-mode-badge'),
      modeTitle: document.getElementById('cloud-mode-title'),
      modeDescription: document.getElementById('cloud-mode-description'),
      syncStatus: document.getElementById('cloud-sync-status'),
      signOutButton: document.getElementById('cloud-signout-btn'),
      discordProfileName: document.getElementById('discord-profile-name'),
      discordProfileDetail: document.getElementById('discord-profile-detail'),
      discordProfile: document.getElementById('discord-profile'),
      discordButton: document.getElementById('discord-connect-btn')
    };

    state.els.signOutButton.addEventListener('click', signOut);
    state.els.discordButton.addEventListener('click', startDiscordSignIn);
    restoreSession();
    renderMode();
    renderAccount();

    const shouldCheckMode = state.adapter?.initialAlertMode !== 'local'
      || state.adapter?.cloudSetupRequested;
    if (shouldCheckMode) {
      await fetchMode();
    } else {
      state.mode = 'local';
      renderMode();
    }
    const handledReturn = await handleDiscordReturn();
    if (!handledReturn && state.sessionToken && state.mode === 'cloud') {
      await syncNow();
    }
  }

  window.CourseSnagCloud = {
    initialize,
    syncNow,
    trackerAdded,
    trackerRemoved,
    refreshMode: fetchMode,
    getState: publicState
  };
})();
