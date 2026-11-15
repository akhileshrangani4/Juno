import { useLocalSearchParams } from 'expo-router';

import { CameraScreen } from '@/camera/CameraScreen';

export default function CameraRoute() {
  const { start } = useLocalSearchParams<{ start?: string }>();
  return <CameraScreen start={start === 'library' ? 'library' : 'camera'} />;
}
