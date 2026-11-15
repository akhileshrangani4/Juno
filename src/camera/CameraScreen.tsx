import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Image as PhotoView, Linking, Platform, StyleSheet, Text, View, type AccessibilityActionEvent, type AccessibilityRole } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CircleDirection } from '@/gestures/circle';
import { GestureSurface } from '@/gestures/GestureSurface';
import type { Narrator } from '@/narration/Narrator';
import { useNarrator } from '@/narration/useNarrator';
import { colors, type } from '@/theme';

import { cameraActions, cameraHalves, cameraHint, type CameraActionName } from './actions';
import { CameraController, type FrameSource, type Phase } from './CameraController';
import { DEV_FRAME_MS, devFramesEnabled, loadDevFrames, type DevFrame } from './devFrames';
import { cameraFeedback, consentStore, localStore, mediaLibrary, permissions } from './device';
import { cameraHost, setActiveCamera } from './host';
import { DescriptionStore, LibraryWalk } from './library';
import { convexLook, downscaled, forUpload } from './lookClient';
import { cameraModule, NativeCameraView, toAnalysis, type CameraViewHandle } from './native';
import { CameraVoice } from './voice';

const DIRECT_TOUCH = 'allowsDirectInteraction' as unknown as AccessibilityRole;
const DEV_ANALYSIS_MS = 125;

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const PHASE_LABEL: Record<Phase, string> = {
  starting: 'starting',
  permission: 'asking for access',
  consent: 'asking about descriptions',
  aiming: 'aiming',
  unavailable: 'not available',
  capturing: 'taking the picture',
  reviewing: 'keep it or take another',
  library: 'your photos',
  closed: 'closed',
};

// Test builds log the camera's flow as errors so they show in the device log; other builds use console.log,
// which iOS doesn't keep.
const logLine = process.env.EXPO_PUBLIC_DEV_FRAME_SOURCE === '1' || process.env.EXPO_PUBLIC_DEV_AGENT_LINK === '1' ? console.error : console.log;

const schedule = (run: () => void, ms: number) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

function createController(narrator: Narrator): CameraController {
  const host = cameraHost;
  const voice = new CameraVoice({ narrator, agent: { live: () => host()?.agentLive() ?? false, say: (text) => host()?.say(text) ?? false }, now: Date.now, schedule });
  const holder: { controller: CameraController | null } = { controller: null };
  const library = new LibraryWalk({
    source: mediaLibrary,
    store: new DescriptionStore(localStore),
    describe: (image) => convexLook.describe(image, 'library'),
    allowed: () => holder.controller?.snapshot.descriptionsOn ?? false,
  });
  holder.controller = new CameraController({
    voice,
    look: convexLook,
    library,
    permissions: devFramesEnabled() ? { ...permissions, camera: () => 'granted', requestCamera: async () => true } : permissions,
    consent: consentStore,
    feedback: cameraFeedback(() => voice.inCall()),
    photoImage: (photo, maxPx) => downscaled(photo.uri, photo, maxPx),
    forUpload: (photo) => forUpload(photo.uri, photo),
    libraryPhoto: mediaLibrary.file,
    onKeep: (photo) => cameraHost()?.keep(photo),
    onClose: () => {
      const current = cameraHost();
      if (current) current.closed();
      else if (router.canGoBack()) router.back();
      else router.replace('/');
    },
    now: Date.now,
    schedule,
    log: (event, detail) => logLine(`[camera] ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}`),
  });
  return holder.controller;
}

