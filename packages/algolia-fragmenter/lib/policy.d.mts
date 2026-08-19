import type { PolicyIssue } from './errors.mjs';
export type OptionalProjectionSource = 'image' | 'tags' | 'authors' | 'excerpt' | 'custom_excerpt' | 'feature_image_alt' | 'feature_image_caption' | 'canonical_url' | 'featured' | 'visibility' | 'created_at' | 'updated_at' | 'published_at' | 'reading_time';
export type ProjectionField = OptionalProjectionSource | Readonly<{
    source: OptionalProjectionSource;
    as: string;
}>;
export type RankingSource = 'featured' | 'reading_time';
export type RankingField = Readonly<{
    source: RankingSource;
    as: string;
}>;
export type ContentProjection = Readonly<{
    fields: readonly ProjectionField[];
    customRanking?: readonly RankingField[];
}>;
export type CreateAlgoliaRecordsOptions = Readonly<{
    ignoreSlugs?: readonly string[];
    contentProjection?: ContentProjection;
}>;
export type ResolvedProjectionField = Readonly<{
    source: OptionalProjectionSource;
    outputKey: string;
}>;
export type ResolvedRankingField = Readonly<{
    source: RankingSource;
    outputKey: string;
}>;
export type ResolvedPolicy = Readonly<{
    ignoreSlugs: readonly string[];
    fields: readonly ResolvedProjectionField[];
    rankingFields: readonly ResolvedRankingField[];
}>;
export type PolicyResolution = Readonly<{
    ok: true;
    policy: ResolvedPolicy;
}> | Readonly<{
    ok: false;
    issues: readonly PolicyIssue[];
}>;
export declare const isPlainObject: (value: unknown) => value is Record<string, unknown>;
/**
 * Validates caller options before any Ghost content is inspected and returns the policy the
 * projection, ranking, and record stages read. Every policy issue is collected in declaration
 * order rather than stopping at the first one.
 */
export declare const resolvePolicy: (options: unknown) => PolicyResolution;
//# sourceMappingURL=policy.d.mts.map