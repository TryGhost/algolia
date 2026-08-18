export type GhostContent = Readonly<Record<string, unknown>>;
export type AlgoliaRecord = Record<string, unknown>;
/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export declare const fragmentTransformer: (recordAccumulator: AlgoliaRecord[], ghostContent: AlgoliaRecord) => AlgoliaRecord[];
/**
 * @deprecated Retained for compatibility while the deep record-building API is introduced.
 */
export declare const transformToAlgoliaObject: (posts: readonly GhostContent[], ignoreSlugs?: readonly string[]) => AlgoliaRecord[];
declare const _default: {
    fragmentTransformer: typeof fragmentTransformer;
    transformToAlgoliaObject: typeof transformToAlgoliaObject;
};
export default _default;
//# sourceMappingURL=index.d.mts.map