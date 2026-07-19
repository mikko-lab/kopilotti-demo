import { addBusinessDays } from './business-days.ts';
import { invariant } from './errors.ts';
import type { BusinessCalendarPort } from './ports.ts';

export class BusinessCalendar implements BusinessCalendarPort {
  readonly #holidays: ReadonlySet<string>;

  constructor(holidayIsoDates: readonly string[] = []) {
    for (const value of holidayIsoDates) {
      invariant(/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'INVALID_HOLIDAY_DATE', 'Holiday must use YYYY-MM-DD');
    }
    this.#holidays = new Set(holidayIsoDates);
  }

  isBusinessDay(date: Date): boolean {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6 && !this.#holidays.has(date.toISOString().slice(0, 10));
  }

  addBusinessDays(input: Date, count: number): Date { return addBusinessDays(input, count, this.#holidays); }

  calculateDeadline(startDate: string, businessDaysRequired: number): string {
    const parsed = new Date(startDate);
    invariant(Number.isFinite(parsed.getTime()), 'INVALID_START_DATE', 'Start date must be ISO-8601');
    return this.addBusinessDays(parsed, businessDaysRequired).toISOString();
  }
}
