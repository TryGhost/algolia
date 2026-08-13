interface FragmentTransforms {
    transformToAlgoliaObject(
        posts: Array<Record<string, unknown>>
    ): Array<Record<string, unknown>>;
    fragmentTransformer(
        accumulator: Array<Record<string, unknown>>,
        post: Record<string, unknown>
    ): Array<Record<string, unknown>>;
}

declare const transforms: FragmentTransforms;
export = transforms;