// The development frame source: the bundled test images, one at a time, measured once by Vision and fed to the
// controller as a still camera would be.
function useDevFrames(controller: CameraController, phase: Phase): DevFrame | null {
  const [frames, setFrames] = useState<DevFrame[]>([]);
  const [index, setIndex] = useState(0);
  const frame = frames.length ? frames[index % frames.length] : null;

  useEffect(() => {
    if (!devFramesEnabled()) return;
    let cancelled = false;
    void loadDevFrames().then((loaded) => {
      if (cancelled) return;
      loaded.forEach((each) => logLine(`[camera] dev frame ${each.name} measured ${JSON.stringify(each.analysis)}`));
      setFrames(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!frame || phase !== 'aiming') return;
    logLine(`[camera] dev frame ${frame.name}`);
    if (frame.subject) controller.ask(frame.subject);
    const feed = setInterval(() => frame.analysis && controller.onAnalysis({ ...frame.analysis, motion: 0, at: Date.now() }), DEV_ANALYSIS_MS);
    const next = setTimeout(() => setIndex((i) => i + 1), DEV_FRAME_MS);
    return () => {
      clearInterval(feed);
      clearTimeout(next);
    };
  }, [controller, frame, phase]);

  useEffect(() => {
    controller.attach(
      frame
        ? {
            snapshot: (maxPx) => downscaled(frame.uri, frame, maxPx),
            takePhoto: async () => ({ uri: frame.uri, width: frame.width, height: frame.height }),
          }
        : null,
    );
  }, [controller, frame]);

  return frame;
}

export function CameraScreen({ start }: { start: 'camera' | 'library' }) {
  const narrator = useNarrator();
  const [controller] = useState(() => createController(narrator));
  const state = useSyncExternalStore(controller.subscribe.bind(controller), () => controller.snapshot);
  const camera = useRef<CameraViewHandle>(null);
  const devFrame = useDevFrames(controller, state.phase);
  const useDev = devFramesEnabled();
  const inCall = cameraHost()?.agentLive() ?? false;
  const libraryId = state.phase === 'library' ? (controller.currentLibraryPhoto()?.id ?? null) : null;
  const [preview, setPreview] = useState<{ id: string; uri: string } | null>(null);

  useEffect(() => {
    if (!libraryId) return;
    let current = true;
    logLine(`[camera] library preview wanted ${libraryId}`);
    void mediaLibrary
      .file(libraryId)
      .catch((error: unknown) => {
        logLine(`[camera] library preview failed ${String(error)}`);
        return null;
      })
      .then((file) => {
        logLine(`[camera] library preview ${libraryId} ${file ? file.uri : 'no file'}${current ? '' : ' (moved on)'}`);
        if (current && file) setPreview({ id: libraryId, uri: file.uri });
      });
    return () => {
      current = false;
    };
  }, [libraryId]);

  useEffect(() => {
    setActiveCamera(controller);
    cameraModule?.allowHapticsDuringRecording(true);
    void controller.start({ library: start === 'library' });
    return () => {
      controller.stop();
      setActiveCamera(null);
    };
  }, [controller, start]);

  useEffect(() => {
    if (useDev || !NativeCameraView) return;
    const frames: FrameSource = {
      snapshot: async (maxPx, mirror) => (await camera.current?.snapshot(maxPx, mirror).catch(() => null))?.base64 ?? null,
      takePhoto: async () => (await camera.current?.takePhoto().catch(() => null)) ?? null,
    };
    controller.attach(frames);
  }, [controller, useDev]);

  const onCircle = (direction: CircleDirection) => {
    const host = cameraHost();
    if (direction === 'counterclockwise') {
      if (host?.agentLive()) host.sleepAgent();
      else controller.close();
      return;
    }
    host?.wakeAgent();
  };

  const onAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) => {
    switch (nativeEvent.actionName as CameraActionName) {
      case 'shutter':
        return void controller.shutter();
      case 'describe':
        return controller.askWhatIsInView();
      case 'flip':
        return controller.flip();
      case 'photos':
        return void controller.openLibrary();
      case 'descriptionsOn':
      case 'allow':
        return controller.answerConsent('yes');
      case 'descriptionsOff':
      case 'decline':
        return controller.answerConsent('no');
      case 'keep':
        return void controller.keep();
      case 'retake':
        return controller.retake();
      case 'next':
        return controller.libraryMove('older');
      case 'previous':
        return controller.libraryMove('newer');
      case 'choose':
        return void controller.choose();
      case 'backToCamera':
        return controller.backToCamera();
      case 'settings':
        return void Linking.openSettings();
      case 'close':
        return controller.close();
    }
  };

  const halves = cameraHalves(state.phase);
  const live = state.phase === 'aiming' || state.phase === 'capturing';
  const shown = preview && preview.id === libraryId ? preview : null;
  return (
    <SafeAreaView style={styles.screen}>
      <GestureSurface
        style={styles.surface}
        tapsEnabled
        onTapTop={() => controller.tapTop()}
        onTapBottom={() => controller.tapBottom()}
        onCircle={onCircle}
        onHold={() => controller.longPress()}
        accessible
        accessibilityRole={Platform.OS === 'ios' ? DIRECT_TOUCH : 'none'}
        accessibilityLabel={`Camera, ${PHASE_LABEL[state.phase]}`}
        accessibilityHint={cameraHint(state.phase, inCall)}
        accessibilityValue={{ text: [state.cue, state.detail].filter(Boolean).join('. ') }}
        accessibilityActions={cameraActions(state.phase, state.descriptionsOn, !!NativeCameraView || useDev)}
        onAccessibilityAction={onAccessibilityAction}
        onAccessibilityTap={() => controller.tapBottom()}
        onAccessibilityEscape={() => controller.close()}
        onMagicTap={() => {
          const host = cameraHost();
          if (host?.agentLive()) host.sleepAgent();
          else host?.wakeAgent();
        }}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {useDev && devFrame && live ? <Image source={{ uri: devFrame.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          {!useDev && NativeCameraView ? (
            <NativeCameraView
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing={state.facing}
              active={live}
              onAnalysis={({ nativeEvent }) => controller.onAnalysis(toAnalysis(nativeEvent))}
              onCameraError={({ nativeEvent }) => controller.cameraFailed(nativeEvent.reason)}
            />
          ) : null}
          {shown ? <PhotoView key={shown.id} source={{ uri: shown.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        </View>
        <Text style={styles.half} maxFontSizeMultiplier={type.maxScale}>
          {halves ? `▲ ${capitalized(halves.top)}` : ' '}
        </Text>
        <View style={styles.panel}>
          <Text style={styles.cue} maxFontSizeMultiplier={type.maxScale}>
            {state.cue || `Camera: ${PHASE_LABEL[state.phase]}`}
          </Text>
          {state.detail ? (
            <Text style={styles.detail} maxFontSizeMultiplier={type.maxScale}>
              {state.detail}
            </Text>
          ) : null}
        </View>
        <Text style={styles.half} maxFontSizeMultiplier={type.maxScale}>
          {halves ? `▼ ${capitalized(halves.bottom)}` : ' '}
        </Text>
      </GestureSurface>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  surface: { flex: 1, padding: 12, justifyContent: 'space-between' },
  half: { color: colors.text, backgroundColor: 'rgba(0,0,0,0.75)', fontSize: type.title, fontWeight: '800', textAlign: 'center', padding: 10, borderRadius: 12 },
  panel: { backgroundColor: 'rgba(0,0,0,0.85)', borderColor: colors.focus, borderWidth: 4, borderRadius: 20, padding: 16, gap: 10 },
  cue: { color: colors.focus, fontSize: 40, lineHeight: 48, fontWeight: '900', textAlign: 'center' },
  detail: { color: colors.text, fontSize: type.body, lineHeight: type.bodyLineHeight, fontWeight: '600' },
});
