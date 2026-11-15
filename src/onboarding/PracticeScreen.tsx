import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type AccessibilityActionEvent, type AccessibilityRole } from 'react-native';
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
const STACK_BUTTONS_AT_FONT_SCALE = 1.2;

export function PracticeScreen({ onDone }: { onDone(): void }) {
  const narrator = useNarrator();
  const screenReader = useScreenReader();
  const stacked = useWindowDimensions().fontScale >= STACK_BUTTONS_AT_FONT_SCALE;
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
        <Panel testID="practice-step" target={current?.half === 'top'} resetKey={state.step}>
          <Text style={styles.progress} maxFontSizeMultiplier={type.maxScale}>
            {complete ? 'Practice complete' : `Step ${state.step + 1} of ${GESTURES.length}`}
          </Text>
          <Text style={styles.title} maxFontSizeMultiplier={type.maxScale}>
            {current ? `${current.symbol} ${current.title}` : 'All done'}
          </Text>
          {current?.half === 'top' ? <TapHere /> : null}
        </Panel>
        <Panel testID="practice-caption" target={current?.half === 'bottom'} resetKey={spoken}>
          <Text style={styles.caption} maxFontSizeMultiplier={type.maxScale}>
            {spoken}
          </Text>
          {current?.half === 'bottom' ? <TapHere /> : null}
        </Panel>
      </GestureSurface>
      <View testID="practice-controls" style={[styles.controls, stacked && styles.stacked]}>
        <Button label="Repeat" accessibilityLabel={complete ? 'Repeat the summary' : 'Repeat the instruction'} hint="Speaks the current step again." onPress={() => dispatch({ type: 'repeat' })} inRow={!stacked} />
        <Button
          label={complete ? 'Continue' : 'Skip practice'}
          hint={complete ? 'Leaves gesture practice.' : 'Skips gesture practice. You can practice again from account settings.'}
          onPress={() => dispatch({ type: 'skip' })}
          primary
          inRow={!stacked}
        />
      </View>
    </SafeAreaView>
  );
}

function Panel({ testID, target, resetKey, children }: { testID: string; target: boolean; resetKey: string | number; children: ReactNode }) {
  const stroke = useStrokeGesture();
  return (
    <ScrollView
      key={resetKey}
      testID={testID}
      simultaneousWith={stroke?.gesture}
      onScroll={stroke?.onScroll}
      scrollEventThrottle={16}
      bounces={false}
      style={[styles.half, target && styles.target]}
      contentContainerStyle={styles.halfContent}
      indicatorStyle="white"
      persistentScrollbar>
      {children}
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

function Button({ label, accessibilityLabel, hint, onPress, primary, inRow }: { label: string; accessibilityLabel?: string; hint: string; onPress(): void; primary?: boolean; inRow: boolean }) {
  return (
    <Pressable
      style={[styles.button, inRow && styles.inRow, primary && styles.primary]}
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
  half: { flex: 1, borderWidth: 3, borderColor: colors.muted, borderRadius: 24, backgroundColor: colors.surface },
  halfContent: { flexGrow: 1, padding: 20, gap: 12, justifyContent: 'center' },
  target: { borderWidth: 6, borderColor: colors.focus },
  progress: { color: colors.muted, fontSize: type.label, fontWeight: '700' },
  title: { color: colors.focus, fontSize: 36, fontWeight: '800' },
  caption: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  tapHere: { color: colors.focus, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingBottom: 12 },
  stacked: { flexDirection: 'column' },
  inRow: { flex: 1 },
  button: { minHeight: 72, borderRadius: 16, borderWidth: 3, borderColor: colors.focus, alignItems: 'center', justifyContent: 'center', padding: 12 },
  primary: { backgroundColor: colors.focus },
  buttonText: { color: colors.focus, fontSize: type.title, fontWeight: '800', textAlign: 'center' },
});
