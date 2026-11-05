/** The package-wide external error contract for failed Algolia operations. */
export type TransportError = Error & Readonly<{
    code?: unknown;
    status?: unknown;
}>;
export type MappedAlgoliaError = Error & {
    errorType: 'AlgoliaError';
    code: unknown;
    status?: unknown;
    originalError: TransportError;
};
/**
 * Maps a transport error to the package's stable external error shape. The mapping preserves the
 * historical `AlgoliaError` contract: `errorType`, the transport `code`, the HTTP `status` when
 * one exists, the transport message, and the original error.
 */
export declare const mapAlgoliaError: (error: unknown) => MappedAlgoliaError;
//# sourceMappingURL=errors.d.cts.map