import { buildStatusIndex, fetchSubjectClasses, wait } from './cornell.mjs';
import { randomUUID } from 'node:crypto';
import { availabilityEventForTransition, groupTrackersByRosterSubject } from './domain.mjs';
import { currentMode } from './mode.mjs';
import { sendAlertMessages } from './queue.mjs';
import {
  getProfiles,
  listAllActiveTrackers,
  putMonitorRunStatus,
  updateTrackerStatus
} from './storage.mjs';

async function completeMonitorRun(summary) {
  const result = {
    ...summary,
    completedAt: new Date().toISOString()
  };
  await putMonitorRunStatus(result);
  console.log('Monitor run complete', result);
  return summary;
}

export function monitorStatusForFailures(failedGroups) {
  return Number(failedGroups || 0) > 0 ? 'degraded' : 'ok';
}

export async function handler() {
  if (await currentMode() !== 'cloud') {
    return completeMonitorRun({
      status: 'paused',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      failedGroups: 0
    });
  }

  const trackers = await listAllActiveTrackers();
  if (!trackers.length) {
    return completeMonitorRun({
      status: 'ok',
      checked: 0,
      alertsQueued: 0,
      groups: 0,
      failedGroups: 0
    });
  }

  const groups = groupTrackersByRosterSubject(trackers);
  const changed = [];
  const observations = [];
  let checked = 0;
  let groupIndex = 0;
  let failedGroups = 0;

  for (const group of groups.values()) {
    if (groupIndex > 0) await wait(1_000);
    groupIndex += 1;

    try {
      const classes = await fetchSubjectClasses(group.roster, group.subject);
      const statuses = buildStatusIndex(classes);
      const checkedAt = new Date().toISOString();

      for (const tracker of group.trackers) {
        const newStatus = statuses.get(String(tracker.classNbr));
        if (newStatus === undefined) continue;

        const notificationType = availabilityEventForTransition(tracker.lastStatus, newStatus);
        if (notificationType) {
          changed.push({ ...tracker, notificationType, newStatus, checkedAt });
        }
        observations.push({ tracker, newStatus, checkedAt });
        checked += 1;
      }
    } catch (error) {
      failedGroups += 1;
      console.error('Cornell group check failed', {
        roster: group.roster,
        subject: group.subject,
        message: error.message
      });
    }
  }

  if (await currentMode() !== 'cloud') {
    return completeMonitorRun({
      status: 'paused',
      checked,
      alertsQueued: 0,
      groups: groups.size,
      failedGroups
    });
  }

  const profiles = await getProfiles(changed.map(item => item.userId));
  const messages = changed.flatMap(tracker => {
    const discordUserId = profiles.get(tracker.userId)?.discordUserId || tracker.userId;
    if (!discordUserId) return [];
    return [{
      eventId: randomUUID(),
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
      detectedAt: tracker.checkedAt
    }];
  });

  // Queue notifications before committing the changed status. If queueing fails,
  // the next monitor run can retry rather than silently losing the alert.
  const alertsQueued = messages.length ? await sendAlertMessages(messages) : 0;
  for (const observation of observations) {
    await updateTrackerStatus(
      observation.tracker,
      observation.newStatus,
      observation.checkedAt
    );
  }
  const summary = {
    status: monitorStatusForFailures(failedGroups),
    checked,
    alertsQueued,
    groups: groups.size,
    failedGroups
  };
  return completeMonitorRun(summary);
}
