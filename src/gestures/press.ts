import type { Point } from './circle';

// Timing and tolerances for presses on the feed. A two-finger hold makes a public like, so it must be hard to make
// by accident; a one-finger hold is kept for talking to the agent, which is harmless. Blind users often tap slowly and
// deliberately, rest a finger while listening, and put two fingers down one after the other rather than together:
// - tapMaxMs: a tap lifts within 0.6 s. Deliberate taps mostly last 0.1 to 0.4 s, so this still takes the slow ones.
//   Lifting after that is never a tap.
// - talkHoldMs: a lone finger held still for 0.8 s starts the talk hold, 0.2 s after the tap window closes, so a slow
//   tap is never mistaken for it. Once started, the talk hold owns the touch until the finger lifts: drifting while
//   speaking doesn't cut the user off. With no talk handler connected nothing starts: a finger resting while the user
//   listens still makes whatever stroke it goes on to draw, and a still press that ends is ignored.
// - joinMs: the second finger may land up to 0.5 s after the first and still make a two-finger hold. Later than that,
//   the press does nothing until every finger lifts.
// - holdWarnMs: 1 s after the second finger lands, a light haptic says the like is about to fire. Lifting either
//   finger in the next 0.4 s, comfortably more than the quarter second it takes to react to a buzz, cancels it.
// - holdMs: 1.4 s after the second finger lands, the like fires.
// - slopPt: a lone finger that moves more than 10 pt is a stroke, not a hold (the stroke gesture takes over at 12).
// - twoFingerSlopPt: either finger of a two-finger hold may drift 15 pt, since placing the second finger rocks the
//   first. More than that is a drag or a pinch, and cancels the like.
// Every hold-type gesture on the surface is decided here, under these guards.
export const PRESS = { tapMaxMs: 600, talkHoldMs: 800, joinMs: 500, holdWarnMs: 1000, holdMs: 1400, slopPt: 10, twoFingerSlopPt: 15 } as const;

export type Touch = Point & { id: number };

export type TalkHold = { start(): void; end(cancelled: boolean): void };

export type PressHandlers = {
  onLikeWarning?: () => void;
  onLike?: () => void;
  // The talk hold's handler, if one is connected when the hold would start.
  talk?: () => TalkHold | undefined;
  // How long a lone still finger waits before the talk hold starts, when not PRESS.talkHoldMs. Push to talk uses a
  // shorter wait: a slow tap still down then becomes a hold, which does nothing if it ends at once.
  talkHoldMs?: () => number | undefined;
  // A hold fired: the surface claims the touch so nothing else (a tap, a stroke) can fire for it.
  claim(): void;
};

type Schedule = (run: () => void, ms: number) => () => void;

type Phase = 'idle' | 'one' | 'two' | 'talking' | 'liked' | 'spent';

// Follows the fingers of one press, from the first touching down to the last lifting, and decides which hold, if any,
// it makes. A press that becomes anything else (a stroke, a pinch, a finger lifting early, a late second finger) is
// spent and makes nothing until every finger has lifted.
export class PressTracker {
  private phase: Phase = 'idle';
  private origins = new Map<number, Point>();
  private firstAt = 0;
  private talking: TalkHold | null = null;
  private timers: (() => void)[] = [];

  constructor(
    private readonly handlers: PressHandlers,
    private readonly schedule: Schedule,
    private readonly now: () => number,
  ) {}

  down(touches: Touch[]): void {
    for (const touch of touches) this.origins.set(touch.id, { x: touch.x, y: touch.y });
    if (this.phase === 'idle') {
      this.phase = 'one';
      this.firstAt = this.now();
      this.after(this.handlers.talkHoldMs?.() ?? PRESS.talkHoldMs, () => {
        const talk = this.phase === 'one' ? this.handlers.talk?.() : undefined;
        if (!talk) return;
        this.phase = 'talking';
        this.talking = talk;
        this.handlers.claim();
        talk.start();
      });
      if (this.origins.size === 1) return;
    }
    if (this.phase === 'one' && this.origins.size === 2 && this.now() - this.firstAt <= PRESS.joinMs) return this.startTwoFingerHold();
    if (this.phase === 'one' || this.phase === 'two') this.spend();
  }

  move(touches: Touch[]): void {
    const slop = this.phase === 'two' ? PRESS.twoFingerSlopPt : PRESS.slopPt;
    if (this.phase !== 'one' && this.phase !== 'two') return;
    const drifted = touches.some((touch) => {
      const origin = this.origins.get(touch.id);
      return origin && Math.hypot(touch.x - origin.x, touch.y - origin.y) > slop;
    });
    if (drifted) this.spend();
  }

  up(touches: Touch[]): void {
    for (const touch of touches) this.origins.delete(touch.id);
    if (this.phase === 'talking' && !this.origins.size) this.talking?.end(false);
    else if (this.phase === 'one' || this.phase === 'two') this.spend();
    if (!this.origins.size) this.reset();
  }

  // The press ended without the tracker seeing every finger lift: another gesture won, or the system took the touch.
  cancel(): void {
    if (this.phase === 'talking') this.talking?.end(true);
    this.reset();
  }

  private startTwoFingerHold() {
    this.clearTimers();
    this.phase = 'two';
    this.after(PRESS.holdWarnMs, () => this.phase === 'two' && this.handlers.onLikeWarning?.());
    this.after(PRESS.holdMs, () => {
      if (this.phase !== 'two') return;
      this.phase = 'liked';
      this.handlers.claim();
      this.handlers.onLike?.();
    });
  }

  private spend() {
    this.clearTimers();
    this.phase = 'spent';
  }

  private reset() {
    this.clearTimers();
    this.talking = null;
    this.origins.clear();
    this.phase = 'idle';
  }

  private after(ms: number, run: () => void) {
    this.timers.push(this.schedule(run, ms));
  }

  private clearTimers() {
    this.timers.forEach((cancel) => cancel());
    this.timers = [];
  }
}
