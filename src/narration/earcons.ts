import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import type { EarconKind } from './buildNarration';

export interface EarconPlayer {
  play(kind: EarconKind): number;
}

const SOURCES: Record<EarconKind, number> = {
  image: require('../../assets/sounds/earcon-image.wav'),
  video: require('../../assets/sounds/earcon-video.wav'),
  repost: require('../../assets/sounds/earcon-repost.wav'),
  reply: require('../../assets/sounds/earcon-reply.wav'),
};

// Length of each sound in milliseconds (see scripts/generate-earcons.py). Speech starts as the sound
// ends, so a post with an earcon starts narrating at most about a quarter of a second later.
export const EARCON_MS: Record<EarconKind, number> = { image: 160, video: 220, repost: 185, reply: 220 };
const VOLUME = 0.6;

export function createEarconPlayer(): EarconPlayer {
  const players = new Map<EarconKind, AudioPlayer>();
  let ready = false;
  const prepare = () => {
    if (ready || Platform.OS === 'web') return;
    ready = true;
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    (Object.keys(SOURCES) as EarconKind[]).forEach((kind) => {
      const player = createAudioPlayer(SOURCES[kind]);
      player.volume = VOLUME;
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
