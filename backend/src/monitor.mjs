import { randomUUID } from 'node:crypto';
import { buildStatusIndex, fetchCurrentRoster, fetchSubjectClasses, wait } from './cornell.mjs';
import { availabilityEventForTransition, groupTrackersByRosterSubject } from './domain.mjs';
import { currentMode } from './mode.mjs';
import {
  monitorPollIsDue,
  monitorTransitionId,
  pollingIntervalMinutesAt
} from './polling.mjs';
import { sendAlertMessages } from './queue.mjs';
import {
  acquireMonitorLease,
  deleteTracker,
  getMonitorRunStatus,
  getProfiles,
  listAllActiveTrackers,
  putMonitorPollStarted,
  putMonitorRunStatus,
  releaseMonitorLease,
  updateTrackerStatus
} from './storage.mjs';

const MINIMUM_REMAINING_TIME_MS = 20_000;
const MONITOR_LEASE_SECONDS = 360;

async function completeMonitorRun(summary) {
  const result = {
    ...summary,
    completedAt: new Date().toISOString()
  };
  await putMonitorRunStatus(result);
  console.log('Monitor run complete', result);
  return result;
}

export function monitorStatusForFailures(failedGroups, deferredGroups = 0) {
  return Number(failedGroups || 0) > 0 || Number(deferredGroups || 0) > 0
    ? 'degraded'
    : 'ok';
}

export function partitionTrackersForRoster(trackers, currentRoster) {
  const current = [];
  const expired = [];
  for (const tracker of trackers) {
    (tracker.roster === currentRoster ? current : expired).push(tracker);
  }
  return { current, expired };
}

export function rotateMonitorGroups(groups, resumeAfterGroup = '') {
  const entries = [...groups.entries()];
  if (!resumeAfterGroup || entries.length < 2) return entries;
  const previousIndex = entries.findIndex(([key]) => key === resumeAfterGroup);
  if (previousIndex < 0) return entries;
  const start = (previousIndex + 1) % entries.length;
  return [...entries.slice(start), ...entries.slice(0, start)];
}

function remainingTimeIsLow(context) {
  return typeof context?.getRemainingTimeInMillis === 'function'
    && context.getRemainingTimeInMillis() < MINIMUM_REMAINING_TIME_MS;
}

function messageForTransition(tracker, profile, checkedAt, queuedAt) {
  const discordUserId = profile?.discordUserId || tracker.userId;
  if (!discordUserId) return null;
  return {
    eventId: monitorTransitionId(tracker, tracker.notificationType, tracker.newStatus),
    type: tracker.notificationType,
    discordUserId,
    tracker: {
      roster: tracker.roster,
      subject: tracker.subject,
      classNbr: tracker.classNbr,
      catalogNbr: tracker.catalogNbr || '',
      title: tracker.title || '',
      section: tracker.section || '',
      classTime: tracker.classTime || ''
    },
    status: tracker.newStatus,
    sourceObservedAt: checkedAt,
    detectedAt: checkedAt,
    queuedAt
  };
}

