import type { ComponentRef, Ref } from 'react';
import { StyleSheet, Text as NativeText, TextInput as NativeTextInput, type StyleProp, type TextInputProps, type TextProps, type TextStyle } from 'react-native';

import { useFontScale } from './fontScale';

function scaled(style: StyleProp<TextStyle>, factor: number): TextStyle | null {
  if (factor === 1) return null;
  const { fontSize, lineHeight } = StyleSheet.flatten(style) ?? {};
  return {
    ...(fontSize === undefined ? null : { fontSize: fontSize * factor }),
    ...(lineHeight === undefined ? null : { lineHeight: lineHeight * factor }),
  };
}

function useFactor(allowFontScaling: boolean | undefined, maxFontSizeMultiplier: number | null | undefined): number {
  const scale = useFontScale();
  if (allowFontScaling === false) return 1;
  return maxFontSizeMultiplier && maxFontSizeMultiplier >= 1 ? Math.min(scale, maxFontSizeMultiplier) : scale;
}

export function Text({ style, allowFontScaling, maxFontSizeMultiplier, ...props }: TextProps & { ref?: Ref<ComponentRef<typeof NativeText>> }) {
  const factor = useFactor(allowFontScaling, maxFontSizeMultiplier);
  return <NativeText {...props} allowFontScaling={false} style={[style, scaled(style, factor)]} />;
}

export function TextInput({ style, allowFontScaling, maxFontSizeMultiplier, ...props }: TextInputProps & { ref?: Ref<ComponentRef<typeof NativeTextInput>> }) {
  const factor = useFactor(allowFontScaling, maxFontSizeMultiplier);
  return <NativeTextInput {...props} allowFontScaling={false} style={[style, scaled(style, factor)]} />;
}
