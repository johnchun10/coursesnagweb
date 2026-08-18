export const MONITOR_TIME_ZONE = 'America/New_York';

const MINUTE_MS = 60_000;

function hourInMonitorTimeZone(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MONITOR_TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Number(parts.find(part => part.type === 'hour')?.value || 0);
}

export function pollingIntervalMinutesAt(date = new Date()) {
  const hour = hourInMonitorTimeZone(date);
  if (hour >= 6 && hour < 17) return 5;
  if (hour >= 17) return 10;
  return 30;
}

export function monitorPollIsDue(lastPollStartedAt, now = new Date(), force = false) {
  if (force || !lastPollStartedAt) return true;
  const previous = Date.parse(lastPollStartedAt);
  if (!Number.isFinite(previous)) return true;
  const intervalMs = pollingIntervalMinutesAt(now) * MINUTE_MS;
  return now.getTime() - previous >= intervalMs;
}

export function monitorTransitionId(tracker, notificationType, newStatus) {
  const previousObservation = tracker.lastCheckedAt || tracker.createdAt || 'initial';
  return [
    'course-transition',
    tracker.userId,
    tracker.roster,
    tracker.classNbr,
    tracker.lastStatus || 'UNKNOWN',
    newStatus,
    previousObservation,
    notificationType
  ].join(':');
}
