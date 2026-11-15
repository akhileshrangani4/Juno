// Coming back to the app after this long away refreshes the feed.
export const AWAY_REFRESH_MS = 10 * 60 * 1000;
// While posts can't load, the feed tries again this often.
export const OFFLINE_RETRY_MS = 15 * 1000;

type Options = {
  now(): number;
  schedule(run: () => void, ms: number): () => void;
  refresh(): void;
  retry(): void;
};

// Keeps the feed current without the user asking: it refreshes when the app comes back to the foreground after a
// while away, and while posts can't load it retries every so often and refreshes once they load again.
export function createRefreshTriggers({ now, schedule, refresh, retry }: Options) {
  let awaySince: number | null = null;
  let failing = false;
  let cancelRetry: (() => void) | null = null;
  return {
    appState(status: string) {
      if (status !== 'active') {
        awaySince ??= now();
        return;
      }
      const away = awaySince;
      awaySince = null;
      if (away !== null && now() - away >= AWAY_REFRESH_MS) refresh();
    },
    failed() {
      failing = true;
      cancelRetry ??= schedule(() => {
        cancelRetry = null;
        retry();
      }, OFFLINE_RETRY_MS);
    },
    // A page loaded; hadPosts says whether the feed already showed posts, which may now be out of date.
    loaded(hadPosts: boolean) {
      if (!failing) return;
      failing = false;
      if (hadPosts) refresh();
    },
    reset() {
      failing = false;
      cancelRetry?.();
      cancelRetry = null;
    },
  };
}
