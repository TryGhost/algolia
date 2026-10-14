import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {release, releaseVersion} from 'nx/release';
import semver from 'semver';

const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
        projects: {type: 'string'},
        'dry-run': {type: 'boolean', default: false},
        'git-remote': {type: 'string'},
        verbose: {type: 'boolean', default: false},
        'first-release': {type: 'boolean', default: false}
    }
});
const specifier = positionals[0];
if (
    positionals.length > 1 ||
    (specifier &&
        !semver.valid(specifier) &&
        !['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'].includes(
            specifier
        ))
) {
    throw new Error('Provide one exact version or semver increment.');
}
const remote = values['git-remote'] ?? process.env.GHOST_UPSTREAM ?? 'origin';
if (!remote || remote.startsWith('-')) {
    throw new Error('Provide a Git remote name or URL.');
}
const projects = values.projects?.split(/[\s,]+/).filter(Boolean);
if (values.projects !== undefined && !projects?.length) {
    throw new Error('Provide at least one project when using --projects.');
}
const options = {
    projects,
    dryRun: values['dry-run'],
    verbose: values.verbose,
    firstRelease: values['first-release']
};
const result =
    specifier && semver.valid(specifier) && semver.prerelease(specifier)
        ? await releaseVersion({
              ...options,
              specifier,
              gitCommit: true,
              gitTag: true,
              stageChanges: true,
              gitPush: false,
              deleteVersionPlans: false
          })
        : await release({...options, specifier, skipPublish: true});
if (
    !values['dry-run'] &&
    Object.values(result.projectsVersionData).some(project => project.newVersion)
) {
    try {
        execFileSync('git', ['push', '--atomic', '--follow-tags', remote], {stdio: 'inherit'});
    } catch (cause) {
        throw new Error(
            'Push failed. The release commit and tags are ready locally. After fixing the error, run git push --atomic --follow-tags with the same remote to publish the prepared release.',
            {cause}
        );
    }
}
