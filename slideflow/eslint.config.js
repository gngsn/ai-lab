import js from '@eslint/js';
import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/**
 * Hexagonal import boundaries (PLAN §2.2). The single hard rule: infra SDKs
 * (Supabase, DOMPurify) may live only under adapters/. Everything else depends
 * on ports, never on a concrete backend.
 */
const banSupabase = {
  group: ['@supabase/*'],
  message: 'Supabase SDK is only allowed under src/adapters/supabase/**. Depend on a port instead.',
};
const banAdapters = {
  group: ['@adapters/*'],
  message: 'Use ports + the composition root; never import an adapter directly.',
};
const banInfraAndUp = {
  group: [
    '@ports/*',
    '@adapters/*',
    '@features/*',
    '@composition/*',
    '@ui/*',
    '@supabase/*',
    'dompurify',
  ],
  message:
    'core/ is pure domain: it may not import ports, adapters, features, ui, composition, or any SDK.',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'vendor/**'] },
  js.configs.recommended,
  // Node scripts (plain ESM JS).
  {
    files: ['scripts/**/*.mjs', '*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  // App + tooling TypeScript. TS already checks undefined symbols, so no-undef is off.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-imports': ['error', { patterns: [banSupabase] }],
    },
  },
  // core/: pure domain — no app, no infra.
  {
    files: ['src/core/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [banInfraAndUp] }] },
  },
  // ports/: interfaces only — may reference core model types, nothing else.
  {
    files: ['src/ports/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [banAdapters, banSupabase, { group: ['@features/*', '@composition/*'] }] },
      ],
    },
  },
  // features/ + pages/: depend on ports, never on a concrete adapter or SDK.
  {
    files: ['src/features/**/*.ts', 'src/pages/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [banAdapters, banSupabase] }] },
  },
  // adapters/supabase/: the ONLY place the Supabase SDK is allowed.
  {
    files: ['src/adapters/supabase/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Tests may wire concrete adapters (as test doubles); the @supabase ban still holds.
  {
    files: ['**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [banSupabase] }] },
  },
];
