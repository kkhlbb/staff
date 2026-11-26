import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  FEA_PLUGIN_PROTOCOL_VERSION,
  FeaPluginError,
  detectFeaSidecars,
  generateMicFromSidecar,
  type CommandRunner,
  type GenerateMicSpec,
} from '../main/fea-plugin'

const fixturePath = path.resolve(
  process.cwd(),
  'src/core/solver/test/fixtures/sample-mic-matrix.json',
)
const sampleMicJson = readFileSync(fixturePath, 'utf8')
const sampleMic = JSON.parse(sampleMicJson)

const validSpec: GenerateMicSpec = {
  partId: 'cover-plate-al6061',
  fileName: 'cover-plate-al6061-mic.json',
  material: {
    youngsModulusMpa: 68_900,
    poissonRatio: 0.33,
  },
  controlPointsMm: sampleMic.controlPointsMm,
  measurePointsMm: sampleMic.measurePointsMm,
  unitLoadN: 1.0,
  meshSizeMm: 4.0,
  solver: 'calculix',
  evidence: [
    {
      kind: 'user-attestation',
      actorId: 'engineer-1',
      at: '2026-11-26T00:00:00Z',
      sessionSeq: 1,
      sessionLabel: 'Sidecar CalculiX run',
      statement: 'Generated via external CalculiX sidecar',
      fieldPath: '/micMatrixRef',
    },
  ],
}

