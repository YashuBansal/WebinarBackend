/**
 * Get UTC Date for a local date/time in a given IANA timezone.
 * baseDateUTC: occurrence base date (UTC).
 * timeHHMM: "HH:mm" in the given timezone.
 * timezone: IANA timezone (e.g. "Asia/Kolkata").
 */
export function getScheduledAtUTC(
  baseDateUTC: Date,
  timeHHMM: string,
  timezone: string,
): Date {
  const [hours, minutes] = timeHHMM.split(':').map((s) => parseInt(s, 10) || 0);
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dateFormatter.formatToParts(baseDateUTC);
  const year = parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10);
  const month = parseInt(
    parts.find((p) => p.type === 'month')?.value ?? '0',
    10,
  );
  const day = parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10);
  let candidate = new Date(
    Date.UTC(year, month - 1, day, hours, minutes, 0, 0),
  );
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  for (let i = 0; i < 5; i++) {
    const p = formatter.formatToParts(candidate);
    const get = (t: string) =>
      parseInt(p.find((x) => x.type === t)?.value ?? '0', 10);
    const fy = get('year'),
      fm = get('month'),
      fd = get('day'),
      fh = get('hour'),
      fmin = get('minute');
    if (
      fy === year &&
      fm === month &&
      fd === day &&
      fh === hours &&
      fmin === minutes
    ) {
      return candidate;
    }
    const diffMs =
      (year - fy) * 365 * 24 * 3600 * 1000 +
      (month - fm) * 31 * 24 * 3600 * 1000 +
      (day - fd) * 24 * 3600 * 1000 +
      (hours - fh) * 3600 * 1000 +
      (minutes - fmin) * 60 * 1000;
    candidate = new Date(candidate.getTime() + diffMs);
  }
  return candidate;
}

const INTERVAL_MS: Record<string, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

export function addInterval(
  date: Date,
  value: number,
  unit: 'minute' | 'hour' | 'day' | 'week',
): Date {
  const ms = INTERVAL_MS[unit] ?? INTERVAL_MS.day;
  return new Date(date.getTime() + value * ms);
}

/**
 * Get the base date for a program occurrence.
 * - When unit is 'day': startAt + (occurrenceIndex - 1) * intervalValue days.
 * - When unit is 'week': intervalValue is day of week 1-7 (1=Monday, 7=Sunday).
 *   Returns the occurrenceIndex-th occurrence of that weekday on or after startAt.
 */
export function getBaseDateForOccurrence(
  startAt: Date,
  occurrenceIndex: number,
  intervalUnit: 'day' | 'week',
  intervalValue: number,
): Date {
  if (intervalUnit === 'day') {
    return addInterval(
      startAt,
      (occurrenceIndex - 1) * (intervalValue || 1),
      'day',
    );
  }
  // week: intervalValue 1-7 = Monday .. Sunday (ISO-like: 7 = Sunday)
  const dayOfWeek =
    intervalValue >= 1 && intervalValue <= 7 ? intervalValue : 1;
  const jsDay = dayOfWeek === 7 ? 0 : dayOfWeek; // JS getUTCDay(): 0=Sun, 1=Mon, .. 6=Sat
  const oneDayMs = 24 * 60 * 60 * 1000;
  const first = new Date(startAt.getTime());
  first.setUTCHours(0, 0, 0, 0);
  while (first.getUTCDay() !== jsDay) {
    first.setTime(first.getTime() + oneDayMs);
  }
  const nth = new Date(first.getTime() + (occurrenceIndex - 1) * 7 * oneDayMs);
  return nth;
}
