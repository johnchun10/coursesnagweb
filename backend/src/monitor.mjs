import { buildStatusIndex, fetchSubjectClasses, wait } from './cornell.mjs';
import { groupTrackersByRosterSubject, shouldAlertForTransition } from './domain.mjs';
import { sendAlertMessages } from './queue.mjs';
import {
  getProfiles,
  listAllActiveTrackers,
  updateTrackerStatus
} from './storage.mjs';

export async function handler() {
  const trackers = await listAllActiveTrackers();
  if (!trackers.length) {
    return { checked: 0, alertsQueued: 0, groups: 0 };
  }

  const groups = groupTrackersByRosterSubject(trackers);
  const opened = [];
  const observations = [];
  let checked = 0;
  let groupIndex = 0;

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

        if (shouldAlertForTransition(tracker.lastStatus, newStatus)) {
          opened.push({ ...tracker, newStatus, checkedAt });
        }
        observations.push({ tracker, newStatus, checkedAt });
        checked += 1;
      }
    } catch (error) {
      console.error('Cornell group check failed', {
        roster: group.roster,
        subject: group.subject,
        message: error.message
      });
    }
  }

  const profiles = await getProfiles(opened.map(item => item.userId));
  const messages = opened.flatMap(tracker => {
    const discordUserId = profiles.get(tracker.userId)?.discordUserId;
    if (!discordUserId) return [];
    return [{
      type: 'course-opened',
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
      detectedAt: tracker.checkedAt
    }];
  });

  // Queue notifications before committing the OPEN status. If queueing fails,
  // the next monitor run can retry rather than silently losing the alert.
  const alertsQueued = messages.length ? await sendAlertMessages(messages) : 0;
  for (const observation of observations) {
    await updateTrackerStatus(
      observation.tracker,
      observation.newStatus,
      observation.checkedAt
    );
  }
  const summary = { checked, alertsQueued, groups: groups.size };
  console.log('Monitor run complete', summary);
  return summary;
}
