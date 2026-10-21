export default {
  testDir: 'tests',
  testMatch: '*.spec.mjs',
  timeout: 10 * 60 * 1000,
  expect: { timeout: 3 * 60 * 1000 },
  workers: 1,
  reporter: 'list',
};
