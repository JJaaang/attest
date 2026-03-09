import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp, readFile, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {Statement} from './intoto.js'

const execFileAsync = promisify(execFile)

export interface DsseEnvelope {
  payloadType: string
  payload: string
  signatures: Array<{
    sig: string
  }>
}

export interface SignAndUploadOptions {
  payloadType: string
  rekorServer: string
  uploadToRekor: boolean
}

export interface SignAndUploadResult {
  statement: Statement
  dsse: DsseEnvelope
  bundle: unknown
  certificatePem: string
  rekorOutput?: string
}

function derBase64ToPem(derBase64: string): string {
  const der = Buffer.from(derBase64, 'base64')
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`
}

function createPae(payloadType: string, payload: Buffer): Buffer {
  const typeLen = Buffer.byteLength(payloadType, 'utf8')
  const payloadLen = payload.length
  const prefix = Buffer.from(
    `DSSEv1 ${typeLen} ${payloadType} ${payloadLen} `,
    'utf8'
  )
  return Buffer.concat([prefix, payload])
}

function createDsseEnvelope(
  payloadType: string,
  payload: Buffer,
  signatureB64: string
): DsseEnvelope {
  return {
    payloadType,
    payload: payload.toString('base64'),
    signatures: [{sig: signatureB64}]
  }
}

async function createSigningConfigWithoutTlog(configPath: string): Promise<void> {
  const {stdout} = await execFileAsync('bash', [
    '-lc',
    `curl -sSL https://raw.githubusercontent.com/sigstore/root-signing/refs/heads/main/targets/signing_config.v0.2.json | jq 'del(.rekorTlogUrls)'`
  ])
  await writeFile(configPath, stdout)
}

async function signPaeWithCosign(
  paePath: string,
  bundlePath: string,
  configPath: string
): Promise<void> {
  await execFileAsync(
    'cosign',
    [
      'sign-blob',
      '--yes',
      '--bundle',
      bundlePath,
      '--signing-config',
      configPath,
      paePath
    ],
    {
      env: {
        ...process.env,
        COSIGN_EXPERIMENTAL: '1'
      }
    }
  )
}

async function uploadDsseToRekor(
  rekorServer: string,
  dssePath: string,
  certPath: string
): Promise<string> {
  const {stdout} = await execFileAsync('rekor-cli', [
    'upload',
    '--rekor_server',
    rekorServer,
    '--type',
    'intoto:0.0.2',
    '--artifact',
    dssePath,
    '--pki-format',
    'x509',
    '--public-key',
    certPath
  ])

  return stdout.trim()
}

export async function signAndUpload(
  statement: Statement,
  options: SignAndUploadOptions
): Promise<SignAndUploadResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'attest-'))
  const paePath = path.join(tempDir, 'pae.bin')
  const bundlePath = path.join(tempDir, 'pae.sigstore.json')
  const configPath = path.join(tempDir, 'signing-config-no-tlog.json')
  const dssePath = path.join(tempDir, 'dsse.json')
  const certPath = path.join(tempDir, 'fulcio.crt.pem')

  const statementBytes = Buffer.from(JSON.stringify(statement), 'utf8')
  const pae = createPae(options.payloadType, statementBytes)

  await writeFile(paePath, pae)
  await createSigningConfigWithoutTlog(configPath)
  await signPaeWithCosign(paePath, bundlePath, configPath)

  const bundleRaw = await readFile(bundlePath, 'utf8')
  const bundle = JSON.parse(bundleRaw)

  const signatureB64 = bundle?.messageSignature?.signature
  const certRawB64 = bundle?.verificationMaterial?.certificate?.rawBytes

  if (!signatureB64) {
    throw new Error('bundle missing messageSignature.signature')
  }
  if (!certRawB64) {
    throw new Error('bundle missing verificationMaterial.certificate.rawBytes')
  }

  const certificatePem = derBase64ToPem(certRawB64)
  await writeFile(certPath, certificatePem)

  const dsse = createDsseEnvelope(options.payloadType, statementBytes, signatureB64)
  await writeFile(dssePath, JSON.stringify(dsse, null, 2))

  let rekorOutput: string | undefined
  if (options.uploadToRekor) {
    rekorOutput = await uploadDsseToRekor(options.rekorServer, dssePath, certPath)
  }

  return {
    statement,
    dsse,
    bundle,
    certificatePem,
    rekorOutput
  }
}
