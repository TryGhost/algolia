# Set up Ghost Algolia on Netlify

These functions keep an existing Algolia index up to date when posts change in Ghost. For a new index, [import your published posts with the CLI](https://github.com/TryGhost/algolia/blob/main/packages/algolia/README.md) first. Your website also needs a search interface connected to that index.

## Before deploying

Have your Algolia application ID, index name, and an API key restricted to that index ready. The key needs `addObject` and `deleteIndex` permissions; the index needs `filterOnly(slug)` in its facets, which the CLI configures by default.

Create a long, random secret in your password manager for `NETLIFY_KEY`. Save it: you will use it again to connect Ghost.

## Deploy

1. Connect GitHub when Netlify asks, then choose where to create your repository copy.
2. Enter `ALGOLIA_APP_ID`, `ALGOLIA_API_KEY`, `ALGOLIA_INDEX`, and your `NETLIFY_KEY`. Keep `ALGOLIA_ACTIVE` set to `TRUE`.
3. Deploy using the repository's build settings.

If you already have a fork, sync it with this repository once to include the deployment setup. Then import it into Netlify and enter these values in its environment variables, available to production Functions.

## Connect Ghost

1. Open the published site's main URL after deployment finishes. Preview deployments cannot connect webhooks.
2. Enter your existing `NETLIFY_KEY` and click **Verify secret**. The page checks it with your Netlify site before showing the webhook URLs. This does not change the saved secret.
3. In Ghost Admin, open **Settings → Integrations**, create a custom integration, and add a webhook for each event:

| Event | URL to copy from the setup page |
| --- | --- |
| Post published (`post.published`) | Publish and update |
| Published post edited (`post.published.edited`) | Publish and update |
| Post unpublished (`post.unpublished`) | Unpublish and delete |
| Post deleted (`post.deleted`) | Unpublish and delete |

Keep these URLs private: they contain your webhook secret. With indexing enabled, publish a test post, check its updates in Algolia, then unpublish it and confirm its records disappear. Setup is then complete. You can close the page; the webhooks keep running.

## Updates

Rebuild in Netlify to receive the latest compatible `0.x` release. This works with a repository copy or fork, without syncing it for routine runtime updates. Netlify uses the same versions as `@tryghost/algolia-netlify` on npm. A major upgrade requires setting `ALGOLIA_INTEGRATION_VERSION` to the new major and rebuilding. Set an exact version to pin or roll back the code; rollback does not undo index changes. Automatic updates exclude prereleases.

See the [Netlify guide](https://github.com/TryGhost/algolia/blob/main/packages/algolia-netlify/README.md#existing-installations) when upgrading an existing installation.
