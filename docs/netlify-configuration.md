# Netlify configuration reference

Enter these settings in your Netlify project's **Project configuration → Environment variables**. Use the [customer guide](../USAGE.md#change-your-settings) for the save and deploy steps. The deployed setup page verifies your secret and creates webhook URLs; it does not save settings.

## Webhook settings

Set these for **Production**, with the **Functions** scope where available. They are read by the functions that receive Ghost's webhooks.

| Name | What to enter | Required or default |
| --- | --- | --- |
| `ALGOLIA_APP_ID` | The Application ID shown in your Algolia application's API Keys page. | Required. |
| `ALGOLIA_API_KEY` | A key for the same application, restricted to your index, with `addObject` and `deleteIndex` permissions. | Required. A search-only key is insufficient. |
| `ALGOLIA_INDEX` | The exact index name shown in Algolia, such as `ghost_posts`. Use the index your website searches. | Required. |
| `NETLIFY_KEY` | A long random secret generated in your password manager. Enter this same value on the setup page. | Required for release-based deployments. |
| `ALGOLIA_ACTIVE` | `TRUE` to process post changes, or `FALSE` to pause them. Use uppercase. | The deploy button supplies `TRUE`. Missing or other values disable indexing. |
| `ALGOLIA_CONTENT_PROJECTION` | Optional JSON that chooses extra fields saved with each post's records. See the examples below. | Leave unset to include image, tags, authors, and excerpt. |

Algolia requires `deleteIndex` for deleting records by a filter. It also permits deleting an entire index, so restrict the key to the intended index. The webhook functions do not need permission to read or change index settings.

Pausing indexing leaves existing records in place. Changes made while paused are not replayed when you enable it again. Update still-published posts or reimport them with the CLI. For posts deleted or unpublished while paused, ask your website developer to remove their stale search records; a CLI import does not remove those posts.

### Entering the basic values

Add one variable per row in Netlify. Replace each placeholder with your saved value. These are examples of what belongs in the name and value boxes, not a file to upload:

| Name box | Value box |
| --- | --- |
| `ALGOLIA_APP_ID` | `YOUR_APPLICATION_ID` |
| `ALGOLIA_API_KEY` | `YOUR_RESTRICTED_API_KEY` |
| `ALGOLIA_INDEX` | `ghost_posts` (replace with your actual index name) |
| `NETLIFY_KEY` | `YOUR_OWN_RANDOM_SECRET` |
| `ALGOLIA_ACTIVE` | `TRUE` |

Paste only the value, without backticks or surrounding quotes. Save and redeploy. Do not use the placeholder text as a credential.

Changing `NETLIFY_KEY` also requires replacing all four webhook URLs in Ghost with URLs generated using the new secret. Updating only the integration version does not require a new secret.

## Version selection

Set `ALGOLIA_INTEGRATION_VERSION` for **Production**, with the **Builds** scope. It is used when Netlify builds the deployment, not when a webhook arrives.

| Value | Behavior |
| --- | --- |
| Unset, or `0` | Select the newest stable release within major `0` on each rebuild. This default remains `0` even after later majors are released. |
| An exact published version | Keep that release on every rebuild. Copy the number from a published **Netlify integration** release title. |
| A published major's first number | Follow stable patch and minor releases within that major. Changing this number explicitly opts into the major upgrade. |
| An exact prerelease version | Opt into a test release. Use a separate test site and index. |

Find supported versions in [GitHub Releases](https://github.com/TryGhost/algolia/releases). Select **Netlify integration** releases. Do not use npm versions belonging to other packages. Unavailable versions, `latest`, ranges, and branch names fail the build.

To use the default compatible updates, add this pair:

```text
Name: ALGOLIA_INTEGRATION_VERSION
Value: 0
```

After saving, trigger a production deploy. The build log's `Prepared Algolia integration` line shows the version actually selected. Existing source-based deployments do not use this selector; see [optional migration](../packages/algolia-netlify/README.md#existing-installations).

## Optional fields in search records

Most installations can leave `ALGOLIA_CONTENT_PROJECTION` unset. The standard post identity, title, URL, text, headings, and ranking fields are always included. This setting controls additional fields, such as the image and excerpt used by a search interface.

To keep the default extra fields explicitly, paste this entire line into the value box:

```json
{"fields":["image","tags","authors","excerpt"]}
```

To keep those fields and add Ghost's custom excerpt under a field named `summary`:

```json
{"fields":["image","tags","authors","excerpt",{"source":"custom_excerpt","as":"summary"}]}
```

To keep the default fields and include whether a post is featured as extra ranking data:

```json
{"fields":["image","tags","authors","excerpt"],"customRanking":[{"source":"featured","as":"isFeatured"}]}
```

The last example supplies data only. It does not change Algolia's ranking settings. Ask the person maintaining your search interface before changing field names or ranking.

The `fields` list replaces the default extras. `{"fields":[]}` removes all optional fields. Delete the variable to restore defaults; leaving an empty value is invalid. Use double quotes inside JSON and no surrounding single quotes in Netlify's value box.

Available field sources are `image`, `tags`, `authors`, `excerpt`, `custom_excerpt`, `feature_image_alt`, `feature_image_caption`, `canonical_url`, `featured`, `visibility`, `created_at`, `updated_at`, `published_at`, and `reading_time`. Extra ranking data supports `featured` and `reading_time`. See [field details](../packages/algolia-fragmenter/README.md#options) for aliases and missing values.

Use the same projection in the CLI and webhook settings. Changing this setting does not rewrite existing records by itself; it applies when posts are processed again. Test changes in a separate index before using them for live search.

## Optional build troubleshooting

`GITHUB_TOKEN` is only needed if the build log reports a GitHub API rate limit while looking up releases. Set it for **Production → Builds** using a token with access to public repository information, then redeploy. The loader sends it only to GitHub's API and excludes it from runtime build subprocesses.

The repository supplies `NODE_VERSION`. Netlify supplies `CONTEXT` and `URL`. Leave those managed settings alone during normal setup and upgrades.

## Local development

Hosted settings belong in Netlify. Developers running the functions locally can copy `packages/algolia-netlify/.env.example` to `.env` in that same directory and enter development credentials. Never commit that file. See [local development](../packages/algolia-netlify/README.md#development).
