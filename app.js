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
  const POLLING_OPTIONS = [10, 30, 60, 300];
  const DEBUG = false;

  // ============================================
  // State
  // ============================================
  const state = {
    rosters: [],
    subjects: [],
    subjectSet: new Set(),
    currentRoster: null,
    // Cache for subject classes (avoid re-fetching when typing numbers)
    cachedSubject: null,
    cachedQuery: '',
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
    isSearching: false,
    isRefreshing: false,
    searchRequestSeq: 0,
    // Error states
    initError: null,
    searchError: null,
    // Settings
    soundEnabled: true,
    notifyEnabled: true,
    pollingIntervalSec: 60,
    // Alert state
    isAlerting: false,
    alertAudioContext: null,
    alertOscillator: null
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
    pollingIndicator: document.getElementById('polling-indicator'),
    // Alert elements
    alertBanner: document.getElementById('alert-banner'),
    alertMessage: document.getElementById('alert-message'),
    dismiss5minBtn: document.getElementById('dismiss-5min-btn'),
    untrackAlertBtn: document.getElementById('untrack-alert-btn')
  };

  // Track dismissed alerts (class numbers dismissed for 5 minutes)
  // Stored in localStorage with expiration timestamp
  const dismissedAlerts = new Map();

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
      state.alertOscillator = state.alertAudioContext.createOscillator();
      const gainNode = state.alertAudioContext.createGain();

      state.alertOscillator.connect(gainNode);
      gainNode.connect(state.alertAudioContext.destination);

      // Create a pleasant ascending/descending bell-like pattern
      state.alertOscillator.type = 'sine';
      gainNode.gain.value = 0.25;

      // Musical pattern: ascending then sustaining notes
      const now = state.alertAudioContext.currentTime;
      const notes = [440, 494, 523, 587, 659]; // A, B, C, D, E notes in Hz

      for (let cycle = 0; cycle < 15; cycle++) {
        const cycleStart = now + cycle * 1.5;
        // Play through the ascending notes
        for (let i = 0; i < notes.length; i++) {
          const noteStart = cycleStart + i * 0.2;
          state.alertOscillator.frequency.setValueAtTime(notes[i], noteStart);
        }
      }

      state.alertOscillator.start();
      state.isAlerting = true;
    } catch (e) {
      console.error('Failed to start alert sound:', e);
    }
  }

  function stopAlertSound() {
    if (!state.isAlerting) return;

    try {
      if (state.alertOscillator) {
        state.alertOscillator.stop();
        state.alertOscillator.disconnect();
        state.alertOscillator = null;
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
        ? '(Disabled on mobile)'
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
      els.notifyStatus.textContent = '(Click to enable)';
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
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎉</text></svg>',
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
        ? `${names[0]} is now OPEN!`
        : `${names.length} sections are now OPEN!`;
      showNotification('CourseSnag Alert', message);
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

    // Also clear it from memory after 5 minutes
    setTimeout(() => {
      dismissedAlerts.delete(trackedKey);
      saveDismissedAlerts();
    }, 5 * 60 * 1000);
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

  function dismissAlert() {
    stopAlertSound();
    els.alertBanner.classList.add('hidden');
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
      soundEnabled: true,
      notifyEnabled: true,
      pollingIntervalSec: 60
    });
    state.soundEnabled = settings.soundEnabled;
    state.notifyEnabled = settings.notifyEnabled;
    if (!hasNotificationSupport()) {
      state.notifyEnabled = false;
    }
    state.pollingIntervalSec = POLLING_OPTIONS.includes(settings.pollingIntervalSec)
      ? settings.pollingIntervalSec
      : 60;

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

  async function rateLimitedFetch(url) {
    const task = async () => {
      const now = Date.now();
      const timeSinceLast = now - state.lastRequestTime;

      if (timeSinceLast < RATE_LIMIT_MS) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLast));
      }

      state.lastRequestTime = Date.now();

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== 'success') {
        throw new Error(data.message || 'API returned error status');
      }

      return data.data;
    };

    const taskPromise = state.requestQueue.then(task, task);
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
    const data = await rateLimitedFetch(`${API_BASE}/config/subjects.json?roster=${roster}`);
    return data.subjects || [];
  }

  async function searchClasses(roster, subject, query = '') {
    let url = `${API_BASE}/search/classes.json?roster=${roster}&subject=${subject}`;
    if (query) {
      url += `&q=${encodeURIComponent(query)}`;
    }
    const data = await rateLimitedFetch(url);
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
      els.searchResults.innerHTML = '<p class="empty-state"><span class="spinner"></span>Searching...</p>';
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
      els.searchResults.innerHTML = '<p class="empty-state">Enter a subject code to search (e.g. CS, MATH, INFO)</p>';
      return;
    }

    if (state.searchResults.length === 0) {
      setEmptyState(true);
      els.searchResults.innerHTML = '<p class="empty-state">No classes found</p>';
      return;
    }

    setEmptyState(false);
    let html = '';

    for (const course of state.searchResults) {
      const sections = extractSections(course);
      if (sections.length === 0) continue;

      const courseId = `${course.subject}-${course.catalogNbr}`;
      const isExpanded = state.expandedCourses.has(courseId);

      html += `
        <div class="course-card ${isExpanded ? 'expanded' : ''}" data-course-id="${escapeAttr(courseId)}">
          <div class="course-header" data-action="toggle-course" data-course-id="${escapeAttr(courseId)}">
            <div class="course-header-info">
              <div class="course-title">${escapeHtml(course.titleShort || course.titleLong || 'Untitled')}</div>
              <div class="course-code">${course.subject} ${course.catalogNbr} (${sections.length} section${sections.length !== 1 ? 's' : ''})</div>
            </div>
            <span class="course-toggle">▼</span>
          </div>
          <div class="sections-list">
            ${sections.map(sec => renderSectionRow(course, sec)).join('')}
          </div>
        </div>
      `;
    }

    els.searchResults.innerHTML = html || '<p class="empty-state">No sections found</p>';
  }

  function extractSections(course) {
    const sections = [];
    for (const eg of (course.enrollGroups || [])) {
      for (const sec of (eg.classSections || [])) {
        sections.push(sec);
      }
    }
    return sections;
  }

  function renderSectionRow(course, section) {
    const trackKey = `${state.currentRoster}:${String(section.classNbr)}`;
    const isTracked = state.trackedKeySet.has(trackKey);
    const statusClass = getStatusClass(section.openStatus);
    const statusLabel = getStatusLabel(section.openStatus);

    return `
      <div class="section-row">
        <span class="section-number">${section.section}</span>
        <span class="badge badge-component">${section.ssrComponent}</span>
        <span class="badge badge-status ${statusClass}">${statusLabel}</span>
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
            ${isTracked ? 'disabled' : ''}
          >
            ${isTracked ? 'Tracked' : 'Track'}
          </button>
        </div>
      </div>
    `;
  }

  function renderTrackedList() {
    updateTabOpenNotice();

    if (state.trackedSections.length === 0) {
      els.trackedList.innerHTML = '<p class="empty-state">No sections tracked yet</p>';
      return;
    }

    els.trackedList.innerHTML = state.trackedSections.map(item => {
      const statusClass = getStatusClass(item.lastStatus);
      const statusLabel = getStatusLabel(item.lastStatus);
      const trackedKey = `${item.roster}:${item.classNbr}`;

      return `
        <div class="tracked-item" data-tracked-key="${trackedKey}">
          <div class="tracked-info">
            <div class="tracked-course">${item.subject} ${item.catalogNbr}</div>
            <div class="tracked-section">
              Section ${item.section}
              <span class="badge badge-component">${item.ssrComponent}</span>
              <span class="badge badge-status ${statusClass}">${statusLabel}</span>
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

  function updateTabOpenNotice() {
    if (!els.tabOpenNotice || !els.tabOpenNoticeText) return;

    const trackedCount = state.trackedSections.length;
    if (trackedCount === 0) {
      els.tabOpenNotice.classList.add('hidden');
      return;
    }

    els.tabOpenNoticeText.textContent = 'Keep this tab open to get alerted.';
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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
      state.subjects = await fetchSubjects(state.currentRoster);
      state.subjectSet = new Set(state.subjects.map(s => s.value));
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
      state.searchResults = [];
      state.cachedSubject = null;
      state.cachedClasses = [];
      state.expandedCourses.clear();
      state.searchError = null;
      setSearchStatus('');
      renderSearchResults();
      return;
    }

    // Check if we need to fetch new data (subject changed only)
    const needsFetch = parsed.subject !== state.cachedSubject;

    if (needsFetch) {
      state.expandedCourses.clear();
      state.isSearching = true;
      renderSearchResults();

      try {
        // Always fetch ALL classes for the subject (no query parameter)
        const classes = await searchClasses(state.currentRoster, parsed.subject, '');
        if (!isCurrentSearch()) return;
        state.cachedClasses = classes;
        state.cachedSubject = parsed.subject;
      } catch (error) {
        if (!isCurrentSearch()) return;
        console.error('Search failed:', error);
        state.searchError = getUserFriendlyError(error, 'Subject');
        setSearchStatus('');
        state.cachedClasses = [];
        state.cachedSubject = null;
        state.searchResults = [];
        state.isSearching = false;
        renderSearchResults();
        return;
      }

      if (!isCurrentSearch()) return;
      state.isSearching = false;
    }

    if (!isCurrentSearch()) return;

    // Clear any previous search error on success
    state.searchError = null;

    // Filter cached results by catalog number prefix (all client-side)
    if (parsed.query) {
      state.searchResults = state.cachedClasses.filter(course =>
        course.catalogNbr.startsWith(parsed.query)
      );
      setSearchStatus(`Showing ${state.searchResults.length} result(s) for ${parsed.subject} ${parsed.query}`);
    } else {
      state.searchResults = state.cachedClasses;
      setSearchStatus(`Showing ${state.searchResults.length} class(es) in ${parsed.subject}`);
    }

    // Auto-expand if only 1 result
    if (state.searchResults.length === 1) {
      const course = state.searchResults[0];
      const courseId = `${course.subject}-${course.catalogNbr}`;
      state.expandedCourses.clear();
      state.expandedCourses.add(courseId);
    }

    renderSearchResults();
  }

  function debounceSearch() {
    const parsed = parseSearchInput(els.searchInput.value);

    // If same subject, render immediately (client-side filtering, no API call needed)
    if (parsed && parsed.subject === state.cachedSubject) {
      clearTimeout(state.searchDebounceTimer);
      performSearch();
      return;
    }

    // Different subject or no subject - debounce the API call
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(performSearch, DEBOUNCE_DELAY_MS);
  }

  // ============================================
  // Course Toggle
  // ============================================
  function toggleCourse(courseId) {
    if (state.expandedCourses.has(courseId)) {
      state.expandedCourses.delete(courseId);
    } else {
      state.expandedCourses.add(courseId);
    }

    // Update just this course card without re-rendering everything
    const card = document.querySelector(`[data-course-id="${courseId}"]`);
    if (card) {
      card.classList.toggle('expanded');
    }
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

  function toggleTrack(classNbr, subject, catalogNbr, title, section, ssrComponent, openStatus) {
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
      lastStatus: openStatus,
      lastCheckedAt: new Date().toISOString()
    };

    state.trackedSections.push(newItem);
    state.trackedKeySet.add(trackKey);

    saveTrackedSections();
    renderTrackedList();
    renderSearchResults(); // Update track buttons

    // Alert immediately if tracking an already-open section (after DOM is updated)
    if (openStatus === 'O') {
      triggerOpenAlert([newItem]);
    }
  }

  function untrack(classNbr, roster = null) {
    const classNbrStr = String(classNbr);
    const removed = [];
    state.trackedSections = state.trackedSections.filter(t => {
      const matchesClassNbr = t.classNbr === classNbrStr;
      const matchesRoster = !roster || t.roster === roster;
      if (matchesClassNbr && matchesRoster) {
        removed.push(`${t.roster}:${String(t.classNbr)}`);
        return false;
      }
      return true;
    });
    for (const key of removed) {
      state.trackedKeySet.delete(key);
      // Clear any dismissed alerts for this class so it can alert again if re-tracked
      if (dismissedAlerts.has(key)) {
        dismissedAlerts.delete(key);
        saveDismissedAlerts();
      }
      // Remove alert overlay for this class
      const alertElement = document.getElementById(`alert-${key}`);
      if (alertElement) {
        alertElement.remove();
      }
    }

    // Stop alert sound if it's playing (no more tracked open sections with active alerts)
    if (!hasActiveUndismissedOpenAlerts()) {
      stopAlertSound();
    }

    saveTrackedSections();
    renderTrackedList();
    renderSearchResults(); // Update track buttons
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
    els.refreshBtn.disabled = true;
    els.trackedStatus.textContent = 'Refreshing...';
    els.trackedStatus.classList.add('loading');

    // Group tracked sections by roster + subject
    const groups = {};
    for (const item of state.trackedSections) {
      const key = `${item.roster}:${item.subject}`;
      if (!groups[key]) {
        groups[key] = { roster: item.roster, subject: item.subject, items: [] };
      }
      groups[key].items.push(item);
    }

    let updatedCount = 0;
    const newlyOpened = [];

    try {
      for (const group of Object.values(groups)) {
        const classes = await searchClasses(group.roster, group.subject, '');
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
            if (DEBUG) {
              console.warn(`[CourseSnag] ${item.subject} ${item.catalogNbr} sec ${item.section} (classNbr ${item.classNbr}) not found in API response`);
            }
            continue;
          }

          const oldStatus = item.lastStatus;
          if (DEBUG) {
            console.log(`[CourseSnag] ${item.subject} ${item.catalogNbr} sec ${item.section}: ${oldStatus} → ${newStatus}`);
          }

          // Detect transition to OPEN
          if (oldStatus !== 'O' && newStatus === 'O') {
            newlyOpened.push(item);
          }

          item.lastStatus = newStatus;
          item.lastCheckedAt = new Date().toISOString();
          updatedCount++;
        }
      }

      saveTrackedSections();
      renderTrackedList();
      updateLastUpdated();
      els.trackedStatus.textContent = '';
      els.trackedStatus.classList.remove('loading');

      // Trigger full alert (sound + notification + overlay) for newly opened sections
      const activeTrackedKeys = new Set(
        state.trackedSections.map(item => `${item.roster}:${item.classNbr}`)
      );
      const actionableNewlyOpened = newlyOpened.filter(item =>
        activeTrackedKeys.has(`${item.roster}:${item.classNbr}`)
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
    } catch (error) {
      console.error('Refresh failed:', error);
      els.trackedStatus.textContent = getUserFriendlyError(error, 'Refresh');
      els.trackedStatus.classList.add('error');
    }

    state.isRefreshing = false;
    els.refreshBtn.disabled = false;
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
    performSearch();
  }

  function onGlobalKeydown(event) {
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
        toggleCourse(courseId);
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
    if (!classNbr || !subject || !catalogNbr || !section || !ssrComponent || !openStatus) return;

    toggleTrack(classNbr, subject, catalogNbr, title, section, ssrComponent, openStatus);
  }

  function onTrackedListClick(event) {
    const untrackBtn = event.target.closest('button[data-action="untrack"]');
    if (!untrackBtn || !els.trackedList.contains(untrackBtn)) return;

    const classNbr = untrackBtn.dataset.classNbr;
    const roster = untrackBtn.dataset.roster || null;
    if (!classNbr) return;

    untrack(classNbr, roster);
  }

  function onRefreshClick() {
    refreshTrackedSections();
    // Also refresh search results if there's an active search
    if (state.cachedSubject) {
      state.cachedSubject = null; // Force re-fetch from API
      performSearch();
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
    if (els.notifyToggle.checked) {
      // Request permission if enabling
      const granted = await requestNotificationPermission();
      state.notifyEnabled = granted;
      els.notifyToggle.checked = granted;
      updateNotifyStatus();
    } else {
      state.notifyEnabled = false;
      updateNotifyStatus();
    }
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
        alert('Notification permission denied. Please enable in browser settings.');
        return;
      }
    }

    if (Notification.permission !== 'granted') {
      alert('Notifications are blocked. Please enable in your browser settings.');
      return;
    }

    try {
      // Show notification directly (bypassing state.notifyEnabled check for testing)
      new Notification('CourseSnag Test', {
        body: 'This is a test notification!',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎉</text></svg>',
        tag: 'coursesnag-test',
        requireInteraction: true
      });
    } catch (err) {
      console.error('Error showing notification:', err);
      alert('Failed to show notification: ' + err.message);
    }
  }

  function onStopAlert() {
    dismissAlert();
  }

  function updatePollingUI() {
    if (!els.pollingSegmented) return;
    const buttons = Array.from(els.pollingSegmented.querySelectorAll('.segment-btn'));
    const index = buttons.findIndex(btn => Number(btn.dataset.interval) === state.pollingIntervalSec);
    const resolvedIndex = index >= 0 ? index : 2;

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

  // ============================================
  // Initialization
  // ============================================
  async function init() {
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
    // Allow clicking on notify status to request permission
    els.notifyStatus.addEventListener('click', async () => {
      if (hasNotificationSupport() && Notification.permission === 'default') {
        await requestNotificationPermission();
      }
    });
    if (els.pollingSegmented) {
      els.pollingSegmented.addEventListener('click', onPollingClick);
    }

    // Load settings and data
    loadSettings();
    loadTrackedSections();
    loadDismissedAlerts();
    await loadRosters();

    // Request notification permission on first visit if enabled
    if (state.notifyEnabled && hasNotificationSupport() && Notification.permission === 'default') {
      await requestNotificationPermission();
    }

    // Enable refresh button and start polling
    els.refreshBtn.disabled = false;
    startPolling();

    // Show alerts for any open tracked sections (after page reload)
    showAlertsForOpenSections();

    // Initial refresh of tracked sections
    if (state.trackedSections.length > 0) {
      refreshTrackedSections();
    }
  }

  // Expose public methods for onclick handlers
  window.app = {
    toggleTrack,
    untrack,
    toggleCourse
  };

  // Start the app
  init();
})();
