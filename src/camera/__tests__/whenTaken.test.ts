import { whenTaken } from '../whenTaken';

const now = new Date(2026, 10, 15, 16, 0);

describe('when a photo was taken', () => {
  it('says today and yesterday with the part of the day', () => {
    expect(whenTaken(new Date(2026, 10, 15, 9, 0), now)).toBe('This morning');
    expect(whenTaken(new Date(2026, 10, 15, 13, 0), now)).toBe('This afternoon');
    expect(whenTaken(new Date(2026, 10, 15, 2, 0), now)).toBe('Last night');
    expect(whenTaken(new Date(2026, 10, 14, 15, 0), now)).toBe('Yesterday afternoon');
    expect(whenTaken(new Date(2026, 10, 14, 23, 0), now)).toBe('Last night');
  });

  it('names the weekday within the week, then the date, and the year when it differs', () => {
    expect(whenTaken(new Date(2026, 10, 11, 19, 0), now)).toBe('Wednesday evening');
    expect(whenTaken(new Date(2026, 2, 3, 12, 0), now)).toBe('March 3');
    expect(whenTaken(new Date(2024, 2, 3, 12, 0), now)).toBe('March 3, 2024');
  });
});
