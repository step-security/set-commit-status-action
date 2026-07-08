import { getInput, info, setFailed, warning } from '@actions/core';
import { getOctokit } from '@actions/github';
import fs from 'fs';
import * as core from '@actions/core';
import axios, { isAxiosError } from 'axios';
import {
    CommitStatusState,
    getCommitHash,
    isForeignPullRequest,
    parseRepoName,
    validateCommitStatusState,
} from './utils';

async function validateSubscription(): Promise<void> {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    let repoPrivate: boolean | undefined;

    if (eventPath && fs.existsSync(eventPath)) {
        const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8')) as {
            repository?: { private?: boolean };
        };
        repoPrivate = eventData.repository?.private;
    }

    const upstream = 'myrotvorets/set-commit-status-action';
    const action = process.env.GITHUB_ACTION_REPOSITORY;
    const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';

    core.info('');
    core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
    core.info(`Secure drop-in replacement for ${upstream}`);
    if (repoPrivate === false) {
        core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
    }
    core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
    core.info('');

    if (repoPrivate === false) {
        return;
    }

    const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
    const body: Record<string, string> = { action: action ?? '' };
    if (serverUrl !== 'https://github.com') {
        body.ghes_server = serverUrl;
    }
    try {
        await axios.post(
            `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
            body,
            { timeout: 3000 },
        );
    } catch (error) {
        if (isAxiosError(error) && error.response?.status === 403) {
            core.error(
                `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`,
            );
            core.error(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
            process.exit(1);
        }
        core.info('Timeout or API not reachable. Continuing to next step.');
    }
}

interface Inputs {
    token: string;
    state: CommitStatusState;
    owner: string;
    repo: string;
    allowForks: boolean;
    sha: string;
    targetUrl?: string;
    description?: string;
    context?: string;
}

function getInputs(): Inputs {
    const token = getInput('token', { required: true });
    const state = validateCommitStatusState(getInput('status', { required: true }));
    const [owner, repo] = parseRepoName(getInput('repo'));
    const allowForks = getInput('allowForks');
    const sha = getCommitHash(getInput('sha'));
    const targetUrl = getInput('targetUrl');
    const description = getInput('description');
    const context = getInput('context');

    return {
        token,
        state,
        repo,
        owner,
        allowForks: allowForks ? allowForks === 'true' : false,
        sha,
        targetUrl: targetUrl || undefined,
        description: description || undefined,
        context: context,
    };
}

async function run(): Promise<void> {
    await validateSubscription();
    try {
        const inputs = getInputs();
        if (isForeignPullRequest() && !inputs.allowForks) {
            warning('Ignoring the PR from a forked repository');
            return;
        }

        info(
            `Setting commit status for ${inputs.owner}/${inputs.repo}#${inputs.sha} to ${inputs.state} for context ${inputs.context}`,
        );

        const octokit = getOctokit(inputs.token);
        await octokit.rest.repos.createCommitStatus({
            owner: inputs.owner,
            repo: inputs.repo,
            sha: inputs.sha,
            state: inputs.state,
            target_url: inputs.targetUrl,
            description: inputs.description,
            context: inputs.context,
        });
    } catch (error) {
        setFailed((error as Error).message);
    }
}

void run();
