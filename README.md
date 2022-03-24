# Ghost Algolia tools

Ghost Algolia tools offers tools to index and fragment Ghost posts to an Algolia index. It consists of two user facing tools:

- `algolia`, which is a CLI tool to batch index the full content of a Ghost install to a defined Algolia index
- `algolia-netlify`, which uses Netlify Functions to listen to Ghost webhooks and add, update, and remove posts to an Algolia index


## Usage

### Algolia Netlify package

You can start using the Algolia Netlify package by clicking on this deplooy button. You can find the detailed install and user instructions over [here](https://github.com/TryGhost/algolia/tree/master/packages/algolia-netlify).

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/TryGhost/algolia)

### Ghost Algolia CLI

While the Algolia Netlify tool is useful to maintain your search index, the Ghost Algolia CLI is good for the initial indexing of the full post content of a site. See full install and user instructions in the package description [here](https://github.com/TryGhost/algolia/tree/master/packages/algolia).

## Develop

This is a mono repository, managed with [lerna](https://lernajs.io/).

1. `git clone` this repo & `cd` into it as usual
2. `yarn setup` is mapped to `lerna bootstrap`
   - installs all external dependencies
   - links all internal dependencies

To add a new package to the repo:
   - install [slimer](https://github.com/TryGhost/slimer)
   - run `slimer new <package name>`


## Run

- `yarn dev`


## Test

- `yarn lint` run just eslint
- `yarn test` run lint and tests


## Publish

- `yarn ship` is an alias for `lerna publish`
    - Publishes all packages which have changed
    - Also updates any packages which depend on changed packages


# Copyright & License

Copyright (c) 2013-2022 Ghost Foundation - Released under the [MIT license](LICENSE).
