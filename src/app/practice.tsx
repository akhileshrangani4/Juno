import { PracticeScreen } from '@/onboarding/PracticeScreen';
import { returnToFeed } from '@/session/returnToFeed';

export default function Practice() {
  return <PracticeScreen onDone={returnToFeed} />;
}
