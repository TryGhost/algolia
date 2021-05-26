# Algolia Ghost CLI

CLI tool to initially index the full Ghost post content into an Algolia index.

## Install

`npm install @tryghost/algolia --save`

or

`yarn add @tryghost/algolia`


## Usage

To use the CLI, install the dependencies with `yarn install` or `npm install`.

Copy the existing `example.config.json` to e. g. `config.json` and replace the relevant values for Ghost and Algolia.
`indexSettings` reflects the current default settings and can either be overwritten, or removed from the config file.

To run the batch index, run

```bash
yarn algolia index <pathToConfig> [options]
```

### Caveats

The [Fragmenter](https://github.com/TryGhost/algolia/tree/master/packages/algolia-fragmenter) breaks down large HTML pieces into smaller chunks by its headings. Sometimes the fragment is still too big and Algolia will throw an error listing the post id that caused the large fragment. The post id can be used to get the post slug, which then can be excluded from the batch run like this:

```bash
yarn algolia index <pathToConfig> -s post-slug-to-exclude,and-another-post-slug-to-exclude
```

### Flags

- `pathToConfig`, needs to be the relative (from this package) path to the config JSON file that contains the Ghost and Algolia API keys and settings (see [usage](#usage) above)

- `-s, --skip`, takes a comma separated list of post slugs that need to be **excluded** from the index (see [caveats](#caveats) above)

- `-V, --verbose`, switches on verbose mode, but there's not much too see here (yet)
- `-l, --limit`, limit the amount of posts to receive. Default is 'all'
- `-p --page`, define the page to fetch posts from. To be used in combination with `limit`.
- `-sjs --skipjsonslugs`, uses a list of slugs in `config.json` to skip before they're uploaded. This method will request all data from Ghost and skip at the point it would normally upload to Algolia. If you're getting `414 Request-URI Too Large` errors using `-s`, this is the method to use.

## Develop

This is a mono repository, managed with [lerna](https://lernajs.io/).

Follow the instructions for the top-level repo.
1. `git clone` this repo & `cd` into it as usual
2. Run `yarn` to install top-level dependencies.


## Run

- `yarn dev`


## Test

- `yarn lint` run just eslint
- `yarn test` run lint and tests




# Copyright & License

Copyright (c) 2013-2021 Ghost Foundation - Released under the [MIT license](LICENSE).
