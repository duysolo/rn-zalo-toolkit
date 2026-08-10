import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'example/**',
      'packages/*/ios/**',
      'packages/*/android/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      // Mẫu `export const X = {...} as const` + `export type X = ...` cho ta enum mà không
      // phải dùng `enum` của TypeScript (Babel của RN không chạy được `const enum`, còn
      // `enum` thường thì sinh code runtime). Value và type nằm ở hai declaration space khác
      // nhau nên đây là code hợp lệ, nhưng cả rule base lẫn bản TS-aware đều không có option
      // để chấp nhận. Tắt được vì `tsc` mới là thứ bắt redeclare thật, và nó chạy trong CI.
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      // Tham số tiền tố `_` là quy ước "cố ý không dùng" - vẫn phải khai để giữ đúng chữ ký
      // của hợp đồng (bản mock phải trùng chữ ký bản thật thì test mới có giá trị).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Test được phép nói to hơn.
    files: ['**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // File cấu hình CommonJS ở gốc repo.
    files: ['jest.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'packages/*/bin/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
]
