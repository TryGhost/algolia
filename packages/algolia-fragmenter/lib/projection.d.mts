import type { GhostContentIssue } from './errors.mjs';
import { type ResolvedPolicy } from './policy.mjs';
export type GhostContent = Readonly<Record<string, unknown>>;
export type PreparedContent = Readonly<{
    index: number;
    id: string;
    slug: string;
    url: string;
    title: string;
    html: string;
    projected: Readonly<Record<string, unknown>>;
    rankingSiblings: Readonly<Record<string, unknown>>;
}>;
export type ContentPreparation = Readonly<{
    ok: true;
    contents: readonly PreparedContent[];
}> | Readonly<{
    ok: false;
    issues: readonly GhostContentIssue[];
}>;
/**
 * Validates the whole batch in input order and prepares the content that survives ignored-slug
 * exclusion. Validation and projection share one reader, so a prepared item always projects the
 * values that were validated.
 */
export declare const prepareGhostContent: (ghostContent: unknown, policy: ResolvedPolicy) => ContentPreparation;
//# sourceMappingURL=projection.d.mts.map