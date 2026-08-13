import assert from 'node:assert/strict';
import {afterEach, describe, expect, it, vi} from 'vitest';

import fetchPostsModule from '../lib/fetch-posts.js';

const {fetchPosts} = fetchPostsModule;

describe('fetchPosts', function () {
    afterEach(function () {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('fetches the first page with Ghost 6 pagination defaults', async function () {
        const posts = [{id: 'first-post'}];
        posts.meta = {pagination: {next: null}};
        const browsePosts = vi.fn().mockResolvedValue(posts);

        const result = await fetchPosts(browsePosts);

        expect(result).toEqual([{id: 'first-post'}]);
        expect(browsePosts).toHaveBeenCalledTimes(1);
        expect(browsePosts).toHaveBeenCalledWith({
            limit: 100,
            page: 1,
            include: 'tags,authors'
        });
    });

    it('follows Ghost pagination after waiting between pages', async function () {
        const firstPage = [{id: 'first-post'}];
        firstPage.meta = {pagination: {next: 3}};
        const secondPage = [{id: 'second-post'}];
        secondPage.meta = {pagination: {next: null}};
        const browsePosts = vi.fn()
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(secondPage);
        vi.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts, {filter: 'slug:-[skip-me]'});
            await vi.advanceTimersByTimeAsync(99);
            expect(browsePosts).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(1);
            const result = await resultPromise;

            expect(result).toEqual([{id: 'first-post'}, {id: 'second-post'}]);
            expect(browsePosts).toHaveBeenNthCalledWith(1, {
                limit: 100,
                page: 1,
                include: 'tags,authors',
                filter: 'slug:-[skip-me]'
            });
            expect(browsePosts).toHaveBeenNthCalledWith(2, {
                limit: 100,
                page: 3,
                include: 'tags,authors',
                filter: 'slug:-[skip-me]'
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('fetches only the requested limit when a limit is explicit', async function () {
        const browsePosts = vi.fn().mockResolvedValue([{id: 'limited-post'}]);

        const result = await fetchPosts(browsePosts, {limit: 20});

        expect(result).toEqual([{id: 'limited-post'}]);
        expect(browsePosts).toHaveBeenCalledTimes(1);
        expect(browsePosts).toHaveBeenCalledWith({
            limit: 20,
            include: 'tags,authors'
        });
    });

    it('fetches only the requested page when limit and page are explicit', async function () {
        const requestedPage = [{id: 'requested-post'}];
        requestedPage.meta = {pagination: {next: 4}};
        const browsePosts = vi.fn().mockResolvedValue(requestedPage);

        const result = await fetchPosts(browsePosts, {limit: 10, page: 3});

        expect(result).toEqual([{id: 'requested-post'}]);
        expect(browsePosts).toHaveBeenCalledTimes(1);
        expect(browsePosts).toHaveBeenCalledWith({
            limit: 10,
            page: 3,
            include: 'tags,authors'
        });
    });

    it('rejects a non-array response in automatic pagination mode', async function () {
        const browsePosts = vi.fn().mockResolvedValue({meta: {pagination: {next: null}}});

        await assert.rejects(
            fetchPosts(browsePosts),
            {
                name: 'TypeError',
                message: 'Ghost returned posts in an invalid format.'
            }
        );
    });

    it('rejects missing pagination metadata in automatic mode', async function () {
        const browsePosts = vi.fn().mockResolvedValue([{id: 'post-without-meta'}]);

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
        const browsePosts = vi.fn()
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({meta: {pagination: {next: null}}});
        vi.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts);
            const rejection = assert.rejects(
                resultPromise,
                {
                    name: 'TypeError',
                    message: 'Ghost returned posts in an invalid format.'
                }
            );

            await vi.advanceTimersByTimeAsync(100);
            await rejection;
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects missing pagination metadata from a later page', async function () {
        const firstPage = [{id: 'first-post'}];
        firstPage.meta = {pagination: {next: 2}};
        const browsePosts = vi.fn()
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce([{id: 'post-without-meta'}]);
        vi.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts);
            const rejection = assert.rejects(
                resultPromise,
                {
                    name: 'TypeError',
                    message: 'Ghost returned posts without pagination metadata.'
                }
            );

            await vi.advanceTimersByTimeAsync(100);
            await rejection;
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects an invalid next page value', async function () {
        for (const nextPage of [undefined, 0, -1, 1.5, '2']) {
            const posts = [{id: 'first-post'}];
            posts.meta = {pagination: {next: nextPage}};
            const browsePosts = vi.fn().mockResolvedValue(posts);

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
        const browsePosts = vi.fn()
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(repeatedPage)
            .mockResolvedValueOnce(finalPage);
        vi.useFakeTimers();

        try {
            const resultPromise = fetchPosts(browsePosts);
            const rejection = assert.rejects(
                resultPromise,
                {
                    name: 'TypeError',
                    message: 'Ghost returned a repeated next page.'
                }
            );

            await vi.advanceTimersByTimeAsync(200);
            await rejection;
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects pagination back to the initial page', async function () {
        const posts = [{id: 'first-post'}];
        posts.meta = {pagination: {next: 1}};
        const browsePosts = vi.fn().mockResolvedValue(posts);

        await assert.rejects(
            fetchPosts(browsePosts),
            {
                name: 'TypeError',
                message: 'Ghost returned a repeated next page.'
            }
        );
        expect(browsePosts).toHaveBeenCalledTimes(1);
    });

    it('propagates Ghost request errors unchanged', async function () {
        const ghostError = Error('Ghost request failed');
        const browsePosts = vi.fn().mockRejectedValue(ghostError);

        await assert.rejects(fetchPosts(browsePosts), error => error === ghostError);
    });
});
