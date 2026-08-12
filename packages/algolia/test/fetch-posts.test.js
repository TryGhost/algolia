require('./utils');

const assert = require('assert/strict');
const {fetchPosts} = require('../lib/fetch-posts');

describe('fetchPosts', function () {
    it('fetches the first page with Ghost 6 pagination defaults', async function () {
        const posts = [{id: 'first-post'}];
        posts.meta = {pagination: {next: null}};
        const browsePosts = sinon.stub().resolves(posts);

        const result = await fetchPosts(browsePosts);

        result.should.eql([{id: 'first-post'}]);
        browsePosts.calledOnceWithExactly({
            limit: 100,
            page: 1,
            include: 'tags,authors'
        }).should.be.true();
    });

    it('follows Ghost pagination after waiting between pages', async function () {
        const firstPage = [{id: 'first-post'}];
        firstPage.meta = {pagination: {next: 3}};
        const secondPage = [{id: 'second-post'}];
        secondPage.meta = {pagination: {next: null}};
        const browsePosts = sinon.stub();
        browsePosts.onFirstCall().resolves(firstPage);
        browsePosts.onSecondCall().resolves(secondPage);
        const clock = sinon.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts, {filter: 'slug:-[skip-me]'});
            await clock.tickAsync(99);
            browsePosts.calledOnce.should.be.true();

            await clock.tickAsync(1);
            const result = await resultPromise;

            result.should.eql([{id: 'first-post'}, {id: 'second-post'}]);
            browsePosts.firstCall.calledWithExactly({
                limit: 100,
                page: 1,
                include: 'tags,authors',
                filter: 'slug:-[skip-me]'
            }).should.be.true();
            browsePosts.secondCall.calledWithExactly({
                limit: 100,
                page: 3,
                include: 'tags,authors',
                filter: 'slug:-[skip-me]'
            }).should.be.true();
        } finally {
            clock.restore();
        }
    });

    it('fetches only the requested limit when a limit is explicit', async function () {
        const browsePosts = sinon.stub().resolves([{id: 'limited-post'}]);

        const result = await fetchPosts(browsePosts, {limit: 20});

        result.should.eql([{id: 'limited-post'}]);
        browsePosts.calledOnceWithExactly({
            limit: 20,
            include: 'tags,authors'
        }).should.be.true();
    });

    it('fetches only the requested page when limit and page are explicit', async function () {
        const requestedPage = [{id: 'requested-post'}];
        requestedPage.meta = {pagination: {next: 4}};
        const browsePosts = sinon.stub().resolves(requestedPage);

        const result = await fetchPosts(browsePosts, {limit: 10, page: 3});

        result.should.eql([{id: 'requested-post'}]);
        browsePosts.calledOnceWithExactly({
            limit: 10,
            page: 3,
            include: 'tags,authors'
        }).should.be.true();
    });

    it('rejects a non-array response in automatic pagination mode', async function () {
        const browsePosts = sinon.stub().resolves({meta: {pagination: {next: null}}});

        await assert.rejects(
            fetchPosts(browsePosts),
            {
                name: 'TypeError',
                message: 'Ghost returned posts in an invalid format.'
            }
        );
    });

    it('rejects missing pagination metadata in automatic mode', async function () {
        const browsePosts = sinon.stub().resolves([{id: 'post-without-meta'}]);

        await assert.rejects(
            fetchPosts(browsePosts),
            {
                name: 'TypeError',
                message: 'Ghost returned posts without pagination metadata.'
            }
        );
    });

    it('rejects a non-array response from a later page', async function () {
        const firstPage = [{id: 'first-post'}];
        firstPage.meta = {pagination: {next: 2}};
        const browsePosts = sinon.stub();
        browsePosts.onFirstCall().resolves(firstPage);
        browsePosts.onSecondCall().resolves({meta: {pagination: {next: null}}});
        const clock = sinon.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts);
            const rejection = assert.rejects(
                resultPromise,
                {
                    name: 'TypeError',
                    message: 'Ghost returned posts in an invalid format.'
                }
            );

            await clock.tickAsync(100);
            await rejection;
        } finally {
            clock.restore();
        }
    });

    it('rejects missing pagination metadata from a later page', async function () {
        const firstPage = [{id: 'first-post'}];
        firstPage.meta = {pagination: {next: 2}};
        const browsePosts = sinon.stub();
        browsePosts.onFirstCall().resolves(firstPage);
        browsePosts.onSecondCall().resolves([{id: 'post-without-meta'}]);
        const clock = sinon.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts);
            const rejection = assert.rejects(
                resultPromise,
                {
                    name: 'TypeError',
                    message: 'Ghost returned posts without pagination metadata.'
                }
            );

            await clock.tickAsync(100);
            await rejection;
        } finally {
            clock.restore();
        }
    });

    it('rejects an invalid next page value', async function () {
        for (const nextPage of [undefined, 0, -1, 1.5, '2']) {
            const posts = [{id: 'first-post'}];
            posts.meta = {pagination: {next: nextPage}};
            const browsePosts = sinon.stub().resolves(posts);

            await assert.rejects(
                fetchPosts(browsePosts),
                {
                    name: 'TypeError',
                    message: 'Ghost returned an invalid next page.'
                }
            );
        }
    });

    it('rejects a repeated next page', async function () {
        const firstPage = [{id: 'first-post'}];
        firstPage.meta = {pagination: {next: 2}};
        const repeatedPage = [{id: 'repeated-post'}];
        repeatedPage.meta = {pagination: {next: 2}};
        const finalPage = [{id: 'final-post'}];
        finalPage.meta = {pagination: {next: null}};
        const browsePosts = sinon.stub();
        browsePosts.onFirstCall().resolves(firstPage);
        browsePosts.onSecondCall().resolves(repeatedPage);
        browsePosts.onThirdCall().resolves(finalPage);
        const clock = sinon.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts);
            const rejection = assert.rejects(
                resultPromise,
                {
                    name: 'TypeError',
                    message: 'Ghost returned a repeated next page.'
                }
            );

            await clock.tickAsync(200);
            await rejection;
        } finally {
            clock.restore();
        }
    });

    it('rejects pagination back to the initial page', async function () {
        const posts = [{id: 'first-post'}];
        posts.meta = {pagination: {next: 1}};
        const browsePosts = sinon.stub().resolves(posts);

        await assert.rejects(
            fetchPosts(browsePosts),
            {
                name: 'TypeError',
                message: 'Ghost returned a repeated next page.'
            }
        );
        browsePosts.calledOnce.should.be.true();
    });

    it('propagates Ghost request errors unchanged', async function () {
        const ghostError = Error('Ghost request failed');
        const browsePosts = sinon.stub().rejects(ghostError);

        await assert.rejects(fetchPosts(browsePosts), error => error === ghostError);
    });
});
