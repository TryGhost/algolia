import IndexFactory from '@tryghost/algolia-indexer';
import transforms from '@tryghost/algolia-fragmenter';
// Keep transitive CommonJS dependencies visible to Netlify's file tracer.
import 'algolia-html-extractor';
import 'algoliasearch';

export {IndexFactory, transforms};
