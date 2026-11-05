"use strict";
/** The package-wide external error contract for failed Algolia operations. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAlgoliaError = void 0;
/**
 * Maps a transport error to the package's stable external error shape. The mapping preserves the
 * historical `AlgoliaError` contract: `errorType`, the transport `code`, the HTTP `status` when
 * one exists, the transport message, and the original error.
 */
const mapAlgoliaError = (error) => {
    const originalError = error;
    const mapped = new Error('Error processing Algolia');
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
exports.mapAlgoliaError = mapAlgoliaError;
//# sourceMappingURL=errors.cjs.map