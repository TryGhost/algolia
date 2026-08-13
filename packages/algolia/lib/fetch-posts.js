const DEFAULT_PAGE_SIZE = 100;
const PAGE_DELAY_MS = 100;

const waitBetweenPages = () => {
    return new Promise(resolve => {
        setTimeout(resolve, PAGE_DELAY_MS);
    });
};

const getNextPage = posts => {
    if (!posts.meta || !posts.meta.pagination || typeof posts.meta.pagination !== 'object') {
        throw TypeError('Ghost returned posts without pagination metadata.');
    }

    const nextPage = posts.meta.pagination.next;

    if (nextPage !== null && (!Number.isInteger(nextPage) || nextPage < 1)) {
        throw TypeError('Ghost returned an invalid next page.');
    }

    return nextPage;
};

const validatePosts = posts => {
    if (!Array.isArray(posts)) {
        throw TypeError('Ghost returned posts in an invalid format.');
    }
};

module.exports.fetchPosts = async (browsePosts, options = {}) => {
    const hasExplicitLimit = options.limit !== undefined;
    const params = {include: 'tags,authors'};

    if (hasExplicitLimit) {
        params.limit = options.limit;
        if (options.page !== undefined) {
            params.page = options.page;
        }
    } else {
        params.limit = DEFAULT_PAGE_SIZE;
        params.page = 1;
    }

    if (options.filter !== undefined) {
        params.filter = options.filter;
    }

    const firstPage = await browsePosts(params);
    validatePosts(firstPage);
    const posts = [...firstPage];

    if (hasExplicitLimit) {
        return posts;
    }

    let nextPage = getNextPage(firstPage);
    const fetchedPages = new Set([1]);

    while (nextPage !== null) {
        if (fetchedPages.has(nextPage)) {
            throw TypeError('Ghost returned a repeated next page.');
        }

        fetchedPages.add(nextPage);
        await waitBetweenPages();
        const page = await browsePosts({...params, page: nextPage});
        validatePosts(page);
        posts.push(...page);
        nextPage = getNextPage(page);
    }

    return posts;
};
