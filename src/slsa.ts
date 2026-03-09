import * as github from '@actions/github'
import type {Subject} from './intoto.js'

export function buildSlsaPredicate(subjects: Subject[]): Record<string, unknown> {
  const ctx = github.context
  const now = new Date().toISOString()

  const repository = `${ctx.repo.owner}/${ctx.repo.repo}`
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
  const ref = process.env.GITHUB_REF ?? ''
  const workflow = process.env.GITHUB_WORKFLOW ?? ''
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? ''
  const actor = process.env.GITHUB_ACTOR ?? ''

  return {
    buildDefinition: {
      buildType: 'https://github.com/Actions',
      externalParameters: {
        repository,
        ref,
        workflow,
        eventName: ctx.eventName
      },
      internalParameters: {
        githubRunId: String(ctx.runId),
        githubRunAttempt: runAttempt,
        actor
      },
      resolvedDependencies: [
        {
          uri: `git+${serverUrl}/${repository}`,
          digest: {
            sha1: ctx.sha
          }
        }
      ]
    },
    runDetails: {
      builder: {
        id: 'https://github.com/actions'
      },
      metadata: {
        invocationId: `${serverUrl}/${repository}/actions/runs/${ctx.runId}`,
        startedOn: now,
        finishedOn: now
      }
    },
    metadata: {
      subjects
    }
  }
}
