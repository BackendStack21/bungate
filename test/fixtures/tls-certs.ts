/**
 * Runtime TLS certificate generation for tests.
 *
 * Avoids committing private keys to the repository while keeping TLS tests
 * self-contained and runnable in CI without external tools.
 */

import * as forge from 'node-forge'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface TestTLSCert {
  cert: string
  key: string
  certPath: string
  keyPath: string
}

let cached: TestTLSCert | null = null

/**
 * Generates (or returns a cached) self-signed certificate/key pair.
 */
export function generateTestTLSCert(): TestTLSCert {
  if (cached) return cached

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

  const attrs = [
    { name: 'commonName', value: 'localhost' },
    { name: 'countryName', value: 'US' },
    { shortName: 'ST', value: 'Test' },
    { name: 'localityName', value: 'Test' },
    { name: 'organizationName', value: 'Bungate Tests' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ],
    },
  ])

  cert.sign(keys.privateKey, forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

  const dir = join(tmpdir(), 'bungate-test-certs')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const certPath = join(dir, 'cert.pem')
  const keyPath = join(dir, 'key.pem')

  writeFileSync(certPath, certPem)
  writeFileSync(keyPath, keyPem)

  cached = { cert: certPem, key: keyPem, certPath, keyPath }
  return cached
}
