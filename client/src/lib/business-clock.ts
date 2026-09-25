// The ledger's "today" is an India business date, so every date rule must resolve
// it from one injectable instant instead of scattered `new Date()` reads.

export interface BusinessClock {
  now(): Date;
}

export const systemClock: BusinessClock = { now: () => new Date() };

export function todayInIndia(clock: BusinessClock = systemClock) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(clock.now());
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
