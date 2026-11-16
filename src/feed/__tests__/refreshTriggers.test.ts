import { AWAY_REFRESH_MS, createRefreshTriggers, OFFLINE_RETRY_MS } from '../refreshTriggers';

function setup() {
  let clock = 0;
  let timers: { at: number; run: () => void }[] = [];
  const refresh = jest.fn();
  const retry = jest.fn();
  const triggers = createRefreshTriggers({
    now: () => clock,
    schedule: (run, ms) => {
      const timer = { at: clock + ms, run };
      timers.push(timer);
      return () => void (timers = timers.filter((other) => other !== timer));
    },
    refresh,
    retry,
  });
  const advance = (ms: number) => {
    clock += ms;
    const due = timers.filter((timer) => timer.at <= clock);
    timers = timers.filter((timer) => timer.at > clock);
    due.forEach((timer) => timer.run());
  };
  return { triggers, refresh, retry, advance };
}

describe('refresh triggers', () => {
  it('refresh when the app comes back after ten minutes away, not after a short trip', () => {
    const { triggers, refresh, advance } = setup();
    triggers.appState('background');
    advance(AWAY_REFRESH_MS - 1000);
    triggers.appState('active');
    expect(refresh).not.toHaveBeenCalled();
    triggers.appState('inactive');
    triggers.appState('background');
    advance(AWAY_REFRESH_MS);
    triggers.appState('active');
    expect(refresh).toHaveBeenCalledTimes(1);
    triggers.appState('active');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retry while posts cannot load, and refresh once they load again over posts already shown', () => {
    const { triggers, refresh, retry, advance } = setup();
    triggers.failed();
    triggers.failed();
    advance(OFFLINE_RETRY_MS);
    expect(retry).toHaveBeenCalledTimes(1);
    triggers.failed();
    advance(OFFLINE_RETRY_MS);
    expect(retry).toHaveBeenCalledTimes(2);
    triggers.loaded(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    triggers.loaded(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('only loads the first posts when nothing was shown yet, and stop retrying on reset', () => {
    const { triggers, refresh, retry, advance } = setup();
    triggers.failed();
    triggers.loaded(false);
    expect(refresh).not.toHaveBeenCalled();
    triggers.failed();
    triggers.reset();
    advance(OFFLINE_RETRY_MS);
    expect(retry).not.toHaveBeenCalled();
  });
});
