import { config } from './config.mjs';

async function cornellJson(path, searchParams, fetchImpl) {
  const url = new URL(`${config.cornellApiBase}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'CourseSnag/0.1 (course availability monitor)' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`Cornell API returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.status !== 'success') {
    throw new Error(payload.message || 'Cornell API returned an error status');
  }
  return payload.data || {};
}

export function defaultRosterSlug(rosters) {
  const rosterList = Array.isArray(rosters) ? rosters : [];
  const current = rosterList.find(roster => roster?.isDefaultRoster === 'Y') || rosterList[0];
  return current?.slug ? String(current.slug) : '';
}

export async function fetchCurrentRoster(fetchImpl = fetch) {
  const data = await cornellJson('/config/rosters.json', {}, fetchImpl);
  const roster = defaultRosterSlug(data.rosters);
  if (!roster) throw new Error('Cornell did not identify a current roster.');
  return roster;
}

export async function fetchSubjectClasses(roster, subject, fetchImpl = fetch) {
  const data = await cornellJson('/search/classes.json', {
    roster,
    subject,
    _: String(Date.now())
  }, fetchImpl);
  return data.classes || [];
}

export function buildStatusIndex(classes) {
  const index = new Map();
  for (const course of classes) {
    for (const enrollmentGroup of course.enrollGroups || []) {
      for (const section of enrollmentGroup.classSections || []) {
        index.set(String(section.classNbr), section.openStatus);
      }
    }
  }
  return index;
}

export function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
