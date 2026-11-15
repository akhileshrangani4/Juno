import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityRole } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useScreenReader } from '@/accessibility/useScreenReader';
import { haptic } from '@/feedback/haptics';
import { GestureSurface, useStrokeGesture } from '@/gestures/GestureSurface';
import { useNarrator } from '@/narration/useNarrator';
import { colors, type } from '@/theme';

import { circleGesture, GESTURES } from './gestures';
import { practiceReducer, startPractice, type PracticeEvent, type PracticeInput } from './practice';
import { classifyStroke } from './strokes';

const DIRECT_TOUCH = 'allowsDirectInteraction' as unknown as AccessibilityRole;
const SCREEN_READER_DELAY_MS = 900;

export function PracticeScreen({ onDone }: { onDone(): void }) {
  const narrator = useNarrator();
  const screenReader = useScreenReader();
  const [practice, setPractice] = useState(() => startPractice(Date.now()));
  const latest = useRef(practice);

  useEffect(() => {
    const scheduled = latest.current;
    const timer = setTimeout(() => {
      if (latest.current === scheduled && scheduled.feedback) narrator.speak(scheduled.feedback.text);
    }, screenReader ? SCREEN_READER_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [narrator, screenReader]);

  const dispatch = (event: PracticeEvent) => {
    const next = practiceReducer(latest.current.state, event);
    if (!next) return;
    latest.current = next;
    setPractice(next);
    if (next.state.phase === 'closed') {
      haptic('next');
      narrator.stop();
      onDone();
      return;
    }
    if (!next.feedback) return;
    if (next.feedback.haptic) haptic(next.feedback.haptic);
    narrator.speak(next.feedback.text);
  };
  const input = (value: PracticeInput) => dispatch({ type: 'input', input: value, at: Date.now() });

  const { state, feedback } = practice;
  const complete = state.phase !== 'practicing';
  const current = complete ? null : GESTURES[state.step];
  const spoken = feedback?.text ?? '';

  const onAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) => {
    switch (nativeEvent.actionName) {
      case 'activate':
        return dispatch(complete ? { type: 'skip' } : { type: 'repeat' });
      case 'repeat':
        return dispatch({ type: 'repeat' });
      case 'skip':
        return dispatch({ type: 'skip' });
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <GestureSurface
        style={styles.surface}
        tapsEnabled
        onTapTop={() => input({ kind: 'gesture', gesture: 'tapTop' })}
        onTapBottom={() => input({ kind: 'gesture', gesture: 'tapBottom' })}
        onCircle={(direction) => input({ kind: 'gesture', gesture: circleGesture(direction) })}
        onUnrecognizedStroke={(points) => input({ kind: 'stroke', stroke: classifyStroke(points) })}
        accessible
        accessibilityRole={Platform.OS === 'ios' ? DIRECT_TOUCH : 'adjustable'}
        accessibilityLabel={`Gesture practice. ${spoken}`}
        accessibilityHint="Try each gesture anywhere in this area. Below it are buttons to hear the instruction again and to skip practice."
        accessibilityActions={
          complete
            ? [
                { name: 'activate', label: 'Continue' },
                { name: 'repeat', label: 'Repeat the summary' },
              ]
            : [
                { name: 'activate', label: 'Repeat the instruction' },
                { name: 'skip', label: 'Skip practice' },
              ]
        }
        onAccessibilityAction={onAccessibilityAction}
        onAccessibilityEscape={() => dispatch({ type: 'skip' })}>
        <View style={[styles.half, current?.half === 'top' && styles.target]}>
          <Text style={styles.progress} maxFontSizeMultiplier={type.maxScale}>
            {complete ? 'Practice complete' : `Step ${state.step + 1} of ${GESTURES.length}`}
          </Text>
          <Text style={styles.title} maxFontSizeMultiplier={type.maxScale} adjustsFontSizeToFit numberOfLines={3}>
            {current ? `${current.symbol} ${current.title}` : 'All done'}
          </Text>
          {current?.half === 'top' ? <TapHere /> : null}
        </View>
        <View style={[styles.half, current?.half === 'bottom' && styles.target]}>
          <Caption text={spoken} />
          {current?.half === 'bottom' ? <TapHere /> : null}
        </View>
      </GestureSurface>
      <View style={styles.controls}>
        <Button label="Repeat" accessibilityLabel={complete ? 'Repeat the summary' : 'Repeat the instruction'} hint="Speaks the current step again." onPress={() => dispatch({ type: 'repeat' })} />
        <Button
          label={complete ? 'Continue' : 'Skip practice'}
          hint={complete ? 'Leaves gesture practice.' : 'Skips gesture practice. You can practice again from account settings.'}
          onPress={() => dispatch({ type: 'skip' })}
          primary
        />
      </View>
    </SafeAreaView>
  );
}

function Caption({ text }: { text: string }) {
  const stroke = useStrokeGesture();
  return (
    <ScrollView
      key={text}
      testID="practice-caption"
      simultaneousWith={stroke?.gesture}
      onScroll={stroke?.onScroll}
      scrollEventThrottle={16}
      bounces={false}
      style={styles.captionScroll}
      indicatorStyle="white"
      persistentScrollbar>
      <Text style={styles.caption} maxFontSizeMultiplier={type.maxScale}>
        {text}
      </Text>
    </ScrollView>
  );
}

function TapHere() {
  return (
    <Text style={styles.tapHere} maxFontSizeMultiplier={type.maxScale}>
      Tap anywhere here
    </Text>
  );
}

function Button({ label, accessibilityLabel, hint, onPress, primary }: { label: string; accessibilityLabel?: string; hint: string; onPress(): void; primary?: boolean }) {
  return (
    <Pressable
      style={[styles.button, primary && styles.primary]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={hint}
      onPress={onPress}>
      <Text style={[styles.buttonText, primary && { color: colors.onFocus }]} maxFontSizeMultiplier={type.maxScale}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  surface: { flex: 1, padding: 12, gap: 12 },
  half: { flex: 1, overflow: 'hidden', borderWidth: 3, borderColor: colors.muted, borderRadius: 24, backgroundColor: colors.surface, padding: 20, gap: 12, justifyContent: 'center' },
  target: { borderWidth: 6, borderColor: colors.focus },
  progress: { color: colors.muted, fontSize: type.label, fontWeight: '700' },
  title: { color: colors.focus, fontSize: 36, fontWeight: '800' },
  captionScroll: { flexGrow: 0, flexShrink: 1 },
  caption: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  tapHere: { color: colors.focus, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingBottom: 12 },
  button: { flex: 1, minHeight: 72, borderRadius: 16, borderWidth: 3, borderColor: colors.focus, alignItems: 'center', justifyContent: 'center', padding: 12 },
  primary: { backgroundColor: colors.focus },
  buttonText: { color: colors.focus, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
});
