import { router } from 'expo-router';

export function returnToFeed(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
