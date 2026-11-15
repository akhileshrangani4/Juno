import { PRESS, PressTracker } from '../press';

function setup({ talk = true } = {}) {
  let now = 0;
  let timers: { at: number; run: () => void; live: boolean }[] = [];
  const log: string[] = [];
  const tracker = new PressTracker(
    {
      onLikeWarning: () => log.push(`warn@${now}`),
      onLike: () => log.push(`like@${now}`),
      talk: () =>
        talk
          ? {
              start: () => log.push(`talk@${now}`),
              end: (cancelled: boolean) => log.push(`talkEnd${cancelled ? '(cancelled)' : ''}@${now}`),
            }
          : undefined,
      claim: () => log.push(`claim@${now}`),
    },
    (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    () => now,
  );
  const to = (ms: number) => {
    for (;;) {
      const next = timers.filter((timer) => timer.live && timer.at <= ms).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.live = false;
      next.run();
    }
    timers = timers.filter((timer) => timer.live);
    now = ms;
  };
  const finger = (id: number, x = 150 + id * 60, y = 500) => ({ id, x, y });
  return { tracker, log, to, finger };
}

describe('press timing', () => {
  it('keeps every hold clear of the tap window, and leaves time to lift after the like warning', () => {
    expect(PRESS.talkHoldMs - PRESS.tapMaxMs).toBeGreaterThanOrEqual(200);
    expect(PRESS.joinMs).toBeLessThan(PRESS.talkHoldMs);
    expect(PRESS.holdMs - PRESS.holdWarnMs).toBeGreaterThanOrEqual(400);
    expect(PRESS.slopPt).toBeLessThan(12);
  });
});

describe('two-finger hold (like)', () => {
  it('warns at 1 s and likes at 1.4 s, counted from the second finger, and claims the touch', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1), finger(2)]);
    to(PRESS.holdWarnMs - 1);
    expect(log).toEqual([]);
    to(PRESS.holdMs);
    expect(log).toEqual([`warn@${PRESS.holdWarnMs}`, `claim@${PRESS.holdMs}`, `like@${PRESS.holdMs}`]);
    tracker.up([finger(1), finger(2)]);
    expect(log.some((line) => line.startsWith('talk'))).toBe(false);
  });

  it('accepts a second finger placed up to half a second after the first, and times the hold from it', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1)]);
    to(450);
    tracker.down([finger(2)]);
    to(450 + PRESS.holdMs - 1);
    expect(log).toEqual([`warn@${450 + PRESS.holdWarnMs}`]);
    to(450 + PRESS.holdMs);
    expect(log.at(-1)).toBe(`like@${450 + PRESS.holdMs}`);
  });

  it('does nothing at all when the second finger lands later than that', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1)]);
    to(PRESS.joinMs + 100);
    tracker.down([finger(2)]);
    to(5000);
    expect(log).toEqual([]);
  });

  it('cancels when either finger lifts early, even after the warning', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1), finger(2)]);
    to(PRESS.holdWarnMs + 100);
    tracker.up([finger(2)]);
    to(5000);
    tracker.up([finger(1)]);
    expect(log).toEqual([`warn@${PRESS.holdWarnMs}`]);
  });

  it('never likes for two fingers that drag or pinch, but allows a small rock while placing them', () => {
    const drag = setup();
    drag.tracker.down([drag.finger(1), drag.finger(2)]);
    drag.to(600);
    drag.tracker.move([drag.finger(1, 210, 530), drag.finger(2, 270, 530)]);
    drag.to(5000);
    expect(drag.log).toEqual([]);
    const pinch = setup();
    pinch.tracker.down([pinch.finger(1), pinch.finger(2)]);
    pinch.to(300);
    pinch.tracker.move([pinch.finger(1, 130, 500), pinch.finger(2, 290, 500)]);
    pinch.to(5000);
    expect(pinch.log).toEqual([]);
    const rock = setup();
    rock.tracker.down([rock.finger(1), rock.finger(2)]);
    rock.tracker.move([rock.finger(1, 222, 500), rock.finger(2, 270, 512)]);
    rock.to(PRESS.holdMs);
    expect(rock.log.at(-1)).toBe(`like@${PRESS.holdMs}`);
  });

  it('never likes when a second finger lands during a one-finger stroke', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1)]);
    to(100);
    tracker.move([finger(1, 240, 460)]);
    tracker.down([finger(2, 300, 600)]);
    to(5000);
    expect(log).toEqual([]);
  });

  it('ignores a third finger after the like fired, and starts nothing on a third finger before it', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1), finger(2)]);
    to(300);
    tracker.down([finger(3)]);
    to(5000);
    expect(log).toEqual([]);
  });
});

describe('one-finger hold (talk)', () => {
  it('starts after the tap window has closed and ends when the finger lifts', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1)]);
    to(PRESS.talkHoldMs - 1);
    expect(log).toEqual([]);
    to(PRESS.talkHoldMs);
    expect(log).toEqual([`claim@${PRESS.talkHoldMs}`, `talk@${PRESS.talkHoldMs}`]);
    to(3000);
    tracker.up([finger(1)]);
    expect(log.at(-1)).toBe('talkEnd@3000');
  });

  it('starts nothing for a tap, a slow tap, or a finger that moves first', () => {
    for (const lift of [150, PRESS.tapMaxMs, PRESS.talkHoldMs - 1]) {
      const { tracker, log, to, finger } = setup();
      tracker.down([finger(1)]);
      to(lift);
      tracker.up([finger(1)]);
      to(5000);
      expect(log).toEqual([]);
    }
    const resting = setup();
    resting.tracker.down([resting.finger(1)]);
    resting.to(500);
    resting.tracker.move([resting.finger(1, 240, 500)]);
    resting.to(5000);
    expect(resting.log).toEqual([]);
  });

  it('keeps talking when the finger drifts or a second finger lands after it started, and never likes', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1)]);
    to(PRESS.talkHoldMs + 100);
    tracker.move([finger(1, 300, 600)]);
    tracker.down([finger(2)]);
    to(5000);
    tracker.up([finger(2)]);
    tracker.up([finger(1)]);
    expect(log).toEqual([`claim@${PRESS.talkHoldMs}`, `talk@${PRESS.talkHoldMs}`, 'talkEnd@5000']);
  });

  it('claims nothing with no talk handler connected, so a resting finger can still become a stroke', () => {
    const { tracker, log, to, finger } = setup({ talk: false });
    tracker.down([finger(1)]);
    to(3000);
    expect(log).toEqual([]);
    tracker.move([finger(1, 300, 600)]);
    tracker.up([finger(1, 300, 600)]);
    expect(log).toEqual([]);
  });

  it('ends cancelled when the system takes the touch', () => {
    const { tracker, log, to, finger } = setup();
    tracker.down([finger(1)]);
    to(PRESS.talkHoldMs + 10);
    tracker.cancel();
    expect(log.at(-1)).toBe(`talkEnd(cancelled)@${PRESS.talkHoldMs + 10}`);
  });
});
