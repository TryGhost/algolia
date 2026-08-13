module.exports = {
    test: {
        // CLI acceptance files spawn synchronous subprocesses and must not compete.
        fileParallelism: false,
        testTimeout: 15000
    }
};
