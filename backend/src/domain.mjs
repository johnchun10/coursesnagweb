const REQUIRED_TRACKER_FIELDS = ['roster', 'subject', 'classNbr'];
const OPTIONAL_TEXT_FIELDS = [
  'catalogNbr',
  'title',
  'section',
  'ssrComponent',
  'classTime'
];

function normalizedString(value, maxLength) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, maxLength);
}

export function normalizeTrackerInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Tracker body must be a JSON object.');
  }

  for (const field of REQUIRED_TRACKER_FIELDS) {
    if (!normalizedString(input[field], 100)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const roster = normalizedString(input.roster, 80);
  const subject = normalizedString(input.subject, 16).toUpperCase();
  const classNbr = normalizedString(input.classNbr, 16);

  if (!/^[A-Z0-9_-]+$/.test(subject)) {
    throw new Error('Subject contains unsupported characters.');
  }
  if (!/^\d+$/.test(classNbr)) {
    throw new Error('Class number must contain only digits.');
  }

  const tracker = {
    roster,
    subject,
    classNbr,
    trackerId: `${roster}:${classNbr}`
  };

  for (const field of OPTIONAL_TEXT_FIELDS) {
    tracker[field] = normalizedString(input[field], field === 'title' ? 300 : 120);
  }

  return tracker;
}

export function groupTrackersByRosterSubject(trackers) {
  const groups = new Map();
  for (const tracker of trackers) {
    const key = `${tracker.roster}:${tracker.subject}`;
    if (!groups.has(key)) {
      groups.set(key, {
        roster: tracker.roster,
        subject: tracker.subject,
        trackers: []
      });
    }
    groups.get(key).trackers.push(tracker);
  }
  return groups;
}

export function shouldAlertForTransition(oldStatus, newStatus) {
  return oldStatus !== 'O' && newStatus === 'O';
}

export function publicTracker(item) {
  return {
    trackerId: item.trackerId,
    roster: item.roster,
    subject: item.subject,
    classNbr: item.classNbr,
    catalogNbr: item.catalogNbr || '',
    title: item.title || '',
    section: item.section || '',
    ssrComponent: item.ssrComponent || '',
    classTime: item.classTime || '',
    lastStatus: item.lastStatus || 'UNKNOWN',
    lastCheckedAt: item.lastCheckedAt || null,
    createdAt: item.createdAt
  };
}
