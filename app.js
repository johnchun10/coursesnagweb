// CourseSnag - Main Application

(function() {
  'use strict';

  // ============================================
  // Configuration
  // ============================================
  const API_BASE = 'https://classes.cornell.edu/api/2.0';
  const STORAGE_PREFIX = 'csw.';
  const DEBOUNCE_DELAY_MS = 400;
  const RATE_LIMIT_MS = 1000; // 1 request per second
  const POLLING_OPTIONS = [300, 600, 900, 1200];
  const DEFAULT_POLLING_INTERVAL_SEC = 300;

  // ============================================
  // State
  // ============================================
  const state = {
    rosters: [],
    subjectSet: new Set(),
    currentRoster: null,
    // Cache for subject classes (avoid re-fetching when typing numbers)
    cachedSubject: null,
    cachedClasses: [],
    // Filtered results displayed to user
    searchResults: [],
    trackedSections: [],
    trackedKeySet: new Set(),
    expandedCourses: new Set(),
    lastRequestTime: 0,
    requestQueue: Promise.resolve(),
    pollingTimer: null,
    searchDebounceTimer: null,
    searchAbortController: null,
    isSearching: false,
    isRefreshing: false,
    searchRequestSeq: 0,
    // Error states
    initError: null,
    searchError: null,
    // Settings
    soundEnabled: false,
    notifyEnabled: false,
    pollingIntervalSec: DEFAULT_POLLING_INTERVAL_SEC,
    alertMode: null,
    pendingAlertMode: null,
    settingsView: 'choice',
    // Alert state
    isAlerting: false,
    alertAudioContext: null,
    alertSource: null
  };

  // ============================================
  // DOM Elements
  // ============================================
  const els = {
    rosterLabel: document.getElementById('roster-label'),
    searchInput: document.getElementById('search-input'),
    refreshBtn: document.getElementById('refresh-btn'),
    lastUpdated: document.getElementById('last-updated'),
    searchStatus: document.getElementById('search-status'),
    searchResults: document.getElementById('search-results'),
    searchPanel: document.querySelector('.search-panel'),
    trackedStatus: document.getElementById('tracked-status'),
    trackedList: document.getElementById('tracked-list'),
    tabOpenNotice: document.getElementById('tab-open-notice'),
    tabOpenNoticeText: document.getElementById('tab-open-notice-text'),
    // Settings elements
    soundToggle: document.getElementById('sound-toggle'),
    testSoundBtn: document.getElementById('test-sound-btn'),
    notifyToggle: document.getElementById('notify-toggle'),
    testNotifyBtn: document.getElementById('test-notify-btn'),
    notifyStatus: document.getElementById('notify-status'),
    pollingSegmented: document.getElementById('polling-segmented'),
    settingsButton: document.getElementById('settings-btn'),
    settingsDialog: document.getElementById('settings-dialog'),
    settingsCloseButton: document.getElementById('settings-close-btn'),
    settingsDoneButton: document.getElementById('settings-done-btn'),
    settingsEyebrow: document.getElementById('settings-eyebrow'),
    settingsTitle: document.getElementById('settings-title'),
    settingsFooterNote: document.getElementById('settings-footer-note'),
    modeChoiceView: document.getElementById('mode-choice-view'),
    localSettingsView: document.getElementById('local-settings-view'),
    cloudSettingsView: document.getElementById('cloud-settings-view'),
    chooseLocalMode: document.getElementById('choose-local-mode'),
    chooseCloudMode: document.getElementById('choose-cloud-mode'),
    cloudOptionStatus: document.getElementById('cloud-option-status'),
    cloudOptionStatusText: document.getElementById('cloud-option-status-text'),
    cloudOptionAction: document.getElementById('cloud-option-action'),
    cloudAccountPanel: document.querySelector('.discord-cloud-account'),
    modeCurrentLabels: document.querySelectorAll('[data-current-mode]'),
    // Alert elements
    alertBanner: document.getElementById('alert-banner')
  };

  // Track dismissed alerts (class numbers dismissed for 5 minutes)
  // Stored in localStorage with expiration timestamp
  const dismissedAlerts = new Map();
  const courseSectionsCache = new WeakMap();

  function loadDismissedAlerts() {
    const stored = loadFromStorage('dismissedAlerts', {});
    const now = Date.now();
    for (const [key, expirationTime] of Object.entries(stored)) {
      // Only restore if not expired
      if (expirationTime > now) {
        dismissedAlerts.set(key, expirationTime);
      }
    }
  }

  function saveDismissedAlerts() {
    const obj = {};
    for (const [key, expirationTime] of dismissedAlerts.entries()) {
      obj[key] = expirationTime;
    }
    saveToStorage('dismissedAlerts', obj);
  }

  // ============================================
  // Storage Helpers
  // ============================================
  function loadFromStorage(key, defaultValue) {
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch (e) {
      console.error('Storage load error:', e);
      return defaultValue;
    }
  }

  function saveToStorage(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage save error:', e);
    }
  }

  // ============================================
  // Sound Alert System
  // ============================================
  function startAlertSound() {
    if (state.isAlerting) return;

    try {
      state.alertAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      const sampleRate = state.alertAudioContext.sampleRate;
      const loopDuration = 1.2;
      const buffer = state.alertAudioContext.createBuffer(
        1,
        Math.ceil(sampleRate * loopDuration),
        sampleRate
      );
      const samples = buffer.getChannelData(0);
      const beeps = [
        { start: 0.04, duration: 0.18, frequency: 880 },
        { start: 0.32, duration: 0.18, frequency: 660 }
      ];

      // Build a familiar two-beep alarm in a loop, with short fades to avoid clicks.
      for (let index = 0; index < samples.length; index++) {
        const time = index / sampleRate;
        let sample = 0;

        for (const beep of beeps) {
          const elapsed = time - beep.start;
          if (elapsed < 0 || elapsed > beep.duration) continue;

          const attack = Math.min(1, elapsed / 0.012);
          const release = Math.min(1, (beep.duration - elapsed) / 0.035);
          const envelope = Math.max(0, Math.min(attack, release));
          sample += Math.sin(2 * Math.PI * beep.frequency * elapsed) * envelope;
        }

        samples[index] = sample * 0.16;
      }

      state.alertSource = state.alertAudioContext.createBufferSource();
      state.alertSource.buffer = buffer;
      state.alertSource.loop = true;
      state.alertSource.connect(state.alertAudioContext.destination);
      state.alertSource.start();
      state.isAlerting = true;
    } catch (e) {
      console.error('Failed to start alert sound:', e);
    }
  }

  function stopAlertSound() {
    if (!state.isAlerting) return;

    try {
      if (state.alertSource) {
        state.alertSource.stop();
        state.alertSource.disconnect();
        state.alertSource = null;
      }
      if (state.alertAudioContext) {
        state.alertAudioContext.close();
        state.alertAudioContext = null;
      }
    } catch (e) {
      console.error('Failed to stop alert sound:', e);
    }

    state.isAlerting = false;
  }

  // ============================================
  // Browser Notifications
  // ============================================
  function isMobileBrowser() {
    const ua = navigator.userAgent || '';
    const uaDataMobile =
      typeof navigator.userAgentData === 'object' &&
      typeof navigator.userAgentData.mobile === 'boolean'
        ? navigator.userAgentData.mobile
        : false;

    return (
      uaDataMobile ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)
    );
  }

  function hasNotificationSupport() {
    return !isMobileBrowser() && 'Notification' in window;
  }

  function updateNotifyStatus() {
    if (!hasNotificationSupport()) {
      els.notifyStatus.textContent = isMobileBrowser()
        ? '(Unavailable on mobile)'
        : '(Not supported)';
      els.notifyStatus.className = 'notify-status denied';
      els.notifyToggle.disabled = true;
      els.testNotifyBtn.disabled = true;
      return;
    }

    els.notifyToggle.disabled = false;
    els.testNotifyBtn.disabled = false;

    const permission = Notification.permission;
    if (permission === 'granted') {
      els.notifyStatus.textContent = '(Enabled)';
      els.notifyStatus.className = 'notify-status granted';
    } else if (permission === 'denied') {
      els.notifyStatus.textContent = '(Blocked)';
      els.notifyStatus.className = 'notify-status denied';
    } else {
      els.notifyStatus.textContent = '(Select to enable)';
      els.notifyStatus.className = 'notify-status';
    }
  }

  async function requestNotificationPermission() {
    if (!hasNotificationSupport()) return false;

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      updateNotifyStatus();
      return permission === 'granted';
    }

    return false;
  }

  function showNotification(title, body) {
    if (!state.notifyEnabled) return;
    if (!hasNotificationSupport()) return;
    if (Notification.permission !== 'granted') return;

    try {
      new Notification(title, {
        body,
        icon: 'favicon-cornell-32.png?v=3',
        tag: 'coursesnag-alert',
        requireInteraction: true
      });
    } catch (e) {
      console.error('Failed to show notification:', e);
    }
  }

  // ============================================
  // Alert Trigger
  // ============================================
  function triggerOpenAlert(openedSections) {
    if (openedSections.length === 0) return;
    const actionableSections = [];

    // For each opened section, show alert over it
    for (const item of openedSections) {
      const trackedKey = `${item.roster}:${item.classNbr}`;
      if (!state.trackedKeySet.has(trackedKey)) {
        continue;
      }

      // Skip if already dismissed for 5 minutes
      if (isAlertDismissed(trackedKey)) {
        continue;
      }

      // Find the corresponding tracked item element
      const trackedElement = document.querySelector(
        `[data-tracked-key="${trackedKey}"]`
      );

      if (trackedElement) {
        // Show alert over this item
        showAlertOverItem(item, trackedElement, trackedKey);
        actionableSections.push(item);
      }
    }

    // Play sound once if any alerts shown
    if (actionableSections.length > 0 && state.soundEnabled) {
      startAlertSound();
    }

    // Show notification if enabled
    if (actionableSections.length > 0 && state.notifyEnabled) {
      const names = actionableSections
        .map(s => `${s.subject} ${s.catalogNbr}`);
      const message = names.length === 1
        ? `${names[0]} is open.`
        : `${names.length} sections are open.`;
      showNotification('CourseSnag alert', message);
    }
  }

  function showAlertOverItem(item, element, trackedKey) {
    const existingAlert = document.getElementById(`alert-${trackedKey}`);
    if (existingAlert) return;

    // Clone the alert banner and attach it to the tracked item
    const alertClone = els.alertBanner.cloneNode(true);
    alertClone.id = `alert-${trackedKey}`;
    alertClone.classList.remove('hidden');
    alertClone.dataset.alertKey = trackedKey;

    const messageEl = alertClone.querySelector('#alert-message');
    if (messageEl) {
      messageEl.textContent = `${item.subject} ${item.catalogNbr} ${item.section}`;
      messageEl.removeAttribute('id');
    }

    // Update button handlers for this specific alert
    const dismiss5minBtn = alertClone.querySelector('#dismiss-5min-btn');
    const untrackBtn = alertClone.querySelector('#untrack-alert-btn');

    if (dismiss5minBtn) {
      dismiss5minBtn.removeAttribute('id');
      dismiss5minBtn.onclick = () => {
        dismissAlertFor5Minutes(trackedKey);
        alertClone.remove();
      };
    }

    if (untrackBtn) {
      untrackBtn.removeAttribute('id');
      untrackBtn.onclick = () => {
        untrack(item.classNbr, item.roster);
        alertClone.remove();
      };
    }

    element.appendChild(alertClone);
  }

  function dismissAlertFor5Minutes(trackedKey) {
    const expirationTime = Date.now() + (5 * 60 * 1000); // 5 minutes from now
    dismissedAlerts.set(trackedKey, expirationTime);
    saveDismissedAlerts();

    // Stop alert sound when dismissing
    if (!hasActiveUndismissedOpenAlerts()) {
      stopAlertSound();
    }

  }

  function isAlertDismissed(trackedKey) {
    if (!dismissedAlerts.has(trackedKey)) return false;
    const expirationTime = dismissedAlerts.get(trackedKey);
    if (Date.now() > expirationTime) {
      // Expiration time passed, clear it
      dismissedAlerts.delete(trackedKey);
      saveDismissedAlerts();
      return false;
    }
    return true;
  }

  function hasActiveUndismissedOpenAlerts() {
    return state.trackedSections.some(item => {
      const key = `${item.roster}:${item.classNbr}`;
      return item.lastStatus === 'O' && !isAlertDismissed(key);
    });
  }

  // ============================================
  // Settings Management
  // ============================================
  function loadSettings() {
    const settings = loadFromStorage('settings', {
      soundEnabled: false,
      notifyEnabled: false,
      pollingIntervalSec: DEFAULT_POLLING_INTERVAL_SEC
    });
    state.soundEnabled = Boolean(settings.soundEnabled);
    state.notifyEnabled = Boolean(settings.notifyEnabled);
    if (!hasNotificationSupport()) {
      state.notifyEnabled = false;
    }
    state.pollingIntervalSec = POLLING_OPTIONS.includes(settings.pollingIntervalSec)
      ? settings.pollingIntervalSec
      : DEFAULT_POLLING_INTERVAL_SEC;

    // Update UI
    els.soundToggle.checked = state.soundEnabled;
    els.notifyToggle.checked = state.notifyEnabled;
    updateNotifyStatus();
    updatePollingUI();
  }

  function saveSettings() {
    saveToStorage('settings', {
      soundEnabled: state.soundEnabled,
      notifyEnabled: state.notifyEnabled,
      pollingIntervalSec: state.pollingIntervalSec
    });
  }

  // ============================================
  // Rate-Limited API Fetcher
  // ============================================
  function getUserFriendlyError(error, context) {
    const msg = error.message || '';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return 'Unable to connect. Check your internet connection.';
    }
    if (msg.includes('API error: 404')) {
      return `${context} not found.`;
    }
    if (msg.includes('API error: 429')) {
      return 'Too many requests. Please wait a moment.';
    }
    if (msg.includes('API error: 5')) {
      return 'Cornell server error. Try again later.';
    }
    return msg || 'An unexpected error occurred.';
  }

  function createAbortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }

  function waitFor(delayMs, signal) {
    if (delayMs <= 0) return Promise.resolve();
    if (!signal) return new Promise(resolve => setTimeout(resolve, delayMs));
    if (signal.aborted) return Promise.reject(createAbortError());

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(createAbortError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function rateLimitedFetch(url, { signal } = {}) {
    const task = async () => {
      if (signal?.aborted) throw createAbortError();

      const now = Date.now();
      const timeSinceLast = now - state.lastRequestTime;

      if (timeSinceLast < RATE_LIMIT_MS) {
        await waitFor(RATE_LIMIT_MS - timeSinceLast, signal);
      }

      if (signal?.aborted) throw createAbortError();
      state.lastRequestTime = Date.now();

      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 'success') {
        throw new Error(data.message || 'API returned error status');
      }

      return data.data;
    };

    const taskPromise = state.requestQueue.then(task);
    state.requestQueue = taskPromise.catch(() => {});
    return taskPromise;
  }

  // ============================================
  // API Methods
  // ============================================
  async function fetchRosters() {
    const data = await rateLimitedFetch(`${API_BASE}/config/rosters.json`);
    return data.rosters || [];
  }

  async function fetchSubjects(roster) {
    const data = await rateLimitedFetch(`${API_BASE}/config/subjects.json?roster=${encodeURIComponent(roster)}`);
    return data.subjects || [];
  }

  async function searchClasses(roster, subject, options = {}) {
    const url = `${API_BASE}/search/classes.json?roster=${encodeURIComponent(roster)}&subject=${encodeURIComponent(subject)}&_=${Date.now()}`;
    const data = await rateLimitedFetch(url, options);
    return data.classes || [];
  }

  // ============================================
  // Search Input Parsing
  // ============================================
  function parseSearchInput(input) {
    const trimmed = input.trim().toUpperCase();
    if (!trimmed) return null;

    // Try to match "SUBJECT NUMBER" or "SUBJECT" pattern
    // Examples: "CS 2110", "CS2110", "CS", "MATH 1920", "INFO"
    const match = trimmed.match(/^([A-Z]+)\s*(\d.*)?$/);
    if (!match) return null;

    const subject = match[1];
    const query = match[2] ? match[2].trim() : '';

    // Validate subject exists
    if (!state.subjectSet.has(subject)) {
      return null;
    }

    return { subject, query };
  }

  // ============================================
  // UI Rendering
  // ============================================
  function renderRosterLabel() {
    const roster = state.rosters.find(r => r.slug === state.currentRoster);
    els.rosterLabel.textContent = roster ? roster.descr : state.currentRoster;
  }

  function renderSearchResults() {
    const setEmptyState = (isEmpty) => {
      els.searchResults.classList.toggle('is-empty', isEmpty);
    };

    // Show initialization error
    if (state.initError) {
      setEmptyState(false);
      els.searchResults.innerHTML = `<div class="error-state"><p>${state.initError}</p><button class="btn btn-secondary" onclick="location.reload()">Retry</button></div>`;
      return;
    }

    if (state.isSearching) {
      setEmptyState(true);
      els.searchResults.innerHTML = '<p class="empty-state"><span class="spinner"></span>Searching…</p>';
      return;
    }

    // Show search error
    if (state.searchError) {
      setSearchStatus('');
      setEmptyState(true);
      els.searchResults.innerHTML = `<div class="error-state"><p>${state.searchError}</p></div>`;
      return;
    }

    const parsed = parseSearchInput(els.searchInput.value);
    if (!parsed) {
      setEmptyState(true);
      els.searchResults.innerHTML = '<p class="empty-state">Enter a subject code, such as CS, MATH, or INFO.</p>';
      return;
    }

    if (state.searchResults.length === 0) {
      setEmptyState(true);
      els.searchResults.innerHTML = '<p class="empty-state">No classes found.</p>';
      return;
    }

    setEmptyState(false);
    let html = '';

    for (const course of state.searchResults) {
      const sections = getCourseSections(course);
      if (sections.length === 0) continue;

      const courseId = getCourseId(course);
      const isExpanded = state.expandedCourses.has(courseId);

      html += `
        <div class="course-card ${isExpanded ? 'expanded' : ''}" data-course-id="${escapeAttr(courseId)}">
          <div class="course-header" data-action="toggle-course" data-course-id="${escapeAttr(courseId)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
            <div class="course-header-info">
              <div class="course-title">${escapeHtml(course.titleShort || course.titleLong || 'Untitled course')}</div>
              <div class="course-code">${course.subject} ${course.catalogNbr} (${sections.length} section${sections.length !== 1 ? 's' : ''})</div>
            </div>
            <span class="course-toggle">▼</span>
          </div>
          <div class="sections-list"${isExpanded ? ' data-loaded="true"' : ''}>
            ${isExpanded ? sections.map(sec => renderSectionRow(course, sec)).join('') : ''}
          </div>
        </div>
      `;
    }

    els.searchResults.innerHTML = html || '<p class="empty-state">No sections found.</p>';
  }

  function getCourseId(course) {
    return `${course.subject}-${course.catalogNbr}`;
  }

  function getCourseSections(course) {
    const cachedSections = courseSectionsCache.get(course);
    if (cachedSections) return cachedSections;

    const sections = [];
    for (const eg of (course.enrollGroups || [])) {
      for (const sec of (eg.classSections || [])) {
        sections.push(sec);
      }
    }
    courseSectionsCache.set(course, sections);
    return sections;
  }

  function formatMeetingTimes(meetings) {
    if (!meetings || meetings.length === 0) return '';
    const mtg = meetings[0];
    if (!mtg.timeStart || !mtg.timeEnd) return mtg.pattern ? mtg.pattern : 'TBA';
    return `${mtg.pattern || ''} ${mtg.timeStart} - ${mtg.timeEnd}`.trim();
  }

  function renderSectionRow(course, section) {
    const trackKey = `${state.currentRoster}:${String(section.classNbr)}`;
    const isTracked = state.trackedKeySet.has(trackKey);
    const statusClass = getStatusClass(section.openStatus);
    const statusLabel = getStatusLabel(section.openStatus);
    const classTime = formatMeetingTimes(section.meetings);

    return `
      <div class="section-row">
        <span class="section-number">${section.section}</span>
        <span class="badge badge-component">${section.ssrComponent}</span>
        <span class="badge badge-status ${statusClass}">${statusLabel}</span>
        <span class="section-time" title="${escapeAttr(classTime)}">${escapeHtml(classTime)}</span>
        <div class="section-actions">
          <button
            class="btn btn-small ${isTracked ? 'btn-secondary' : 'btn-primary'}"
            type="button"
            data-action="toggle-track"
            data-class-nbr="${escapeAttr(section.classNbr)}"
            data-subject="${escapeAttr(course.subject)}"
            data-catalog-nbr="${escapeAttr(course.catalogNbr)}"
            data-title="${escapeAttr(course.titleShort || course.titleLong || '')}"
            data-section="${escapeAttr(section.section)}"
            data-ssr-component="${escapeAttr(section.ssrComponent)}"
            data-open-status="${escapeAttr(section.openStatus)}"
            data-class-time="${escapeAttr(classTime)}"
            ${isTracked ? 'disabled' : ''}
          >
            ${isTracked ? 'Tracked' : 'Track'}
          </button>
        </div>
      </div>
    `;
  }

  function syncSearchTrackButtons(classNbr = null) {
    const buttons = els.searchResults.querySelectorAll('button[data-action="toggle-track"]');
    for (const button of buttons) {
      if (classNbr !== null && button.dataset.classNbr !== String(classNbr)) continue;

      const key = `${state.currentRoster}:${String(button.dataset.classNbr)}`;
      const isTracked = state.trackedKeySet.has(key);
      button.classList.toggle('btn-primary', !isTracked);
      button.classList.toggle('btn-secondary', isTracked);
      button.disabled = isTracked;
      button.textContent = isTracked ? 'Tracked' : 'Track';
    }
  }

  function renderTrackedList() {
    updateTabOpenNotice();

    if (state.trackedSections.length === 0) {
      els.trackedList.innerHTML = '<p class="empty-state">No sections are being tracked.</p>';
      return;
    }

    els.trackedList.innerHTML = state.trackedSections.map(item => {
      const statusClass = getStatusClass(item.lastStatus);
      const statusLabel = getStatusLabel(item.lastStatus);
      const trackedKey = `${item.roster}:${item.classNbr}`;

      return `
        <div class="tracked-item" data-tracked-key="${escapeAttr(trackedKey)}">
          <div class="tracked-info">
            <div class="tracked-course">${item.subject} ${item.catalogNbr}</div>
            <div class="tracked-section">
              Section ${item.section}
              <span class="badge badge-component">${item.ssrComponent}</span>
              <span class="badge badge-status ${statusClass}">${statusLabel}</span>
              ${item.classTime ? `<span class="tracked-time" title="${escapeAttr(item.classTime)}">${escapeHtml(item.classTime)}</span>` : ''}
            </div>
          </div>
          <div class="tracked-actions">
            <button
              type="button"
              class="btn-remove"
              data-action="untrack"
              data-class-nbr="${escapeAttr(item.classNbr)}"
              data-roster="${escapeAttr(item.roster)}"
              title="Remove"
            >
              &times;
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateTrackedStatuses() {
    const itemElements = new Map();
    for (const element of els.trackedList.querySelectorAll('.tracked-item[data-tracked-key]')) {
      itemElements.set(element.dataset.trackedKey, element);
    }

    for (const item of state.trackedSections) {
      const key = trackerKey(item);
      const element = itemElements.get(key);
      if (!element) continue;

      const statusBadge = element.querySelector('.badge-status');
      if (statusBadge) {
        const className = `badge badge-status ${getStatusClass(item.lastStatus)}`.trim();
        const label = getStatusLabel(item.lastStatus);
        if (statusBadge.className !== className) statusBadge.className = className;
        if (statusBadge.textContent !== label) statusBadge.textContent = label;
      }

      if (item.lastStatus !== 'O') {
        document.getElementById(`alert-${key}`)?.remove();
      }
    }

    updateTabOpenNotice();
  }

  function updateTabOpenNotice() {
    if (!els.tabOpenNotice || !els.tabOpenNoticeText) return;

    const trackedCount = state.trackedSections.length;
    if (trackedCount === 0) {
      els.tabOpenNotice.classList.add('hidden');
      return;
    }

    const cloudState = window.CourseSnagCloud?.getState();
    if (state.alertMode === 'cloud' && (!cloudState || cloudState.mode === 'checking')) {
      els.tabOpenNotice.dataset.mode = 'account';
      els.tabOpenNoticeText.textContent = 'Checking Cloud Alerts status. Keep this tab open for browser alerts.';
    } else if (state.alertMode === 'cloud' && cloudState?.mode !== 'cloud') {
      els.tabOpenNotice.dataset.mode = 'unavailable';
      els.tabOpenNoticeText.textContent = 'Cloud inactive. Keep this tab open for browser alerts.';
    } else if (state.alertMode === 'cloud' && cloudState?.signedIn) {
      els.tabOpenNotice.dataset.mode = 'cloud';
      els.tabOpenNoticeText.textContent = 'Cloud Alerts are active. Keep this tab open for in-browser alerts.';
    } else if (state.alertMode === 'cloud') {
      els.tabOpenNotice.dataset.mode = 'account';
      els.tabOpenNoticeText.textContent = 'Connect Discord for Cloud Alerts. Keep this tab open for browser alerts.';
    } else if (!state.alertMode) {
      els.tabOpenNotice.dataset.mode = 'account';
      els.tabOpenNoticeText.textContent = 'Choose Cloud Alerts or Browser Alerts.';
    } else {
      els.tabOpenNotice.dataset.mode = 'local';
      els.tabOpenNoticeText.textContent = 'Keep this tab open for browser alerts.';
    }
    els.tabOpenNotice.classList.remove('hidden');
  }

  function getStatusClass(status) {
    switch (status) {
      case 'O': return 'badge-open';
      case 'C': return 'badge-closed';
      case 'W': return 'badge-waitlist';
      default: return '';
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'O': return 'Open';
      case 'C': return 'Closed';
      case 'W': return 'Waitlist';
      default: return status || 'Unknown';
    }
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setSearchStatus(message, type = '') {
    els.searchStatus.textContent = message;
    els.searchStatus.className = 'status-message ' + type;
  }

  function setTrackedStatus(message, type = '') {
    els.trackedStatus.textContent = message;
    els.trackedStatus.className = 'status-indicator';
    if (type) {
      els.trackedStatus.classList.add(type);
    }
  }

  function updateLastUpdated() {
    els.lastUpdated.textContent = 'Updated: ' + formatTime(new Date());
  }

  // ============================================
  // Core Logic
  // ============================================
  async function loadRosters() {
    try {
      state.rosters = await fetchRosters();

      // Auto-select the default (most recent) roster
      const defaultRoster = state.rosters.find(r => r.isDefaultRoster === 'Y');
      state.currentRoster = defaultRoster ? defaultRoster.slug : state.rosters[0]?.slug;

      if (state.currentRoster) {
        removeTrackedSections(item => item.roster !== state.currentRoster);
      }

      renderRosterLabel();

      if (state.currentRoster) {
        await loadSubjects();
      }
    } catch (error) {
      console.error('Failed to load rosters:', error);
      state.initError = getUserFriendlyError(error, 'Rosters');
      els.rosterLabel.textContent = 'Connection error';
      renderSearchResults(); // Show error in search panel
    }
  }

  async function loadSubjects() {
    if (!state.currentRoster) return;

    try {
      const subjects = await fetchSubjects(state.currentRoster);
      state.subjectSet = new Set(subjects.map(subject => subject.value));
    } catch (error) {
      console.error('Failed to load subjects:', error);
      state.initError = getUserFriendlyError(error, 'Subjects');
      renderSearchResults(); // Show error in search panel
    }
  }

  async function performSearch() {
    const inputValue = els.searchInput.value;
    const normalizedInput = inputValue.trim().toUpperCase();
    const requestSeq = ++state.searchRequestSeq;
    const isCurrentSearch = () =>
      requestSeq === state.searchRequestSeq &&
      els.searchInput.value.trim().toUpperCase() === normalizedInput;
    const parsed = parseSearchInput(inputValue);

    if (!parsed) {
      cancelActiveSearch();
      state.searchResults = [];
      state.expandedCourses.clear();
      state.searchError = null;
      setSearchStatus('');
      renderSearchResults();
      return;
    }

    // Check if we need to fetch new data (subject changed only)
    const needsFetch = parsed.subject !== state.cachedSubject;

    if (needsFetch) {
      cancelActiveSearch();
      const controller = new AbortController();
      state.searchAbortController = controller;
      state.expandedCourses.clear();
      state.isSearching = true;
      renderSearchResults();

      let classes = null;
      let fetchError = null;
      try {
        // Always fetch ALL classes for the subject (no query parameter)
        classes = await searchClasses(state.currentRoster, parsed.subject, {
          signal: controller.signal
        });
      } catch (error) {
        fetchError = error;
      } finally {
        if (state.searchAbortController === controller) {
          state.searchAbortController = null;
        }
        if (isCurrentSearch()) {
          state.isSearching = false;
        }
      }

      if (!isCurrentSearch() || controller.signal.aborted) return;

      if (fetchError) {
        console.error('Search failed:', fetchError);
        state.searchError = getUserFriendlyError(fetchError, 'Subject');
        setSearchStatus('');
        state.searchResults = [];
        renderSearchResults();
        return;
      }

      state.cachedClasses = classes;
      state.cachedSubject = parsed.subject;
    }

    if (!isCurrentSearch()) return;

    // Clear any previous search error on success
    state.searchError = null;

    // Filter cached results by catalog number prefix (all client-side)
    if (parsed.query) {
      state.searchResults = state.cachedClasses.filter(course =>
        course.catalogNbr.startsWith(parsed.query)
      );
      const resultLabel = state.searchResults.length === 1 ? 'result' : 'results';
      setSearchStatus(`Found ${state.searchResults.length} ${resultLabel} for ${parsed.subject} ${parsed.query}.`);
    } else {
      state.searchResults = state.cachedClasses;
      const classLabel = state.searchResults.length === 1 ? 'class' : 'classes';
      setSearchStatus(`Found ${state.searchResults.length} ${classLabel} in ${parsed.subject}.`);
    }

    // Auto-expand if only 1 result
    if (state.searchResults.length === 1) {
      const course = state.searchResults[0];
      const courseId = getCourseId(course);
      state.expandedCourses.clear();
      state.expandedCourses.add(courseId);
    }

    renderSearchResults();
  }

  function cancelActiveSearch() {
    if (state.searchAbortController) {
      state.searchAbortController.abort();
      state.searchAbortController = null;
    }
    state.isSearching = false;
  }

  function debounceSearch() {
    const parsed = parseSearchInput(els.searchInput.value);
    cancelActiveSearch();
    clearTimeout(state.searchDebounceTimer);

    if (!parsed) {
      performSearch();
      return;
    }

    // If same subject, render immediately (client-side filtering, no API call needed)
    if (parsed.subject === state.cachedSubject) {
      performSearch();
      return;
    }

    // Debounce API work for a different subject.
    state.searchDebounceTimer = setTimeout(performSearch, DEBOUNCE_DELAY_MS);
  }

  // ============================================
  // Course Toggle
  // ============================================
  function toggleCourse(courseId, card) {
    const isExpanded = state.expandedCourses.has(courseId);
    if (isExpanded) {
      state.expandedCourses.delete(courseId);
    } else {
      state.expandedCourses.add(courseId);
    }

    if (!card) return;

    const shouldExpand = !isExpanded;
    if (shouldExpand) {
      const sectionsList = card.querySelector('.sections-list');
      if (sectionsList && sectionsList.dataset.loaded !== 'true') {
        const course = state.searchResults.find(result => getCourseId(result) === courseId);
        if (course) {
          sectionsList.innerHTML = getCourseSections(course)
            .map(section => renderSectionRow(course, section))
            .join('');
          sectionsList.dataset.loaded = 'true';
        }
      }
    }
    card.classList.toggle('expanded', shouldExpand);
    card.querySelector('[data-action="toggle-course"]')
      ?.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false');
  }

  // ============================================
  // Tracking Logic
  // ============================================
  function loadTrackedSections() {
    state.trackedSections = loadFromStorage('tracked', []);
    state.trackedKeySet = new Set(
      state.trackedSections.map(item => `${item.roster}:${String(item.classNbr)}`)
    );
    renderTrackedList();
  }

  function showAlertsForOpenSections() {
    // After page load, check if any tracked sections are open and show alerts for them
    const openSections = state.trackedSections.filter(item =>
      item.lastStatus === 'O' && !isAlertDismissed(`${item.roster}:${item.classNbr}`)
    );

    if (openSections.length > 0) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        triggerOpenAlert(openSections);
      }, 100);
    }
  }

  function saveTrackedSections() {
    saveToStorage('tracked', state.trackedSections);
  }

  function trackerKey(tracker) {
    return `${tracker.roster}:${String(tracker.classNbr)}`;
  }

  function removeTrackedSections(shouldRemove, { refreshUi = true } = {}) {
    const removed = [];
    state.trackedSections = state.trackedSections.filter(tracker => {
      if (!shouldRemove(tracker)) return true;
      removed.push(tracker);
      return false;
    });
    if (!removed.length) return [];

    for (const tracker of removed) {
      const key = trackerKey(tracker);
      state.trackedKeySet.delete(key);
      dismissedAlerts.delete(key);
      document.getElementById(`alert-${key}`)?.remove();
    }

    saveDismissedAlerts();
    if (refreshUi) {
      saveTrackedSections();
      renderTrackedList();
      syncSearchTrackButtons();
    }
    if (!hasActiveUndismissedOpenAlerts()) stopAlertSound();

    for (const tracker of removed) {
      void window.CourseSnagCloud?.trackerRemoved(tracker);
    }
    return removed;
  }

  function replaceLocalTrackers(cloudTrackers) {
    const replacement = [];
    const replacementKeys = new Set();
    const staleTrackers = [];
    const staleTrackerKeys = new Set();

    for (const cloudTracker of cloudTrackers) {
      if (!cloudTracker?.roster || !cloudTracker?.classNbr || !cloudTracker?.subject) continue;

      const normalizedCloud = {
        classNbr: String(cloudTracker.classNbr),
        roster: String(cloudTracker.roster),
        subject: String(cloudTracker.subject),
        catalogNbr: cloudTracker.catalogNbr || '',
        title: cloudTracker.title || '',
        section: cloudTracker.section || '',
        ssrComponent: cloudTracker.ssrComponent || '',
        classTime: cloudTracker.classTime || '',
        lastStatus: cloudTracker.lastStatus || 'UNKNOWN',
        lastCheckedAt: cloudTracker.lastCheckedAt || null
      };
      const key = trackerKey(normalizedCloud);
      if (state.currentRoster && normalizedCloud.roster !== state.currentRoster) {
        if (!staleTrackerKeys.has(key)) {
          staleTrackers.push(normalizedCloud);
          staleTrackerKeys.add(key);
        }
        continue;
      }
      if (replacementKeys.has(key)) continue;
      replacement.push(normalizedCloud);
      replacementKeys.add(key);
    }

    state.trackedSections = replacement;
    state.trackedKeySet = replacementKeys;
    for (const key of dismissedAlerts.keys()) {
      if (!replacementKeys.has(key)) dismissedAlerts.delete(key);
    }
    saveDismissedAlerts();
    saveTrackedSections();
    renderTrackedList();
    syncSearchTrackButtons();
    if (!hasActiveUndismissedOpenAlerts()) stopAlertSound();
    for (const tracker of staleTrackers) {
      void window.CourseSnagCloud?.trackerRemoved(tracker);
    }
  }

  function toggleTrack(classNbr, subject, catalogNbr, title, section, ssrComponent, openStatus, classTime = '') {
    const classNbrStr = String(classNbr);
    const trackKey = `${state.currentRoster}:${classNbrStr}`;
    const exists = state.trackedKeySet.has(trackKey);

    if (exists) return;

    const newItem = {
      classNbr: classNbrStr,
      roster: state.currentRoster,
      subject,
      catalogNbr,
      title,
      section,
      ssrComponent,
      classTime,
      lastStatus: openStatus,
      lastCheckedAt: new Date().toISOString()
    };

    state.trackedSections.push(newItem);
    state.trackedKeySet.add(trackKey);

    saveTrackedSections();
    renderTrackedList();
    syncSearchTrackButtons(classNbrStr);
    void window.CourseSnagCloud?.trackerAdded(newItem);

    // Alert immediately if tracking an already-open section (after DOM is updated)
    if (openStatus === 'O') {
      triggerOpenAlert([newItem]);
    }
  }

  function untrack(classNbr, roster = null) {
    const classNbrStr = String(classNbr);
    removeTrackedSections(tracker => (
      tracker.classNbr === classNbrStr && (!roster || tracker.roster === roster)
    ));
  }

  // ============================================
  // Polling / Refresh Logic
  // ============================================
  async function refreshTrackedSections() {
    if (state.trackedSections.length === 0) {
      setTrackedStatus('');
      return;
    }

    if (state.isRefreshing) return;

    state.isRefreshing = true;

    // Group tracked sections by roster + subject
    const groups = {};
    for (const item of state.trackedSections) {
      const key = `${item.roster}:${item.subject}`;
      if (!groups[key]) {
        groups[key] = { roster: item.roster, subject: item.subject, items: [] };
      }
      groups[key].items.push(item);
    }

    const newlyOpened = [];
    const missingTrackerKeys = new Set();
    const checkedAt = new Date().toISOString();

    try {
      for (const group of Object.values(groups)) {
        const classes = await searchClasses(group.roster, group.subject);
        const statusIndex = new Map();

        for (const course of classes) {
          for (const eg of (course.enrollGroups || [])) {
            for (const sec of (eg.classSections || [])) {
              statusIndex.set(String(sec.classNbr), sec.openStatus);
            }
          }
        }

        for (const item of group.items) {
          const newStatus = statusIndex.get(item.classNbr);
          if (newStatus === undefined) {
            missingTrackerKeys.add(trackerKey(item));
            continue;
          }

          const oldStatus = item.lastStatus;

          // Detect transition to OPEN
          if (oldStatus !== 'O' && newStatus === 'O') {
            newlyOpened.push(item);
          }

          item.lastStatus = newStatus;
          item.lastCheckedAt = checkedAt;
        }
      }

      const removed = removeTrackedSections(
        item => missingTrackerKeys.has(trackerKey(item)),
        { refreshUi: false }
      );

      saveTrackedSections();
      if (removed.length > 0) {
        renderTrackedList();
        syncSearchTrackButtons();
      } else {
        updateTrackedStatuses();
      }
      updateLastUpdated();
      setTrackedStatus('');

      // Trigger full alert (sound + notification + overlay) for newly opened sections
      const actionableNewlyOpened = newlyOpened.filter(item =>
        state.trackedKeySet.has(`${item.roster}:${item.classNbr}`)
      );

      if (actionableNewlyOpened.length > 0) {
        triggerOpenAlert(actionableNewlyOpened);
      }

      // Re-show visual overlays for already-open sections (no sound/notification replay)
      // Exclude newly opened (already handled above) and dismissed sections
      const newlyOpenedSet = new Set(actionableNewlyOpened.map(i => `${i.roster}:${i.classNbr}`));
      const currentlyOpen = state.trackedSections.filter(item => {
        const key = `${item.roster}:${item.classNbr}`;
        return item.lastStatus === 'O' && !isAlertDismissed(key) && !newlyOpenedSet.has(key);
      });
      for (const item of currentlyOpen) {
        const trackedKey = `${item.roster}:${item.classNbr}`;
        const trackedElement = document.querySelector(`[data-tracked-key="${trackedKey}"]`);
        if (trackedElement) {
          showAlertOverItem(item, trackedElement, trackedKey);
        }
      }
      if (!hasActiveUndismissedOpenAlerts()) stopAlertSound();
    } catch (error) {
      console.error('Refresh failed:', error);
      setTrackedStatus(getUserFriendlyError(error, 'Refresh'), 'error');
    } finally {
      state.isRefreshing = false;
    }
  }

  function startPolling() {
    stopPolling();
    state.pollingTimer = setInterval(
      refreshTrackedSections,
      state.pollingIntervalSec * 1000
    );
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  // ============================================
  // Event Handlers
  // ============================================
  function onSearchInput() {
    if (!els.searchInput.value.trim()) {
      setSearchStatus('');
    }
    debounceSearch();
  }

  function onSearchShortcutClick(event) {
    const shortcutBtn = event.target.closest('button[data-action="set-subject"]');
    if (!shortcutBtn || !els.searchPanel || !els.searchPanel.contains(shortcutBtn)) return;

    const subject = (shortcutBtn.dataset.subject || '').trim().toUpperCase();
    if (!subject) return;

    els.searchInput.value = subject;
    els.searchInput.focus();
    setSearchStatus('');
    clearTimeout(state.searchDebounceTimer);
    cancelActiveSearch();
    performSearch();
  }

  function onGlobalKeydown(event) {
    if (els.settingsDialog?.open) return;
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }

    event.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
  }

  function onSearchResultsClick(event) {
    const courseHeader = event.target.closest('[data-action="toggle-course"]');
    if (courseHeader && els.searchResults.contains(courseHeader)) {
      const courseId = courseHeader.dataset.courseId;
      if (courseId) {
        toggleCourse(courseId, courseHeader.closest('.course-card'));
      }
      return;
    }

    const trackBtn = event.target.closest('button[data-action="toggle-track"]');
    if (!trackBtn || !els.searchResults.contains(trackBtn) || trackBtn.disabled) return;

    const classNbr = trackBtn.dataset.classNbr;
    const subject = trackBtn.dataset.subject;
    const catalogNbr = trackBtn.dataset.catalogNbr;
    const title = trackBtn.dataset.title || '';
    const section = trackBtn.dataset.section;
    const ssrComponent = trackBtn.dataset.ssrComponent;
    const openStatus = trackBtn.dataset.openStatus;
    const classTime = trackBtn.dataset.classTime || '';
    if (!classNbr || !subject || !catalogNbr || !section || !ssrComponent || !openStatus) return;

    toggleTrack(classNbr, subject, catalogNbr, title, section, ssrComponent, openStatus, classTime);
  }

  function onTrackedListClick(event) {
    const untrackBtn = event.target.closest('button[data-action="untrack"]');
    if (!untrackBtn || !els.trackedList.contains(untrackBtn)) return;

    const classNbr = untrackBtn.dataset.classNbr;
    const roster = untrackBtn.dataset.roster || null;
    if (!classNbr) return;

    untrack(classNbr, roster);
  }

  async function onRefreshClick() {
    if (state.isRefreshing) return;

    els.refreshBtn.disabled = true;
    els.refreshBtn.textContent = 'Refreshing…';

    try {
      const refreshes = [
        refreshTrackedSections(),
        window.CourseSnagCloud?.syncNow?.()
      ].filter(Boolean);

      // Also refresh search results if there's an active search
      if (state.cachedSubject) {
        state.cachedSubject = null; // Force re-fetch from API
        refreshes.push(performSearch());
      }

      await Promise.all(refreshes);
    } finally {
      els.refreshBtn.textContent = 'Refresh now';
      els.refreshBtn.disabled = false;
    }
  }

  function onSoundToggle() {
    state.soundEnabled = els.soundToggle.checked;
    saveSettings();
  }

  function onTestSound() {
    if (state.isAlerting) {
      stopAlertSound();
      els.testSoundBtn.textContent = 'Test';
    } else {
      startAlertSound();
      els.testSoundBtn.textContent = 'Stop';
    }
  }

  async function onNotifyToggle() {
    state.notifyEnabled = els.notifyToggle.checked;

    if (state.notifyEnabled && hasNotificationSupport() && Notification.permission !== 'granted') {
      const granted = await requestNotificationPermission();
      if (!granted) {
        state.notifyEnabled = false;
        els.notifyToggle.checked = false;
      }
    }

    updateNotifyStatus();
    saveSettings();
  }

  async function onTestNotify() {
    if (!hasNotificationSupport()) {
      alert('Notifications are not supported in this browser.');
      return;
    }

    if (Notification.permission === 'default') {
      // Request permission first if not yet granted
      const granted = await requestNotificationPermission();
      if (!granted) {
        alert('Notification permission was denied. Enable notifications in the browser settings.');
        return;
      }
    }

    if (Notification.permission !== 'granted') {
      alert('Notifications are blocked. Enable notifications in the browser settings.');
      return;
    }

    try {
      // Show notification directly (bypassing state.notifyEnabled check for testing)
      new Notification('CourseSnag test', {
        body: 'Browser notifications are enabled.',
        icon: 'favicon-cornell-32.png?v=3',
        tag: 'coursesnag-test',
        requireInteraction: true
      });
    } catch (err) {
      console.error('Error showing notification:', err);
      alert('Could not show the notification: ' + err.message);
    }
  }

  function updatePollingUI() {
    if (!els.pollingSegmented) return;
    const buttons = Array.from(els.pollingSegmented.querySelectorAll('.segment-btn'));
    const index = buttons.findIndex(btn => Number(btn.dataset.interval) === state.pollingIntervalSec);
    const resolvedIndex = index >= 0 ? index : 0;

    buttons.forEach((btn, i) => {
      const isActive = i === resolvedIndex;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    els.pollingSegmented.style.setProperty('--segment-index', resolvedIndex);
    els.pollingSegmented.style.setProperty('--segment-count', buttons.length);
  }

  function onPollingClick(event) {
    const button = event.target.closest('.segment-btn');
    if (!button) return;

    const intervalSec = Number(button.dataset.interval);
    if (!POLLING_OPTIONS.includes(intervalSec)) return;

    state.pollingIntervalSec = intervalSec;
    updatePollingUI();
    saveSettings();
    startPolling();
  }

  function cloudIsAvailable() {
    return window.CourseSnagCloud?.getState?.().mode === 'cloud';
  }

  function updateCloudModeChoice() {
    const cloudState = window.CourseSnagCloud?.getState();
    const checking = !cloudState || cloudState.mode === 'checking';
    const available = cloudState?.mode === 'cloud';

    els.chooseCloudMode.disabled = !available;
    els.chooseCloudMode.setAttribute('aria-disabled', available ? 'false' : 'true');
    els.cloudOptionStatus.className = `mode-choice-availability ${checking ? 'checking' : available ? 'available' : 'unavailable'}`;
    els.cloudOptionStatusText.textContent = checking ? 'Checking' : available ? 'Available' : 'Inactive';
    els.cloudOptionAction.textContent = checking ? 'Checking availability' : available ? 'Select' : 'Cloud inactive';

    if (!available && state.pendingAlertMode === 'cloud' && state.settingsView === 'choice') {
      state.pendingAlertMode = null;
    }
  }

  function renderAlertMode() {
    const cloudState = window.CourseSnagCloud?.getState();
    updateCloudModeChoice();
    for (const label of els.modeCurrentLabels) {
      label.hidden = label.dataset.currentMode !== state.alertMode;
    }
    els.chooseLocalMode.classList.toggle('is-current', state.alertMode === 'local');
    els.chooseCloudMode.classList.toggle('is-current', state.alertMode === 'cloud');
    els.chooseLocalMode.classList.toggle('is-selected', state.pendingAlertMode === 'local');
    els.chooseCloudMode.classList.toggle('is-selected', state.pendingAlertMode === 'cloud');
    els.chooseLocalMode.setAttribute('aria-pressed', state.pendingAlertMode === 'local' ? 'true' : 'false');
    els.chooseCloudMode.setAttribute('aria-pressed', state.pendingAlertMode === 'cloud' ? 'true' : 'false');

    const cloudChecking = !cloudState || cloudState.mode === 'checking';
    const cloudAvailable = cloudState?.mode === 'cloud';
    const cloudUnavailable = cloudState && cloudState.mode !== 'checking' && cloudState.mode !== 'cloud';
    els.cloudSettingsView.classList.toggle('is-inactive', cloudUnavailable);
    els.cloudSettingsView.classList.toggle('is-checking', cloudChecking);
    els.cloudSettingsView.dataset.cloudAvailability = cloudChecking
      ? 'checking'
      : cloudAvailable ? 'active' : 'inactive';
    if (els.cloudAccountPanel) {
      els.cloudAccountPanel.hidden = !cloudAvailable;
    }

    const footerMode = state.alertMode === 'cloud' && cloudUnavailable
      ? 'unavailable'
      : state.alertMode || 'unset';
    const footerModeLabel = footerMode === 'unavailable'
      ? 'Cloud inactive, browser alerts available'
      : footerMode === 'unset'
        ? 'No alert delivery selected'
        : footerMode === 'cloud' ? 'Cloud and in-browser settings' : 'Browser Alerts settings';
    els.settingsButton.textContent = 'Settings';
    els.settingsButton.dataset.mode = footerMode;
    els.settingsButton.setAttribute('aria-label', `Settings, ${footerModeLabel}`);

    updateSettingsActions();
    updateTabOpenNotice();
  }

  function updateSettingsActions() {
    const isChoice = state.settingsView === 'choice';
    const isOnboarding = els.settingsDialog.dataset.onboarding === 'true';
    const cloudState = window.CourseSnagCloud?.getState?.();
    const cloudUnavailable = state.settingsView === 'cloud'
      && cloudState
      && cloudState.mode !== 'checking'
      && cloudState.mode !== 'cloud';
    const cloudNeedsDiscord = isOnboarding
      && !isChoice
      && state.settingsView === 'cloud'
      && cloudIsAvailable()
      && !window.CourseSnagCloud?.getState?.().signedIn;
    els.settingsDoneButton.textContent = isChoice
      ? 'Continue'
      : cloudNeedsDiscord
        ? 'Connect Discord above'
        : isOnboarding ? 'Finish setup' : 'Done';
    els.settingsDoneButton.disabled = (isChoice && !state.pendingAlertMode) || cloudNeedsDiscord;
    els.settingsFooterNote.textContent = isChoice
      ? 'Choose how CourseSnag should alert you.'
      : cloudNeedsDiscord
        ? 'Connect Discord to finish Cloud Alerts setup.'
        : cloudUnavailable
          ? 'Cloud is inactive. In-browser settings remain available.'
          : 'Changes are saved automatically.';
  }

  function showSettingsView(view) {
    state.settingsView = view;
    const isChoice = view === 'choice';
    els.settingsDialog.classList.toggle('is-browser-only', !isChoice && view === 'local');
    els.modeChoiceView.hidden = !isChoice;
    els.localSettingsView.hidden = isChoice;
    els.cloudSettingsView.hidden = view !== 'cloud';

    if (isChoice) {
      els.settingsEyebrow.textContent = els.settingsDialog.dataset.onboarding === 'true' ? 'Setup' : 'Preferences';
      els.settingsTitle.textContent = 'Choose your alerts';
    } else {
      els.settingsEyebrow.textContent = 'Alert preferences';
      els.settingsTitle.textContent = 'Settings';
    }
    updateSettingsActions();
  }

  function selectAlertMode(mode) {
    if (mode === 'cloud' && !cloudIsAvailable()) return;
    state.pendingAlertMode = mode;
    renderAlertMode();
  }

  function commitPendingAlertMode() {
    if (!state.pendingAlertMode) return;
    state.alertMode = state.pendingAlertMode;
    saveToStorage('alertMode', state.alertMode);
    renderAlertMode();
    showSettingsView(state.alertMode);
    if (state.alertMode === 'cloud') {
      void window.CourseSnagCloud?.syncNow?.();
    }
  }

  function onSettingsPrimaryAction() {
    if (state.settingsView === 'choice') {
      commitPendingAlertMode();
    } else {
      closeSettings();
    }
  }

  function openSettings(isOnboarding = false) {
    if (!els.settingsDialog) return;
    els.settingsDialog.dataset.onboarding = isOnboarding ? 'true' : 'false';
    state.pendingAlertMode = isOnboarding ? null : state.alertMode;
    renderAlertMode();
    showSettingsView(isOnboarding || !state.alertMode ? 'choice' : state.alertMode);
    if (!els.settingsDialog.open) els.settingsDialog.showModal();
  }

  function closeSettings() {
    if (els.settingsDialog?.open) els.settingsDialog.close();
  }

  function finishSettingsSession() {
    if (els.settingsDialog?.dataset.onboarding === 'true' && state.alertMode) {
      saveToStorage('onboardingComplete', true);
    }
    if (state.isAlerting) {
      stopAlertSound();
      els.testSoundBtn.textContent = 'Test';
    }
  }

  // ============================================
  // Initialization
  // ============================================
  async function init() {
    const setupParams = new URLSearchParams(window.location.search);
    const discordSetupRequested = setupParams.get('setup') === 'discord';
    // Attach event listeners
    els.searchInput.addEventListener('input', onSearchInput);
    els.searchResults.addEventListener('click', onSearchResultsClick);
    els.refreshBtn.addEventListener('click', onRefreshClick);
    els.trackedList.addEventListener('click', onTrackedListClick);
    if (els.searchPanel) {
      els.searchPanel.addEventListener('click', onSearchShortcutClick);
    }
    document.addEventListener('keydown', onGlobalKeydown);

    // Settings event listeners
    els.soundToggle.addEventListener('change', onSoundToggle);
    els.testSoundBtn.addEventListener('click', onTestSound);
    els.notifyToggle.addEventListener('change', onNotifyToggle);
    els.testNotifyBtn.addEventListener('click', onTestNotify);
    els.settingsButton.addEventListener('click', () => openSettings(false));
    els.settingsCloseButton.addEventListener('click', closeSettings);
    els.settingsDoneButton.addEventListener('click', onSettingsPrimaryAction);
    els.chooseLocalMode.addEventListener('click', () => selectAlertMode('local'));
    els.chooseCloudMode.addEventListener('click', () => selectAlertMode('cloud'));
    els.settingsDialog.addEventListener('close', finishSettingsSession);
    els.settingsDialog.addEventListener('click', event => {
      if (event.target === els.settingsDialog) closeSettings();
    });
    // Allow clicking on notify status to request permission
    els.notifyStatus.addEventListener('click', async () => {
      if (hasNotificationSupport() && Notification.permission === 'default') {
        const granted = await requestNotificationPermission();
        if (granted) {
          state.notifyEnabled = true;
          els.notifyToggle.checked = true;
          saveSettings();
        }
      }
    });
    if (els.pollingSegmented) {
      els.pollingSegmented.addEventListener('click', onPollingClick);
    }
    window.addEventListener('coursesnag:cloud-state', renderAlertMode);
    window.addEventListener('coursesnag:discord-return', event => {
      if (event.detail?.result === 'connected' && cloudIsAvailable()) {
        state.alertMode = 'cloud';
        state.pendingAlertMode = 'cloud';
        saveToStorage('alertMode', 'cloud');
      }
      renderAlertMode();
      openSettings(false);
    });

    // Load settings and data
    loadSettings();
    const savedAlertMode = loadFromStorage('alertMode', null);
    state.alertMode = savedAlertMode === 'local' || savedAlertMode === 'cloud'
      ? savedAlertMode
      : null;
    renderAlertMode();
    loadTrackedSections();
    loadDismissedAlerts();
    if (!state.alertMode && !discordSetupRequested) {
      requestAnimationFrame(() => openSettings(true));
    }
    const cloudInitialization = Promise.resolve(
      window.CourseSnagCloud?.initialize({
        replaceLocalTrackers,
        initialAlertMode: state.alertMode,
        cloudSetupRequested: discordSetupRequested
      })
    ).catch(error => {
      console.error('Cloud initialization failed:', error);
    });

    // Cornell search data is independent of Cloud account setup, so load both in parallel.
    await loadRosters();

    // Local search and refresh can become usable without waiting for Cloud requests.
    els.refreshBtn.disabled = false;
    startPolling();

    await cloudInitialization;
    if (discordSetupRequested) {
      setupParams.delete('setup');
      const remainingQuery = setupParams.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`
      );
      openSettings(true);
    }

    // Show alerts for any open tracked sections (after page reload)
    showAlertsForOpenSections();

    // Initial refresh of tracked sections
    if (state.trackedSections.length > 0) {
      refreshTrackedSections();
    }
  }

  // Start the app
  init();
})();
