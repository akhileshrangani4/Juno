import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import type { EarconKind } from './buildNarration';

// The post earcons, and the sounds that confirm a two-finger like or removed like at once, over any narration.
export type SoundKind = EarconKind | 'like' | 'unlike' | 'talkStart' | 'talkEnd';

export interface EarconPlayer {
  play(kind: SoundKind): number;
}

const SOURCES: Record<SoundKind, number> = {
  image: require('../../assets/sounds/earcon-image.wav'),
  video: require('../../assets/sounds/earcon-video.wav'),
  repost: require('../../assets/sounds/earcon-repost.wav'),
  reply: require('../../assets/sounds/earcon-reply.wav'),
  like: require('../../assets/sounds/earcon-like.wav'),
  unlike: require('../../assets/sounds/earcon-unlike.wav'),
  talkStart: require('../../assets/sounds/earcon-talk-start.wav'),
  talkEnd: require('../../assets/sounds/earcon-talk-end.wav'),
};

// Length of each sound in milliseconds (see scripts/generate-earcons.py). Speech starts as the sound
// ends, so a post with an earcon starts narrating at most about a quarter of a second later.
export const EARCON_MS: Record<SoundKind, number> = { image: 160, video: 220, repost: 185, reply: 220, like: 170, unlike: 170, talkStart: 200, talkEnd: 200 };
const VOLUME = 0.6;
// The push-to-talk tones play during a call, which ducks other sounds, so they play at full volume.
const LOUD: SoundKind[] = ['talkStart', 'talkEnd'];

export function createEarconPlayer(): EarconPlayer {
  const players = new Map<SoundKind, AudioPlayer>();
  let ready = false;
  const prepare = () => {
    if (ready || Platform.OS === 'web') return;
    ready = true;
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    (Object.keys(SOURCES) as SoundKind[]).forEach((kind) => {
      const player = createAudioPlayer(SOURCES[kind]);
      player.volume = LOUD.includes(kind) ? 1 : VOLUME;
      players.set(kind, player);
    });
  };
  return {
    play(kind) {
      try {
        prepare();
        const player = players.get(kind);
        if (!player) return 0;
        void player.seekTo(0).catch(() => undefined);
        player.play();
        return EARCON_MS[kind];
      } catch {
        return 0;
      }
    },
  };
}
