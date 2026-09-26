// The ledger's "today" is an India business date, so every date rule must resolve
// it from one injectable instant instead of scattered `new Date()` reads.

export interface BusinessClock {
  now(): Date;
}

export const systemClock: BusinessClock = { now: () => new Date() };

function indiaDateParts(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function todayInIndia(clock: BusinessClock = systemClock) {
  return indiaDateParts(clock.now());
}

/**
 * A database instant and a database calendar date answer to the same question:
 * which India business day does this belong to. Slicing a timestamp instead
 * reads the UTC day, which is a day early for everything after 6:30pm IST.
 */
export function toIndiaBusinessDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : indiaDateParts(parsed);
}