async function monitorCycle({ context, intervalMinutes, previousRun, startedAt }) {
  let trackers = await listAllActiveTrackers();
  if (!trackers.length) {
    return completeMonitorRun({
      status: 'ok',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      processedGroups: 0,
      deferredGroups: 0,
      failedGroups: 0,
      removed: 0,
      intervalMinutes,
      startedAt
    });
  }

  let currentRoster;
  try {
    currentRoster = await fetchCurrentRoster();
  } catch (error) {
    console.error('Cornell current-roster check failed', { message: error.message });
    return completeMonitorRun({
      status: 'degraded',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      processedGroups: 0,
      deferredGroups: 0,
      failedGroups: 1,
      removed: 0,
      intervalMinutes,
      startedAt
    });
  }

  const rosterTrackers = partitionTrackersForRoster(trackers, currentRoster);
  for (const tracker of rosterTrackers.expired) {
    await deleteTracker(tracker.userId, tracker.trackerId);
  }
  let removed = rosterTrackers.expired.length;
  trackers = rosterTrackers.current;

  if (!trackers.length) {
    return completeMonitorRun({
      status: 'ok',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      processedGroups: 0,
      deferredGroups: 0,
      failedGroups: 0,
      removed,
      intervalMinutes,
      startedAt
    });
  }

  const groups = groupTrackersByRosterSubject(trackers);
  const orderedGroups = rotateMonitorGroups(groups, previousRun?.resumeAfterGroup);
  let checked = 0;
  let alertsQueued = 0;
  let processedGroups = 0;
  let failedGroups = 0;
  let resumeAfterGroup = '';

  // The current-roster lookup is also a Cornell API request. Keep the first
  // subject request at least one second behind it, then space every group.
  await wait(1_000);

  for (const [groupKey, group] of orderedGroups) {
    if (remainingTimeIsLow(context)) break;
    if (processedGroups > 0) await wait(1_000);

    resumeAfterGroup = groupKey;
    processedGroups += 1;

    try {
      const classes = await fetchSubjectClasses(group.roster, group.subject);
      const statuses = buildStatusIndex(classes);
      const checkedAt = new Date().toISOString();
      const changed = [];
      const observations = [];

      for (const tracker of group.trackers) {
        const newStatus = statuses.get(String(tracker.classNbr));
        if (newStatus === undefined) {
          await deleteTracker(tracker.userId, tracker.trackerId);
          removed += 1;
          continue;
        }

        const notificationType = availabilityEventForTransition(tracker.lastStatus, newStatus);
        if (notificationType) {
          changed.push({ ...tracker, notificationType, newStatus });
        }
        observations.push({ tracker, newStatus });
        checked += 1;
      }

      // A stop operation can begin during a long scan. Do not queue another
      // group after the mode leaves its stable Discord Active state.
      if (await currentMode() !== 'cloud') {
        const deferredGroups = groups.size - processedGroups + 1;
        return completeMonitorRun({
          status: 'paused',
          checked,
          alertsQueued,
          groups: groups.size,
          processedGroups: processedGroups - 1,
          deferredGroups,
          failedGroups,
          removed,
          intervalMinutes,
          startedAt,
          resumeAfterGroup: previousRun?.resumeAfterGroup || ''
        });
      }

      const profiles = await getProfiles(changed.map(item => item.userId));
      const queuedAt = new Date().toISOString();
      const messages = changed.flatMap(tracker => {
        const message = messageForTransition(
          tracker,
          profiles.get(tracker.userId),
          checkedAt,
          queuedAt
        );
        return message ? [message] : [];
      });

      // Commit each group independently. Earlier groups remain delivered and
      // current even if a later Cornell request fails or the run nears timeout.
      if (messages.length) alertsQueued += await sendAlertMessages(messages);
      for (const observation of observations) {
        await updateTrackerStatus(observation.tracker, observation.newStatus, checkedAt);
      }
    } catch (error) {
      failedGroups += 1;
      console.error('Cornell group processing failed', {
        roster: group.roster,
        subject: group.subject,
        message: error.message
      });
    }
  }

  const deferredGroups = Math.max(0, groups.size - processedGroups);
  return completeMonitorRun({
    status: monitorStatusForFailures(failedGroups, deferredGroups),
    checked,
    alertsQueued,
    groups: groups.size,
    processedGroups,
    deferredGroups,
    failedGroups,
    removed,
    intervalMinutes,
    startedAt,
    resumeAfterGroup: deferredGroups > 0
      ? (resumeAfterGroup || previousRun?.resumeAfterGroup || '')
      : ''
  });
}

export async function handler(event = {}, context = {}) {
  if (await currentMode() !== 'cloud') {
    return completeMonitorRun({
      status: 'paused',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      processedGroups: 0,
      deferredGroups: 0,
      failedGroups: 0,
      removed: 0,
      intervalMinutes: 0
    });
  }

  const now = new Date();
  const intervalMinutes = pollingIntervalMinutesAt(now);
  const previousRun = await getMonitorRunStatus();
  if (!monitorPollIsDue(previousRun?.lastPollStartedAt, now, event.force === true)) {
    return {
      status: 'scheduled',
      intervalMinutes,
      lastPollStartedAt: previousRun?.lastPollStartedAt || null
    };
  }

  const leaseOwner = randomUUID();
  const leaseAcquired = await acquireMonitorLease(
    leaseOwner,
    now,
    MONITOR_LEASE_SECONDS
  );
  if (!leaseAcquired) {
    return { status: 'busy', intervalMinutes };
  }

  const startedAt = now.toISOString();
  try {
    if (await currentMode() !== 'cloud') {
      return { status: 'paused', intervalMinutes };
    }
    await putMonitorPollStarted(startedAt, intervalMinutes);
    return await monitorCycle({ context, intervalMinutes, previousRun, startedAt });
  } catch (error) {
    console.error('Monitor cycle failed before it could finish', { message: error.message });
    return completeMonitorRun({
      status: 'degraded',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      processedGroups: 0,
      deferredGroups: 0,
      failedGroups: 1,
      removed: 0,
      intervalMinutes,
      startedAt
    });
  } finally {
    await releaseMonitorLease(leaseOwner);
  }
}
