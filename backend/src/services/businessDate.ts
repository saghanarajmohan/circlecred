export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';

/** Calendar date in CircleCred's business timezone. `now` is injectable for deterministic tests. */
export function businessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function businessPeriod(now: Date = new Date()): string {
  return businessDate(now).slice(0, 7);
}

/** SQLite CURRENT_TIMESTAMP values have no zone suffix but represent UTC. */
export function parseStoredTimestamp(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

export function installmentStatus(target: number, confirmedPaid: number, deadline: string, now: Date = new Date()) {
  const remaining = Math.max(0, target - confirmedPaid);
  if (remaining === 0) return { status: 'paid', timingStatus: 'completed', remainingAmount: 0 };
  const today = businessDate(now);
  const timingStatus = deadline > today ? 'upcoming' : deadline === today ? 'due_today' : 'overdue';
  return { status: confirmedPaid > 0 ? 'partially_paid' : timingStatus, timingStatus, remainingAmount: remaining };
}

export function validDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}
