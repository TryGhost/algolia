/** The package-wide external error contract for failed Algolia operations. */

export type TransportError = Error & Readonly<{code?: unknown; status?: unknown}>;

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
export const mapAlgoliaError = (error: unknown): MappedAlgoliaError => {
    const originalError = error as TransportError;
    const mapped = new Error('Error processing Algolia') as MappedAlgoliaError;

    mapped.errorType = 'AlgoliaError';
    mapped.code = originalError.code;
    if (originalError.status) {
        mapped.status = originalError.status;
    }
    if (originalError.message) {
        mapped.message = originalError.message;
    }
    mapped.originalError = originalError;

    return mapped;
};
