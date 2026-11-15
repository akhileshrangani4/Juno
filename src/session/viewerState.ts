import { actionHistory } from '@/actions/history';
import { forgetLikes } from '@/feed/likes';

// Everything the app holds about what the signed-in account did or likes. Cleared on sign-out, on a switch to another
// account or to the guest feed, and when the session stops being valid, so one account never sees or undoes another's.
export function clearViewerState(): void {
  forgetLikes();
  actionHistory.clear();
}
