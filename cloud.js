// CourseSnag Discord account and cloud-watchlist client
(function() {
  'use strict';

  const config = window.COURSESNAG_CONFIG || {};
  const SESSION_KEY = 'csw.discordSession';
  const LEGACY_GOOGLE_KEY = 'csw.googleCredential';
  const TOMBSTONE_KEY = 'csw.cloudTombstones';
  const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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

  function loadTombstones() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || '{}');
      const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
      return Object.fromEntries(
        Object.entries(parsed).filter(([, deletedAt]) => Number(deletedAt) >= cutoff)
      );
    } catch {
      return {};
    }
  }

  function saveTombstones(tombstones) {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
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
      state.els.modeTitle.textContent = 'Cloud Active';
      state.els.modeDescription.textContent = 'Monitoring enabled';
    } else if (mode === 'unavailable') {
      state.els.modeTitle.textContent = 'Unavailable';
      state.els.modeDescription.textContent = 'Monitoring status unavailable';
    } else if (mode === 'checking') {
      state.els.modeTitle.textContent = 'Checking status';
      state.els.modeDescription.textContent = 'Checking monitoring';
    } else {
      state.els.modeTitle.textContent = 'Local Standby';
      state.els.modeDescription.textContent = 'Monitoring paused';
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
        ? `@${discord.username} · Watchlist sync and direct messages enabled`
        : 'Watchlist sync and direct messages enabled';
    } else if (hasSession) {
      state.els.discordProfileName.textContent = 'Checking account';
      state.els.discordProfileDetail.textContent = 'Restoring your Discord session';
    } else {
      state.els.discordProfileName.textContent = 'Not connected';
      state.els.discordProfileDetail.textContent = 'Discord saves your watchlist and receives alerts';
    }

    state.els.discordButton.hidden = hasSession;
    state.els.discordButton.textContent = state.discordBusy
      ? 'Opening Discord…'
      : 'Continue with Discord';
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
      clearSession('Discord session expired. Connect again.');
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
    setSyncStatus('Synchronizing local and cloud watchlists…', 'working');

    try {
      const profilePayload = await cloudFetch('/me');
      state.profile = profilePayload.profile;
      renderAccount();

      const cloudPayload = await cloudFetch('/trackers');
      const tombstones = loadTombstones();
      const retainedCloud = [];

      for (const tracker of cloudPayload.trackers || []) {
        const id = tracker.trackerId || trackerId(tracker);
        if (tombstones[id]) {
          await deleteCloudTracker(id);
          delete tombstones[id];
        } else {
          retainedCloud.push(tracker);
        }
      }
      saveTombstones(tombstones);

      state.adapter.mergeCloudTrackers(retainedCloud);
      for (const tracker of state.adapter.getLocalTrackers()) {
        await uploadTracker(tracker);
      }

      setSyncStatus('Watchlist up to date.', 'success');
    } catch (error) {
      console.error('Cloud synchronization failed:', error);
      setSyncStatus(error.message, 'error');
    } finally {
      state.syncing = false;
      announceState();
    }
  }

  async function restoreProfile() {
    if (!state.sessionToken) return;
    try {
      const payload = await cloudFetch('/me');
      state.profile = payload.profile;
      renderAccount();
    } catch (error) {
      console.warn('Discord profile restoration failed:', error);
      setSyncStatus(error.message, 'error');
    }
  }

  async function startDiscordSignIn() {
    if (state.discordBusy || state.sessionToken) return;
    state.discordBusy = true;
    renderAccount();
    setSyncStatus('Opening Discord authorization…', 'working');

    try {
      const payload = await publicFetch('/auth/discord', { method: 'POST' });
      if (!payload?.authorizationUrl) throw new Error('Discord authorization could not be started.');
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
    try {
      if (result === 'connected') {
        if (!code) throw new Error('Discord login response was incomplete.');
        setSyncStatus('Finishing Discord sign-in…', 'working');
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
        setSyncStatus('Discord connected. Syncing your watchlist…', 'success');
        await syncNow();
      } else if (result === 'cancelled') {
        setSyncStatus('Discord sign-in cancelled.');
      } else {
        throw new Error('Discord could not be connected. Try again.');
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
    const id = trackerId(tracker);
    const tombstones = loadTombstones();
    delete tombstones[id];
    saveTombstones(tombstones);

    if (state.mode !== 'cloud' || !state.sessionToken) return;
    try {
      setSyncStatus('Saving tracker to your Discord account…', 'working');
      await uploadTracker(tracker);
      setSyncStatus(`Tracking ${tracker.subject} ${tracker.catalogNbr || tracker.classNbr} in the cloud.`, 'success');
    } catch (error) {
      setSyncStatus(error.message, 'error');
    }
  }

  async function trackerRemoved(tracker) {
    const id = trackerId(tracker);
    const tombstones = loadTombstones();
    tombstones[id] = Date.now();
    saveTombstones(tombstones);

    if (state.mode !== 'cloud' || !state.sessionToken) return;
    try {
      setSyncStatus('Removing tracker from your Discord account…', 'working');
      await deleteCloudTracker(id);
      delete tombstones[id];
      saveTombstones(tombstones);
      setSyncStatus('Tracker removed from this browser and the cloud.', 'success');
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
      discordButton: document.getElementById('discord-connect-btn')
    };

    state.els.signOutButton.addEventListener('click', signOut);
    state.els.discordButton.addEventListener('click', startDiscordSignIn);
    restoreSession();
    renderMode();
    renderAccount();

    await fetchMode();
    const handledReturn = await handleDiscordReturn();
    if (!handledReturn && state.sessionToken) {
      if (state.mode === 'cloud') await syncNow();
      else await restoreProfile();
    }
  }

  window.CourseSnagCloud = {
    initialize,
    syncNow,
    trackerAdded,
    trackerRemoved,
    getState: publicState
  };
})();
