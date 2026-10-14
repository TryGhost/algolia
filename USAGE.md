# Set up and manage Ghost Algolia on Netlify

Ghost sends a webhook (a notification) when a post changes. Your Netlify site receives it and updates your Algolia search index, the collection of records your website searches.

This guide covers the release-based setup selected by the Deploy to Netlify button. If your search already works, you can keep your existing installation. Follow the [optional migration steps](packages/algolia-netlify/README.md#existing-installations) before using the version settings below.

## 1. Gather your settings

You need an Algolia index and a website search interface connected to it. For an empty index, [import your published posts with the CLI](packages/algolia/README.md) first. This requires a terminal; ask your website developer for help if needed. You do not need to reimport a working index.

In the Algolia dashboard, select the application used by your website:

- Open **Settings → API Keys** and copy the **Application ID**.
- Open **Search**, select your index, and copy its exact name.
- Under **API Keys → All API Keys**, create a key restricted to that index with `addObject` and `deleteIndex` permissions. Save this as your webhook API key. A search-only key cannot update records. See [Algolia's key creation instructions](https://support.algolia.com/hc/en-us/articles/9438531643665-How-do-I-generate-keys).

The index needs `filterOnly(slug)` in `attributesForFaceting` so unpublishing can remove a post's records. The CLI sets this up. If someone maintains custom index settings for you, ask them to check it.

Generate a long random secret in your password manager for `NETLIFY_KEY`. Save it for the setup page. This is a separate secret you choose, not an Algolia key.

See the [configuration reference](docs/netlify-configuration.md) for each setting and copyable examples.

## 2. Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2FTryGhost%2Falgolia&base=deployment#ALGOLIA_ACTIVE=TRUE&ALGOLIA_APP_ID=&ALGOLIA_API_KEY=&ALGOLIA_INDEX=&NETLIFY_KEY=)

1. Click the button, sign in to Netlify, and connect GitHub when asked. Choose where to create your repository copy.
2. Enter your application ID, webhook API key, index name, and secret. Keep `ALGOLIA_ACTIVE` set to `TRUE`.
3. Deploy with the supplied build settings. Wait for the production deployment to finish, then open the site's main URL.

## 3. Connect Ghost

1. On your deployed setup page, enter the existing `NETLIFY_KEY` and click **Verify secret**. This checks the saved secret; it does not change it.
2. In Ghost Admin, open **Settings → Integrations** and create a custom integration named "Algolia search".
3. Add these four webhooks, copying the URLs from the setup page:

| Ghost event | URL to copy |
| --- | --- |
| Post published | Publish and update |
| Published post edited | Publish and update |
| Post unpublished | Unpublish and delete |
| Post deleted | Unpublish and delete |

Keep the URLs private: they contain your secret. Preview deployments intentionally disable indexing. Use the main production URL.

## 4. Check that it works

1. Publish a test post with a distinctive phrase. Open your index in Algolia and find the post's records.
2. Edit the phrase and update the post. Confirm the new text appears in Algolia.
3. Unpublish the post. Confirm its records disappear.

If all three checks pass, you can close the setup page. The webhooks keep running. If the records are correct but your website's search is not, check its search interface separately.

## Change your settings

1. Open your project in Netlify, then **Project configuration → Environment variables**.
2. Edit the existing variable, or choose **Add a variable** to create one. Enter its name and value as shown in the [configuration reference](docs/netlify-configuration.md). Paste values without surrounding quotes.
3. Set the value for **Production**. If scope controls are available, use **Functions** for webhook settings and **Builds** for the version selector. A scope controls where a setting is available; Production selects the live site. Keep production credentials out of preview and branch deployments.
4. Save, then open **Deploys → Trigger deploy** and start a new production deploy. Changed settings take effect in the new deployment.
5. Repeat the [post checks](#4-check-that-it-works).

For example, to enable indexing, edit `ALGOLIA_ACTIVE`, enter `TRUE`, save, and redeploy. You do not need a `.env` file or a code change. [Netlify's environment variable guide](https://docs.netlify.com/build/environment-variables/get-started/) covers the dashboard controls.

## Update your integration

### Get compatible updates

Leave `ALGOLIA_INTEGRATION_VERSION` unset, or set it to `0` in Production's Builds scope. In **Deploys → Trigger deploy**, start a new production deploy. It selects the newest stable release within major `0`. Publishing a release does not change your running site until it rebuilds.

This works for repository copies and forks without syncing them for routine runtime updates. The deployment loader itself comes from your connected repository, so a loader update may still require syncing a fork.

Open the completed deploy's build log and find `Prepared Algolia integration`. The number beside it is the version deployed. Keep a note of that version before an upgrade, then repeat the post checks.

### Choose a specific version or a new major

1. Open [available Netlify integration releases](https://github.com/TryGhost/algolia/releases). Choose a **Netlify integration** release without the **Pre-release** label. Read its notes and any migration instructions. Versions of the CLI, extractor, and fragmenter are not deployment selections.
2. Copy just the version number from the release title. In Netlify, add or edit `ALGOLIA_INTEGRATION_VERSION` in **Production → Builds** and paste that number.
3. Save and trigger a production deploy. Check the resolved version in its build log, then test the webhooks.

An exact version stays pinned on later rebuilds. To follow compatible updates within a major, enter only that release's first number instead. A major upgrade always needs your explicit selection. `latest`, version ranges, and branch names are not accepted.

Test a major upgrade on a separate Netlify site and Algolia index first. Read its migration instructions before changing the index used by your live search. Your saved credentials and webhook URLs do not need changing just to select another version.

### Roll back

Set `ALGOLIA_INTEGRATION_VERSION` to your previous exact published version, save, and deploy again. Confirm the version in the build log and repeat the post checks. Rollback changes the code; it does not restore records already changed in Algolia. Follow the release's migration instructions if an upgrade changed your index.

## If something does not work

| What you see | What to check |
| --- | --- |
| Version selection fails during the build | Choose a published Netlify integration version. Check the build log for the release lookup error. |
| Setup says the secret is wrong or missing | Check `NETLIFY_KEY` in Production's Functions settings, redeploy, and enter that same value. |
| Secret verifies but posts do not appear | Check `ALGOLIA_ACTIVE` is exactly `TRUE`, the index name and API key permissions are correct, and the deployment is production. |
| Publishing works but unpublishing fails | Check the key has `deleteIndex` permission and the index has `filterOnly(slug)` configured. |
| A webhook fails after changing optional fields | Check the JSON in `ALGOLIA_CONTENT_PROJECTION`, or delete that variable to restore defaults. |

Open the failed function's logs in Netlify for the error details. Do not paste API keys or full webhook URLs into a public support request.
