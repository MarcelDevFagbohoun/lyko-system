'use strict';

const js = require('@eslint/js');
const globals = require('globals');

/**
 * Lint du serveur : règles « recommandées » d'ESLint (erreurs réelles : variable non définie, code mort, etc.).
 * Pas de règles de style ici — le formatage reste libre, pour ne pas bruiter l'historique.
 */
module.exports = [
  { ignores: ['node_modules/**', 'uploads/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
