// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // Screens load their data from an effect with a load() that first resets loading/error state.
      // That is intended here; keep it visible as a warning rather than an error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
