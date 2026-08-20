export type FragmenterErrorCode = 'INVALID_POLICY' | 'INVALID_GHOST_CONTENT' | 'RECORD_TOO_LARGE';
export type PolicyIssueReason = 'invalid-shape' | 'unknown-property' | 'unknown-source' | 'repeated-source' | 'repeated-output' | 'invalid-alias' | 'protected-collision' | 'container-collision' | 'canonical-collision' | 'reserved-collision';
export type PolicyIssue = Readonly<{
    kind: 'policy';
    reason: PolicyIssueReason;
    path: string;
    message: string;
}>;
export type GhostContentIssueReason = 'invalid-shape' | 'missing' | 'wrong-type';
export type ExpectedValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export type GhostContentIssue = Readonly<{
    kind: 'content';
    reason: GhostContentIssueReason;
    path: string;
    index: number | null;
    contentId: string | null;
    expected: ExpectedValueType;
    message: string;
}>;
export type RecordSizeIssue = Readonly<{
    kind: 'size';
    reason: 'record-too-large';
    path: string;
    index: number;
    contentId: string;
    objectID: string;
    anchor: string | null;
    position: number | null;
    bytes: number;
    limit: number;
    excess: number;
    message: string;
}>;
export type FragmenterIssue = PolicyIssue | GhostContentIssue | RecordSizeIssue;
/**
 * The single public error for every deterministic policy, Ghost content, or record size
 * problem found while building Algolia records. It never carries a partial record batch.
 */
export declare class FragmenterError extends Error {
    readonly code: FragmenterErrorCode;
    readonly issues: readonly FragmenterIssue[];
    constructor(code: FragmenterErrorCode, issues: readonly FragmenterIssue[]);
}
//# sourceMappingURL=errors.d.mts.map