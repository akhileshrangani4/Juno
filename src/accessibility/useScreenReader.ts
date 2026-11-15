import { createContext, createElement, use, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { LoadingScreen } from '@/screens/LoadingScreen';

const ScreenReaderContext = createContext(false);

export function ScreenReaderProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<boolean | null>(Platform.OS === 'web' ? false : null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    AccessibilityInfo.isScreenReaderEnabled().then(setEnabled, () => setEnabled(false));
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => subscription.remove();
  }, []);
  return enabled === null ? createElement(LoadingScreen) : createElement(ScreenReaderContext, { value: enabled }, children);
}

export function useScreenReader(): boolean {
  return use(ScreenReaderContext);
}
