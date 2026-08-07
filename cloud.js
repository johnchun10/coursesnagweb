// CourseSnag account and cloud-watchlist client
(function() {
  'use strict';

  const config = window.COURSESNAG_CONFIG || {};
  const CREDENTIAL_KEY = 'csw.googleCredential';
  const TOMBSTONE_KEY = 'csw.cloudTombstones';
  const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

  const state = {
    mode: 'checking',
    credential: null,
    user: null,
    syncing: false,
    initialized: false,
    googleReady: false,
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

  function decodeCredential(credential) {
    try {
      const payload = credential.split('.')[1];
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function publicState() {
    return {
      mode: state.mode,
      signedIn: Boolean(state.credential),
      syncing: state.syncing
    };
  }

  function announceState() {
    window.dispatchEvent(new CustomEvent('coursesnag:cloud-state', {
      detail: publicState()
    }));
  }

  function credentialIsUsable(credential) {
    const claims = decodeCredential(credential);
    if (!claims) return false;
    if (claims.aud !== config.googleClientId) return false;
    return Number(claims.exp || 0) * 1000 > Date.now() + 60_000;
  }

  function restoreCredential() {
    const stored = sessionStorage.getItem(CREDENTIAL_KEY);
    if (!stored || !credentialIsUsable(stored)) {
      sessionStorage.removeItem(CREDENTIAL_KEY);
      return;
    }
    state.credential = stored;
    state.user = decodeCredential(stored);
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
    const signedIn = Boolean(state.credential && state.user);
    state.els.signInWrap.hidden = signedIn;
    state.els.profile.hidden = !signedIn;
    state.els.signOutButton.hidden = !signedIn;

    if (!signedIn) {
      state.els.profileName.textContent = '';
      state.els.profileEmail.textContent = '';
      state.els.avatar.removeAttribute('src');
      if (!state.syncing) setSyncStatus('');
      announceState();
      return;
    }

    state.els.profileName.textContent = state.user.name || 'Google account';
    state.els.profileEmail.textContent = state.user.email || '';
    if (state.user.picture) {
      state.els.avatar.src = state.user.picture;
      state.els.avatar.alt = '';
    } else {
      state.els.avatar.removeAttribute('src');
    }
    announceState();
  }

  async function publicFetch(path) {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`Cloud service returned HTTP ${response.status}`);
    return response.json();
  }

  async function cloudFetch(path, options = {}) {
    if (!state.credential) throw new Error('Sign in is required.');
    const headers = {
      accept: 'application/json',
      authorization: `Bearer ${state.credential}`,
      ...(options.headers || {})
    };
    if (options.body) headers['content-type'] = 'application/json';

    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...options,
      headers
    });

    if (response.status === 401) {
      signOut('Your Google session expired. Sign in again to sync.');
      throw new Error('Google session expired.');
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
    if (!state.credential || !state.adapter || state.syncing) return;
    state.syncing = true;
    announceState();
    setSyncStatus('Synchronizing local and cloud watchlists…', 'working');

    try {
      await cloudFetch('/me', { method: 'PUT' });
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
      const localTrackers = state.adapter.getLocalTrackers();
      for (const tracker of localTrackers) {
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

  async function acceptGoogleCredential(response) {
    if (!credentialIsUsable(response.credential)) {
      setSyncStatus('Google returned an unusable sign-in response.', 'error');
      return;
    }
    state.credential = response.credential;
    state.user = decodeCredential(response.credential);
    sessionStorage.setItem(CREDENTIAL_KEY, response.credential);
    renderAccount();
    await syncNow();
  }

  function signOut(message = 'Signed out.') {
    state.credential = null;
    state.user = null;
    sessionStorage.removeItem(CREDENTIAL_KEY);
    if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
    renderAccount();
    setSyncStatus(message);
    renderGoogleButton();
  }

  function renderGoogleButton() {
    if (!state.googleReady || state.credential || !state.els.googleButton) return;
    state.els.googleButton.replaceChildren();
    window.google.accounts.id.renderButton(state.els.googleButton, {
      type: 'standard',
      theme: 'outline',
      size: 'medium',
      shape: 'rectangular',
      text: 'signin_with',
      logo_alignment: 'left',
      width: 210
    });
  }

  async function setupGoogleIdentity() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (window.google?.accounts?.id) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!window.google?.accounts?.id) {
      setSyncStatus('Google Sign-In unavailable.', 'error');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: acceptGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    state.googleReady = true;
    renderGoogleButton();
  }

  async function trackerAdded(tracker) {
    const id = trackerId(tracker);
    const tombstones = loadTombstones();
    delete tombstones[id];
    saveTombstones(tombstones);

    if (!state.credential) return;
    try {
      setSyncStatus('Saving new tracker to your account…', 'working');
      await uploadTracker(tracker);
      setSyncStatus(`Saved ${tracker.subject} ${tracker.catalogNbr || tracker.classNbr} to your account.`, 'success');
    } catch (error) {
      setSyncStatus(error.message, 'error');
    }
  }

  async function trackerRemoved(tracker) {
    const id = trackerId(tracker);
    const tombstones = loadTombstones();
    tombstones[id] = Date.now();
    saveTombstones(tombstones);

    if (!state.credential) return;
    try {
      setSyncStatus('Removing tracker from your account…', 'working');
      await deleteCloudTracker(id);
      delete tombstones[id];
      saveTombstones(tombstones);
      setSyncStatus('Tracker removed locally and from your account.', 'success');
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
      signInWrap: document.getElementById('cloud-signin-wrap'),
      googleButton: document.getElementById('google-signin-button'),
      profile: document.getElementById('cloud-profile'),
      profileName: document.getElementById('cloud-profile-name'),
      profileEmail: document.getElementById('cloud-profile-email'),
      avatar: document.getElementById('cloud-avatar'),
      signOutButton: document.getElementById('cloud-signout-btn')
    };

    state.els.signOutButton.addEventListener('click', () => signOut());
    restoreCredential();
    renderMode();
    renderAccount();

    await Promise.all([fetchMode(), setupGoogleIdentity()]);
    if (state.credential) await syncNow();
  }

  window.CourseSnagCloud = {
    initialize,
    syncNow,
    trackerAdded,
    trackerRemoved,
    getState: publicState
  };
})();
