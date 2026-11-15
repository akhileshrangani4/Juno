const transformed = [
  '\\.pnpm',
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?/.*',
  '@expo-google-fonts/.*',
  'react-navigation',
  '@react-navigation/.*',
  'react-native-svg',
  '@atproto/.*',
  'multiformats',
  'uint8arrays',
  '@ipld/.*',
  'await-lock',
];

module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/android/', '/ios/'],
  transformIgnorePatterns: [`node_modules/(?!(${transformed.join('|')}))`],
  resolver: '<rootDir>/jest.resolver.js',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
