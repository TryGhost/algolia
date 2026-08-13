import IndexFactory from './algolia-indexer.cjs';
import transforms from './algolia-fragmenter.cjs';
// Keep transitive CommonJS dependencies visible to Netlify's file tracer.
import 'algolia-html-extractor';
import 'algoliasearch';

export {IndexFactory, transforms};
