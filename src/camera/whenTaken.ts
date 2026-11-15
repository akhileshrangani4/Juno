// When a photo was taken, the way a person would say it: "This morning", "Yesterday afternoon", "Tuesday
// evening", "March 3", "March 3, 2024". Pure, so it is unit tested.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function whenTaken(taken: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(taken)) / 86_400_000);
  const part = partOfDay(taken.getHours());
  if (days === 0) return part === 'night' ? (taken.getHours() < 5 ? 'Last night' : 'Tonight') : `This ${part}`;
  if (days === 1) return part === 'night' ? 'Last night' : `Yesterday ${part}`;
  if (days > 1 && days < 7) return `${DAYS[taken.getDay()]} ${part}`;
  const date = `${MONTHS[taken.getMonth()]} ${taken.getDate()}`;
  return taken.getFullYear() === now.getFullYear() ? date : `${date}, ${taken.getFullYear()}`;
}
