import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

// The push-to-talk tones: a rising one when the microphone is about to open, a falling one after it closed. They
// are played on the phone, not through the call, and the microphone is shut while they play, so neither is heard
// as the user's speech. No audio mode is set here: the call owns the audio session while the agent is awake.
export type TalkTone = 'start' | 'end';

const SOURCES: Record<TalkTone, number> = {
  start: require('../../assets/sounds/talk-start.wav'),
  end: require('../../assets/sounds/talk-end.wav'),
};

// Length of each tone in milliseconds (scripts/generate-earcons.py).
export const TALK_TONE_MS: Record<TalkTone, number> = { start: 140, end: 140 };

const players = new Map<TalkTone, AudioPlayer>();

// Plays the tone and returns how long it lasts, or 0 when it can't play.
export function playTalkTone(tone: TalkTone): number {
  if (Platform.OS === 'web') return 0;
  try {
    let player = players.get(tone);
    if (!player) {
      player = createAudioPlayer(SOURCES[tone]);
      player.volume = 0.6;
      players.set(tone, player);
    }
    void player.seekTo(0).catch(() => undefined);
    player.play();
    return TALK_TONE_MS[tone];
  } catch {
    return 0;
  }
}