describe('FEA sidecar plugin protocol (detectFeaSidecars & generateMicFromSidecar)', () => {
  it('returns available: false with zero errors when ccx and gmsh are absent', async () => {
    const missingRunner: CommandRunner = vi.fn(async () => ({
      exitCode: null,
      stdout: '',
      stderr: 'spawn ENOENT',
      errorCode: 'ENOENT',
    }))

    const result = await detectFeaSidecars({ runner: missingRunner })
    expect(result.available).toBe(false)
    expect(result.solvers.ccx.installed).toBe(false)
    expect(result.solvers.gmsh.installed).toBe(false)
    expect(result.statuses).toEqual([
      expect.objectContaining({ solver: 'calculix', available: false }),
      expect.objectContaining({ solver: 'gmsh', available: false }),
    ])
    expect(missingRunner).toHaveBeenCalledTimes(2)
  })

  it('detects installed ccx and gmsh versions when mocked present', async () => {
    const presentRunner: CommandRunner = vi.fn(async (command, args) => {
      if (command === 'ccx' && args[0] === '-v') {
        return {
          exitCode: 0,
          stdout: '\nYou are using an executable made on Mon Jan 01 2026\nVersion 2.21\n',
          stderr: '',
        }
      }
      if (command === 'gmsh' && args[0] === '--version') {
        return {
          exitCode: 0,
          stdout: '4.13.1\n',
          stderr: '',
        }
      }
      return { exitCode: 1, stdout: '', stderr: 'unexpected' }
    })

    const result = await detectFeaSidecars({ runner: presentRunner })
    expect(result.available).toBe(true)
    expect(result.solvers.ccx).toEqual({
      installed: true,
      binaryPath: 'ccx',
      version: '2.21',
    })
    expect(result.solvers.gmsh).toEqual({
      installed: true,
      binaryPath: 'gmsh',
      version: '4.13.1',
    })
    expect(result.statuses).toEqual([
      { solver: 'calculix', available: true, version: '2.21' },
      { solver: 'gmsh', available: true, version: '4.13.1' },
    ])
  })

  it('handles missing binaries cleanly using the real subprocess runner', async () => {
    const result = await detectFeaSidecars({
      ccxBinary: 'cunlian-definitely-missing-ccx-binary-xyz',
      gmshBinary: 'cunlian-definitely-missing-gmsh-binary-xyz',
    })
    expect(result.available).toBe(false)
    expect(result.solvers.ccx.installed).toBe(false)
    expect(result.solvers.gmsh.installed).toBe(false)
  })

  it('generateMicFromSidecar sends protocolVersion 1 JSON stdin, validates MIC output, and computes SHA-256', async () => {
    const capturedStdin: string[] = []
    const runner: CommandRunner = vi.fn(async (_cmd, _args, opts) => {
      capturedStdin.push(opts.stdin ?? '')
      return {
        exitCode: 0,
        stdout: sampleMicJson,
        stderr: 'CalculiX completed 6 unit load steps',
      }
    })

    const result = await generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
      adapterPath: '/usr/local/bin/cunlian-ccx-adapter',
      adapterArgs: ['--quiet'],
      runner,
      attachmentId: 'mic-sidecar-1',
      blobKey: 'mic-sidecar-blob',
    })

    expect(runner).toHaveBeenCalledWith(
      '/usr/local/bin/cunlian-ccx-adapter',
      ['--quiet'],
      expect.objectContaining({ stdin: expect.any(String) }),
    )

    const envelope = JSON.parse(capturedStdin[0])
    expect(envelope.protocolVersion).toBe(FEA_PLUGIN_PROTOCOL_VERSION)
    expect(envelope.command).toBe('generate-mic')
    expect(envelope.partStepPath).toBe('/tmp/cover-plate.step')
    expect(envelope.spec.partId).toBe('cover-plate-al6061')

    const expectedSha = createHash('sha256').update(result.bytes).digest('hex')
    expect(result.sha256).toBe(expectedSha)
    expect(result.micMatrixRef).toBe('mic-sidecar-1')
    expect(result.attachment).toEqual({
      kind: 'mic-matrix',
      revisionId: 'mic-sidecar-1',
      blobKey: 'mic-sidecar-blob',
      path: 'attachments/mic-sidecar-blob.bin',
      sha256: expectedSha,
      byteSize: result.bytes.byteLength,
    })
    expect(result.record).toEqual({
      id: 'mic-sidecar-1',
      blobKey: 'mic-sidecar-blob',
      fileName: 'cover-plate-al6061-mic.json',
    })
    expect(result.evidence).toEqual(validSpec.evidence)
    expect(result.summary.controlPointCount).toBe(6)
    expect(result.summary.measurePointCount).toBe(16)
  })

  it('rejects invalid MIC matrices returned by the sidecar (dimension mismatch, NaN, partId mismatch)', async () => {
    const badMatrix = {
      ...sampleMic,
      sensitivityMatrix: sampleMic.sensitivityMatrix.slice(0, 3),
    }
    const runnerDimMismatch: CommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify(badMatrix),
      stderr: '',
    })

    await expect(
      generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
        adapterPath: '/usr/local/bin/adapter',
        runner: runnerDimMismatch,
      }),
    ).rejects.toMatchObject({ name: 'FeaPluginError', code: 'FEA_INVALID_MIC' })

    const wrongPart = { ...sampleMic, partId: 'other-part' }
    const runnerWrongPart: CommandRunner = async () => ({
      exitCode: 0,
      stdout: JSON.stringify(wrongPart),
      stderr: '',
    })

    await expect(
      generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
        adapterPath: '/usr/local/bin/adapter',
        runner: runnerWrongPart,
      }),
    ).rejects.toMatchObject({ name: 'FeaPluginError', code: 'FEA_INVALID_MIC' })

    const runnerBadJson: CommandRunner = async () => ({
      exitCode: 0,
      stdout: 'not-valid-json',
      stderr: '',
    })

    await expect(
      generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
        adapterPath: '/usr/local/bin/adapter',
        runner: runnerBadJson,
      }),
    ).rejects.toMatchObject({ name: 'FeaPluginError', code: 'FEA_INVALID_JSON' })
  })

  it('surfaces clean FeaPluginError codes for missing binary, timeout, and non-zero exit', async () => {
    const missingRunner: CommandRunner = async () => ({
      exitCode: null,
      stdout: '',
      stderr: 'spawn ENOENT',
      errorCode: 'ENOENT',
    })
    await expect(
      generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
        adapterPath: '/nonexistent/adapter',
        runner: missingRunner,
      }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof FeaPluginError && err.code === 'FEA_ADAPTER_MISSING',
    )

    const timeoutRunner: CommandRunner = async () => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    })
    await expect(
      generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
        adapterPath: '/usr/local/bin/adapter',
        timeoutMs: 100,
        runner: timeoutRunner,
      }),
    ).rejects.toMatchObject({ name: 'FeaPluginError', code: 'FEA_TIMEOUT' })

    const failRunner: CommandRunner = async () => ({
      exitCode: 2,
      stdout: '',
      stderr: 'mesh failed: degenerate element',
    })
    await expect(
      generateMicFromSidecar('/tmp/cover-plate.step', validSpec, {
        adapterPath: '/usr/local/bin/adapter',
        runner: failRunner,
      }),
    ).rejects.toMatchObject({ name: 'FeaPluginError', code: 'FEA_EXEC_FAILED' })
  })

  it('executes a real no-shell JSON stdin/stdout subprocess adapter end-to-end', async () => {
    const script = `
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => data += c);
      process.stdin.on('end', () => {
        const req = JSON.parse(data);
        const rows = req.spec.measurePointsMm.length;
        const cols = req.spec.controlPointsMm.length;
        const S = Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => Number(((r + 1) * (c + 1) * 0.001).toFixed(6)))
        );
        process.stdout.write(JSON.stringify({
          schemaVersion: 1,
          partId: req.spec.partId,
          units: 'mm',
          forceUnits: 'N',
          controlPointsMm: req.spec.controlPointsMm,
          measurePointsMm: req.spec.measurePointsMm,
          sensitivityMatrix: S,
          sourceMeta: { solverName: 'node-mock-adapter', meshNodes: 128 }
        }));
      });
    `

    const result = await generateMicFromSidecar(fixturePath, validSpec, {
      adapterPath: process.execPath,
      adapterArgs: ['-e', script],
      verifyStepFile: true,
    })

    expect(result.payload.partId).toBe('cover-plate-al6061')
    expect(result.payload.sourceMeta?.solverName).toBe('node-mock-adapter')
    expect(result.summary.measurePointCount).toBe(16)
    expect(result.summary.controlPointCount).toBe(6)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
