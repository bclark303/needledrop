import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      // Existing provider payloads are intentionally only partially typed. Keep
      // the remaining explicit-any sites visible without blocking maintenance.
      '@typescript-eslint/no-explicit-any': 'warn',
      // These React 19 compiler rules were introduced after the current client
      // state model. Existing initialization effects remain covered by build and
      // tests until they are deliberately refactored.
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // Product copy contains contractions throughout the existing JSX.
      'react/no-unescaped-entities': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
  ]),
]);
