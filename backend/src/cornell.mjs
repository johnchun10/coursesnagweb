import { config } from './config.mjs';

export async function fetchSubjectClasses(roster, subject, fetchImpl = fetch) {
  const url = new URL(`${config.cornellApiBase}/search/classes.json`);
  url.searchParams.set('roster', roster);
  url.searchParams.set('subject', subject);
  url.searchParams.set('_', String(Date.now()));

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
  return payload.data?.classes || [];
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
