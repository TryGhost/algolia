import {readFile} from 'node:fs/promises';

import {describe, expect, test} from 'vitest';

const workflowUrl = new URL(
    '../../../.github/workflows/live-ghost-content-smoke.yml',
    import.meta.url
);

function topLevelBlock(workflow: string, key: string): string {
    const match = workflow.match(new RegExp(`^${key}:\\n(?:^[ \\t].*\\n?)*`, 'm'));

    expect(match, `${key} block`).not.toBeNull();
    return match?.[0].trimEnd() ?? '';
}

function stepContaining(workflow: string, value: string): string {
    const steps = workflow.split(/(?=^ {6}- )/m);
    const step = steps.find(candidate => candidate.includes(value));

    expect(step, `step containing ${value}`).toBeDefined();
    return step ?? '';
}

describe('live Ghost content smoke workflow', () => {
    test('keeps authenticated live observation manual, upstream-only, and read-only', async () => {
        const workflow = await readFile(workflowUrl, 'utf8');

        expect(topLevelBlock(workflow, 'on')).toBe('on:\n  workflow_dispatch:');
        expect(topLevelBlock(workflow, 'permissions')).toBe('permissions:\n  contents: read');
        expect(workflow).toMatch(
            /^ {4}if: github\.repository == 'TryGhost\/algolia' && github\.ref == 'refs\/heads\/main'$/m
        );

        const actionReferences = [
            ...workflow.matchAll(/^[ \t]+(?:-[ \t]+)?uses:[ \t]+(.+)$/gm)
        ].map(([, value]) => value?.replace(/[ \t]+#.*$/, ''));

        expect(actionReferences).toEqual([
            expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
            expect.stringMatching(/^pnpm\/action-setup@[0-9a-f]{40}$/),
            expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/)
        ]);

        expect(workflow).toMatch(/^ {4}timeout-minutes: 15$/m);

        expect(stepContaining(workflow, 'actions/checkout@')).toMatch(
            /^ {10}persist-credentials: false$/m
        );

        const executionStep = stepContaining(workflow, 'smoke:live');
        const secretReferences = workflow.match(/\$\{\{\s*secrets\.[^}]+\}\}/g) ?? [];

        expect(secretReferences).toEqual(['${{ secrets.MAIN_GHOST_CONTENT_API_KEY }}']);
        expect(executionStep).toContain(
            'MAIN_GHOST_CONTENT_API_KEY: ${{ secrets.MAIN_GHOST_CONTENT_API_KEY }}'
        );
        expect(executionStep).toMatch(/^ {10}GHOST_URL: https:\/\/main\.ghost\.is$/m);
        expect(executionStep).toMatch(/^ {10}GHOST_API_VERSION: v6\.0$/m);
        expect(executionStep).toMatch(
            /^ {8}run: pnpm --filter @tryghost\/algolia-html-extractor smoke:live$/m
        );

        const prohibitedCapabilities = [
            /^\s*(?:schedule|pull_request|pull_request_target|push|workflow_run):/m,
            /^\s*issues:\s*write\s*$/m,
            /actions\/(?:cache|upload-artifact|download-artifact)@/,
            /^\s*cache:/m,
            /\b(?:git (?:add|commit|push)|gh issue|npm publish|pnpm publish|nx release|pnpm ship)\b/,
            /(?:baseline|fixture).*(?:update|write)|(?:update|write).*(?:baseline|fixture)/i
        ];

        for (const prohibitedCapability of prohibitedCapabilities) {
            expect(workflow).not.toMatch(prohibitedCapability);
        }
    });
});
