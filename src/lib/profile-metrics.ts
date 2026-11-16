function localDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function shiftDay(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + amount));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** Calculate both streaks from unique local calendar days, independent of query order. */
export function calculateStreaks(
  dates: string[],
  now: Date = new Date()
): { current: number; longest: number } {
  const days = [...new Set(
    dates.flatMap((value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? [] : [localDayKey(date)];
    })
  )].sort();

  if (!days.length) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let index = 1; index < days.length; index++) {
    if (days[index] === shiftDay(days[index - 1], 1)) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  const today = localDayKey(now);
  const yesterday = shiftDay(today, -1);
  const completedDays = new Set(days);
  let cursor = completedDays.has(today)
    ? today
    : completedDays.has(yesterday)
      ? yesterday
      : '';
  let current = 0;

  while (cursor && completedDays.has(cursor)) {
    current++;
    cursor = shiftDay(cursor, -1);
  }

  return { current, longest };
}
