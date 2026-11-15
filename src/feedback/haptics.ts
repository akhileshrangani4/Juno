import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticEvent = 'next' | 'previous' | 'edge' | 'unrecognized' | 'agentConnecting' | 'agentAwake' | 'agentAsleep' | 'agentFailed' | 'like' | 'unlike' | 'commentsOpen' | 'commentsClose' | 'camera' | 'holdWarning';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const patterns: Record<HapticEvent, () => Promise<void>> = {
  next: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  previous: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
  edge: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  unrecognized: async () => {
    await Haptics.selectionAsync();
    await pause(80);
    await Haptics.selectionAsync();
  },
  agentConnecting: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  agentFailed: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  agentAwake: async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await pause(120);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await pause(120);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  },
  like: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  unlike: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  commentsOpen: async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await pause(90);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  commentsClose: async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await pause(90);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  camera: () => Haptics.selectionAsync(),
  holdWarning: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
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
