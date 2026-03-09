import * as core from '@actions/core'
import {readFile} from 'node:fs/promises'
import {buildStatement, type Subject, validateSubjects} from './intoto.js'
import {buildSlsaPredicate} from './slsa.js'
import {signAndUpload} from './sign.js'

function parseChecksumLine(line: string, lineNo: number): Subject {
  const trimmed = line.trim()
  if (!trimmed) {
    throw new Error(`line ${lineNo}: empty line`)
  }

  const match = trimmed.match(/^([0-9a-fA-F]{64})\s+\*?(.*?)$/)
  if (!match) {
    throw new Error(
      `line ${lineNo}: invalid format. expected "<sha384><space><artifact_name>"`
    )
  }

  const [, sha384, name] = match

  if (!name) {
    throw new Error(`line ${lineNo}: artifact name is missing`)
  }

  return {
    name,
    digest: {
      sha384: sha384.toLowerCase()
    }
  }
}

async function loadSubjectsFromChecksumsFile(filePath: string): Promise<Subject[]> {
  const raw = await readFile(filePath, 'utf8')
  const lines = raw.split(/\r?\n/)

  const subjects: Subject[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    subjects.push(parseChecksumLine(line, i + 1))
  }

  validateSubjects(subjects)
  return subjects
}

async function run(): Promise<void> {
  const subjectChecksums = core.getInput('subject-checksums', {required: true})
  const predicateType =
    core.getInput('predicate-type') || 'https://slsa.dev/provenance/v1'
  const payloadType =
    core.getInput('payload-type') || 'application/vnd.in-toto+json'
  const rekorServer =
    core.getInput('rekor-server') || 'https://rekor.sigstore.dev'
  const uploadToRekor = core.getBooleanInput('upload-to-rekor')

  const subjects = await loadSubjectsFromChecksumsFile(subjectChecksums)
  const predicate = buildSlsaPredicate(subjects)
  const statement = buildStatement(subjects, predicateType, predicate)

  const result = await signAndUpload(statement, {
    payloadType,
    rekorServer,
    uploadToRekor
  })

  core.setOutput('statement', JSON.stringify(result.statement))
  core.setOutput('dsse', JSON.stringify(result.dsse))
  core.setOutput('bundle', JSON.stringify(result.bundle))
  core.setOutput('certificate-pem', result.certificatePem)

  if (result.rekorOutput) {
    core.setOutput('rekor-output', result.rekorOutput)
  }
}

run().catch(err => {
  core.setFailed(err instanceof Error ? err.message : String(err))
})

