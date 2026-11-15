import { Stack, useLocalSearchParams } from 'expo-router';

import { CameraScreen } from '@/camera/CameraScreen';

// The iOS edge swipe is off here: a blind user leaves by a circle, the scrub gesture or Close the camera, each of
// which tells the feed they're back.
export default function CameraRoute() {
  const { start } = useLocalSearchParams<{ start?: string }>();
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <CameraScreen start={start === 'library' ? 'library' : 'camera'} />
    </>
  );
}
