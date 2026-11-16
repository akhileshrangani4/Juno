import { useSyncExternalStore } from 'react';
import { AppState, Dimensions, PixelRatio, type ScaledSize } from 'react-native';

let current = PixelRatio.getFontScale();
const listeners = new Set<() => void>();
let detach: (() => void) | null = null;

function update(next: number) {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!detach) {
    const dimensions = Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => update(window.fontScale));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') update(PixelRatio.getFontScale());
    });
    detach = () => {
      dimensions.remove();
      appState.remove();
    };
  }
  update(PixelRatio.getFontScale());
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    detach?.();
    detach = null;
  };
}

const read = () => current;

export function useFontScale(): number {
  return useSyncExternalStore(subscribe, read, read);
}
