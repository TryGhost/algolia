import IndexFactory from '@tryghost/algolia-indexer';
import {fragmentTransformer, transformToAlgoliaObject} from '@tryghost/algolia-fragmenter';
import 'algoliasearch';

const transforms = {fragmentTransformer, transformToAlgoliaObject};

export {IndexFactory, transforms};
