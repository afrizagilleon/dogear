import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'spike/**', // isolated M0B spike
      'experiments/**', // experimental scratchpad
      '.chrome-test*/**',
      '.tmp*/**',
    ],
  },
  {
    files: ['extension/**/*.ts', 'scripts/**/*.mjs', 'wxt.config.ts', 'vitest.config.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
    },
  },
];
