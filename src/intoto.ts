export type DigestMap = Record<string, string>

export interface Subject {
  name: string
  digest: DigestMap
}

export interface Statement {
  _type: 'https://in-toto.io/Statement/v1'
  subject: Subject[]
  predicateType: string
  predicate: Record<string, unknown>
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value)
}

export function validateSubjects(subjects: Subject[]): void {
  if (!Array.isArray(subjects) || subjects.length === 0) {
    throw new Error('subjects must be a non-empty array')
  }

  for (const subject of subjects) {
    if (!subject.name || typeof subject.name !== 'string') {
      throw new Error('each subject must have a non-empty name')
    }

    if (!subject.digest || typeof subject.digest !== 'object') {
      throw new Error(`subject.digest is required for ${subject.name}`)
    }

    const entries = Object.entries(subject.digest)
    if (entries.length === 0) {
      throw new Error(`subject.digest must not be empty for ${subject.name}`)
    }

    for (const [alg, digest] of entries) {
      if (!isHex(digest)) {
        throw new Error(`invalid hex digest for ${subject.name}: ${alg}=${digest}`)
      }
    }
  }
}

export function buildStatement(
  subjects: Subject[],
  predicateType: string,
  predicate: Record<string, unknown>
): Statement {
  validateSubjects(subjects)

  if (!predicateType) {
    throw new Error('predicateType is required')
  }

  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: subjects,
    predicateType,
    predicate
  }
}
