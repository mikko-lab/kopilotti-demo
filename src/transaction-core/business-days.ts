const DAY_MS = 86_400_000;

export function addBusinessDays(input: Date, count: number, holidays: ReadonlySet<string> = new Set()): Date {
  if (!Number.isInteger(count) || count < 0) throw new TypeError('count must be a non-negative integer');
  const result = new Date(input.getTime());
  let remaining = count;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(result.toISOString().slice(0, 10))) remaining -= 1;
  }
  return result;
}

export function isDeadlineExpired(deadline: string, now: Date): boolean {
  const parsed = Date.parse(deadline);
  if (!Number.isFinite(parsed)) throw new TypeError('paymentDeadline must be ISO-8601');
  return now.getTime() >= parsed;
}

export function assertValidDate(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || Math.abs(value.getTime()) > 8.64e15 - DAY_MS) {
    throw new TypeError('clock returned an invalid date');
  }
}
