import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.ts', 'tests/**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
});
