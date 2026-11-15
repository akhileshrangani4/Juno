module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/android/', '/ios/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
