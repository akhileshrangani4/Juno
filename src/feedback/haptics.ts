import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticEvent = 'next' | 'previous' | 'edge' | 'agentAwake' | 'agentAsleep';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const patterns: Record<HapticEvent, () => Promise<void>> = {
  next: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  previous: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
  edge: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  agentAwake: async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await pause(120);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await pause(120);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  },
  agentAsleep: async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await pause(200);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  },
};

export function haptic(event: HapticEvent): void {
  if (Platform.OS === 'web') return;
  patterns[event]().catch(() => undefined);
}
