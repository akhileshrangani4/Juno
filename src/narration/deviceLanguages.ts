import { getLocales } from 'expo-localization';

import { isLanguageCode, primary } from './language';

// The languages the user put in their device settings, most preferred first.
export function deviceLanguages(): string[] {
  try {
    const codes = getLocales().flatMap((locale) => {
      const code = locale.languageCode ?? locale.languageTag;
      return code && isLanguageCode(code) ? [primary(code)] : [];
    });
    return codes.length ? [...new Set(codes)] : ['en'];
  } catch {
    return ['en'];
  }
}
