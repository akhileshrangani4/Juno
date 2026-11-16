import { loadDiscoveryProgress, saveDiscoveryProgress } from '../progressStore';
import { offerTip, releaseTip, startTips, TIP_WAIT_MS, tipsAgain, tipsOff, type TipState } from '../tips';

jest.mock('@/storage/keyValueStore', () => {
  const actual = jest.requireActual('@/storage/keyValueStore');
  return { ...actual, secureStore: actual.createMemoryStore() };
});

const fresh = (session = 1): TipState => startTips({ introduced: [], tipsOff: false, lastTipSession: 0 }, session);
const quiet = (at: number, extra: Partial<{ mode: 'scroll' | 'comments' | 'agent'; narrating: boolean }> = {}) => ({ at, mode: 'scroll' as const, narrating: false, ...extra });

describe('just-in-time tips', () => {
  it('plays the first useful tip once, at most one per session', () => {
    const offered = offerTip(fresh(), ['swipeUp', 'twoFingerHold'], 0);
    expect(offered.pending?.id).toBe('swipeUp');
    const { state, tip } = releaseTip(offered, quiet(1000));
    expect(tip?.intro).toBe('Tip: swipe up to hear the replies to a post.');
    expect(state.introduced).toEqual(['swipeUp']);
    expect(offerTip(state, ['twoFingerHold'], 2000)).toBe(state);
    const next = offerTip(startTips(state, 2), ['swipeUp', 'twoFingerHold'], 0);
    expect(next.pending?.id).toBe('twoFingerHold');
  });

  it('only offers tip gestures, never the launch ones', () => {
    expect(offerTip(fresh(), ['swipeLeft', 'tapTop'], 0).pending).toBeNull();
  });

  it('waits while anything is being said, and drops the tip once it has waited too long', () => {
    const offered = offerTip(fresh(), ['swipeUp'], 0);
    const waiting = releaseTip(offered, quiet(5000, { narrating: true }));
    expect(waiting.tip).toBeNull();
    expect(waiting.state.pending?.id).toBe('swipeUp');
    const late = releaseTip(waiting.state, quiet(TIP_WAIT_MS + 1));
    expect(late.tip).toBeNull();
    expect(late.state.pending).toBeNull();
    expect(late.state.introduced).toEqual([]);
    expect(late.state.lastTipSession).toBe(0);
  });

  it('drops the tip while the agent is awake, because the call owns the audio', () => {
    const { state, tip } = releaseTip(offerTip(fresh(), ['swipeUp'], 0), quiet(1000, { mode: 'agent' }));
    expect(tip).toBeNull();
    expect(state.pending).toBeNull();
  });

  it('stays quiet once tips are off, and plays them again from the start when asked', () => {
    const off = tipsOff(offerTip(fresh(), ['swipeUp'], 0));
    expect(off.pending).toBeNull();
    expect(offerTip(off, ['swipeUp'], 0)).toBe(off);
    const played = releaseTip(offerTip(fresh(), ['swipeUp'], 0), quiet(0)).state;
    const again = tipsAgain(played);
    expect(again.introduced).toEqual([]);
    expect(offerTip(again, ['swipeUp'], 0).pending?.id).toBe('swipeUp');
  });

  it('keeps what was introduced and the tip settings across launches', async () => {
    saveDiscoveryProgress({ sessions: 3, learned: ['tapTop'], introduced: ['swipeUp', 'twoFingerHold'], tipsOff: true, lastTipSession: 3 });
    await expect(loadDiscoveryProgress()).resolves.toEqual({
      sessions: 3,
      learned: ['tapTop'],
      introduced: ['swipeUp', 'twoFingerHold'],
      tipsOff: true,
      lastTipSession: 3,
    });
  });
});
