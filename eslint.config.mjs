import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-electron',
      'release',
      'node_modules',
      'coverage',
      'style_example',
      'examples',
      // git worktrees live at .claude/worktrees/ and ship their own
      // tsconfig — including them confuses typescript-eslint with
      // duplicate TSConfigRootDirs (parsing error on every .ts file).
      '.claude',
      'scripts/inspect-*.mjs',
      'scripts/check-*.mjs',
      '*.config.cjs',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      'electron/**/*.ts',
      'shared/**/*.ts',
      'scripts/**/*.{js,mjs,ts}',
      'vite.config.ts',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
  },
  prettier,
);
