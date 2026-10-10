import type { Instrument } from '../../src/types/trading';

const WEEKDAY_BY_NAME: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function isConfiguredEntrySessionOpen(instrument: Instrument, timestamp: number): boolean {
  if (!Number.isFinite(timestamp) || !instrument.timezone || !instrument.tradingHours) return false;

  let weekday: number;
  let minuteOfDay: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: instrument.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(timestamp);
    const part = (type: string) => parts.find((value) => value.type === type)?.value;
    const dayName = part('weekday');
    const hour = Number(part('hour'));
    const minute = Number(part('minute'));
    if (!dayName || WEEKDAY_BY_NAME[dayName] === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
      return false;
    }
    weekday = WEEKDAY_BY_NAME[dayName];
    minuteOfDay = hour * 60 + minute;
  } catch {
    return false;
  }

  const isWeekend = weekday === 0 || weekday === 6;
  if (instrument.tradingHours === '24/7/365') {
    return instrument.weekendEntryAllowed === true;
  }

  const equityHours = instrument.tradingHours.match(/^09:30-16:00 EST$/);
  if (equityHours) {
    if (isWeekend) return false;
    const buffer = instrument.marketCloseBufferMinutes ?? 15;
    if (!Number.isFinite(buffer) || buffer < 0 || buffer >= 390) return false;
    const openMinute = 9 * 60 + 30;
    const closeMinute = 16 * 60 - buffer;
    return minuteOfDay >= openMinute && minuteOfDay < closeMinute;
  }

  if (instrument.tradingHours === '24/5 Global FX' ||
      instrument.tradingHours === '23/5 Global Metals' ||
      instrument.tradingHours === '23/5 NYMEX') {
    const rolloverStart = 16 * 60 + 45;
    const rolloverEnd = 18 * 60;
    if (weekday === 6 || minuteOfDay >= rolloverStart && minuteOfDay < rolloverEnd) return false;
    if (weekday === 0) return minuteOfDay >= rolloverEnd;
    if (weekday === 5) return minuteOfDay < rolloverStart;
    return weekday >= 1 && weekday <= 4;
  }

  return false;
}
