module.exports = {
    plugins: ['ghost'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module'
    },
    env: {
        node: true
    },
    rules: {
        'ghost/mocha/no-setup-in-describe': 'off',
        'no-unused-vars': 'off'
    },
    extends: [
        'plugin:ghost/test'
    ]
};
