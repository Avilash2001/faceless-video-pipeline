/** A daily window in local time, in minutes after midnight; one whose start is after its end runs past midnight. */
export interface TimeRange {
  start: number;
  end: number;
}

/** "23:00-08:00" → { start: 1380, end: 480 }. The same start and end make an empty range. */
export function parseTimeRange(name: string, value: string): TimeRange {
  const match = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(value.trim());
  const [startHour, startMinute, endHour, endMinute] = (match ?? []).slice(1).map(Number);
  if (!match || startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
    throw new Error(`${name} must be a time range like 23:00-08:00, not "${value}"`);
  }
  return { start: startHour * 60 + startMinute, end: endHour * 60 + endMinute };
}

/** Whether `at`, in local time, falls in `range`, which includes its start but not its end. */
export function inTimeRange(at: Date, { start, end }: TimeRange): boolean {
  const minute = at.getHours() * 60 + at.getMinutes();
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}
