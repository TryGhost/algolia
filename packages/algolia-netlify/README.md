# Algolia Netlify

[Netlify Functions](https://www.netlify.com/products/functions/) to listen to [Ghost Webhooks](https://ghost.org/docs/api/webhooks/) on post changes and update defined [Algolia](https://www.algolia.com/) search index.

## Usage

### Set up Algolia

First step is to grap the API keys and Application ID from Algolia. For the setup we need both, the "Search-Only API Key" as well as the "Admin API Key".

The Admin API Key can either be the general one, or can be created just for this specific search index.

If you decide to create a new API key, you want to make sure that the generated key has the following authorizations on your index:

- Search (`search`)
- Add records (`addObject`)
- Delete records (`deleteObject`)
- List indexes (`listIndexes`)
- Delete index (`deleteIndex`)

### Set up Netlify Functions

The Ghost Algolia tooling uses [Ghost Webhooks](https://ghost.org/docs/api/webhooks/) to index and update posts. The scripts that receive and process the webhooks are hosted by [Netlify Functions](https://www.netlify.com/products/functions/):

1. Deploy to Netlify by clicking on this button:
   [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/TryGhost/algolia)
2. Click 'Connect to Github' and give Netlify permission
3. Configure your site
    - Choose a repository name
    - Set 'TRUE' to trigger indexing
    - Algolia Application ID
    - The Algolia Admin API key or and API key with the permissions as described above
    - The name of the index you want to use

### Set up Ghost Webhooks

Ghost webhooks will initiate posts to be indexed to Algolia. This can be a new entry, an update, or a removal. On Ghost's admin panel, create a new **Custom Integration** (Ghost Admin &#8594; Settings &#8594; Integrations &#8594; Custom Integrations) and the following **webhooks**:

1. `post.published`
   - Name: Post published
   - Event: Post published
   - Target URL: the endpoint of the post-published function, found on Netlify's admin panel (https://YOUR-SITE-ID.netlify.com/.netlify/functions/post-published)

2. `post.published.edited`
   - Name: Post updated
   - Event: Published post updated
   - Target URL: the endpoint of the post-published function, found on Netlify's admin panel (https://YOUR-SITE-ID.netlify.com/.netlify/functions/post-published)

3. `post.unpublished`
   - Name: Post unpublished
   - Event: Post unpublished
   - Target URL: the endpoint of the post-published function, found on Netlify's admin panel (https://YOUR-SITE-ID.netlify.com/.netlify/functions/post-unpublished)

4. `post.updated`
   - Name: Post deleted
   - Event: Post deleted
   - Target URL: the endpoint of the post-published function, found on Netlify's admin panel (https://YOUR-SITE-ID.netlify.com/.netlify/functions/post-unpublished)

These webhooks will trigger an index on every **future change of posts**.

> To run an initial index of all the content, you can use the handy CLI from our Ghost Algolia tooling. Head over [here](https://github.com/TryGhost/algolia/tree/master/packages/algolia) and follow the instructions from there.


## Develop

This is a mono repository, managed with [lerna](https://lernajs.io/).

Follow the instructions for the top-level repo.
1. `git clone` this repo & `cd` into it as usual
2. Run `yarn` to install top-level dependencies.

To run this package locally, you will need to copy the existing `.env.example` file to `.env` and fill it with the correct keys.

By running

- `yarn serve`

you will create a server on `localhost:9000` where your functions will be exposed to listen to (e. g. http://localhost:9000/.netlify/functions/post-unpublished), so you can use them in your local Ghost instance as Webhook target URL.


## Test

- `yarn lint` run just eslint
- `yarn test` run lint and tests


# Copyright & License

Copyright (c) 2013-2021 Ghost Foundation - Released under the [MIT license](LICENSE).
