module.exports = {
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
    },
    plugins: ['ghost'],
    extends: [
        'plugin:ghost/test'
    ]
};
