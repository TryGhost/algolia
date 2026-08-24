const MESSAGE_ISSUE_LIMIT = 5;
const describeIssues = (code, issues) => {
    const listed = issues.slice(0, MESSAGE_ISSUE_LIMIT).map(issue => issue.message);
    const remaining = issues.length - listed.length;
    const suffix = remaining > 0 ? `; and ${remaining} more` : '';
    const count = `${issues.length} issue${issues.length === 1 ? '' : 's'}`;
    return `${code}: ${count}. ${listed.join('; ')}${suffix}`;
};
/**
 * The single public error for every deterministic policy, Ghost content, or record size
 * problem found while building Algolia records. It never carries a partial record batch.
 */
export class FragmenterError extends Error {
    code;
    issues;
    constructor(code, issues) {
        super(describeIssues(code, issues));
        this.name = 'FragmenterError';
        this.code = code;
        this.issues = Object.freeze([...issues]);
    }
}
//# sourceMappingURL=errors.mjs.map