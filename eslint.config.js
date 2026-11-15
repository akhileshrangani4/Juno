const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', '.expo/*', 'convex/_generated/*', 'android/*', 'ios/*'] },
  {
    files: ['src/**/*.{ts,tsx}', 'convex/**/*.ts'],
    ignores: ['src/social/bluesky/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@atproto/*'], message: 'Only src/social/bluesky may import @atproto. Use the SocialProvider interface.' }] },
      ],
    },
  },
]);
