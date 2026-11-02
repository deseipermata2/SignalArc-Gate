import { HttpError } from './http'
/** Global application budget, not an edge limiter or a fairness guarantee. No client-selected keys. */
export async function takeApiBudget(
  db: D1Database,
  now: number,
  limits = { minute: 600, day: 20000 },
) {
  if (
    !Number.isSafeInteger(now) ||
    now <= 0 ||
    !Number.isSafeInteger(limits.minute) ||
    limits.minute < 1 ||
    !Number.isSafeInteger(limits.day) ||
    limits.day < limits.minute
  )
    throw new HttpError(503, 'Request budget unavailable')
  const minute = Math.floor(now / 60000),
    day = Math.floor(now / 86400000)
  // An old/backward clock can consume existing quota, never reset it. One SQL CAS is the authority.
  const result = await db
    .prepare(
      `INSERT INTO api_request_budget VALUES (1,?,1,?,1)
    ON CONFLICT(id) DO UPDATE SET
      minute_start=max(minute_start,excluded.minute_start),
      minute_hits=CASE WHEN excluded.minute_start>minute_start THEN 1 ELSE minute_hits+1 END,
      day_start=max(day_start,excluded.day_start),
      day_hits=CASE WHEN excluded.day_start>day_start THEN 1 ELSE day_hits+1 END
    WHERE (excluded.minute_start>minute_start OR minute_hits<?)
      AND (excluded.day_start>day_start OR day_hits<?) RETURNING id`,
    )
    .bind(minute, day, limits.minute, limits.day)
    .first()
  if (!result) throw new HttpError(429, 'Application request budget exceeded')
}
