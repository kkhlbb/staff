import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, rm } from 'node:fs/promises'
import path from 'node:path'
import { calculateChain } from '../../../src/domain/calculate'
import { encodeProjectFile } from '../../../src/project-file/codec'
import type { ProjectSession } from '../projectService'
import type { M3LegacyChainCompatibility, M3MigrationReport } from '../../shared/project-agent/m3-lifecycle'

export function checkLegacyChain(session: ProjectSession): M3LegacyChainCompatibility {
  const { project } = session.snapshot
  const length = project.parameters.find(parameter => parameter.key === 'length')
  const link = project.dimensionLinks.find(item => item.kind === 'parameter-binding' && item.parameterId === length?.parameterId)
  const chain = project.dimensionChain
  const requirement = project.requirementRevisions.find(item => item.revisionId === project.activeRequirementRevisionId)
  const target = requirement ? { minQ: requirement.lowerQ, maxQ: requirement.upperQ } : chain.target
  if (!link || !target || !chain.terms.some(term => term.id === link.termId)) {
    return { compatible: false, summary: '缺少长度绑定或间隙限值，无法复算兼容样例。' }
  }
  const samples = [120_000, 120_400, 121_000, 120_500].map((nominalQ, index) => {
    const { minQ, maxQ } = calculateChain({ ...chain, target,
      terms: chain.terms.map(term => term.id === link.termId ? { ...term, nominalQ } : term) })
    const verdict = minQ < target.minQ || maxQ > target.maxQ ? 'fail' as const :
      minQ === target.minQ || maxQ === target.maxQ ? 'boundary_pass' as const : 'pass' as const
    return { label: '样例 ' + (index + 1), lengthMm: (nominalQ / 10_000).toFixed(2), verdict,
      detail: `[${(minQ / 10_000).toFixed(4)}, ${(maxQ / 10_000).toFixed(4)}] mm` }
  })
  return { compatible: samples.map(sample => sample.verdict).join(',') === 'pass,pass,fail,boundary_pass',
    summary: '用项目所保存的尺寸链与间隙限值复算四组长度。', samples }
}

export async function migrateLegacySpacer(session: ProjectSession, root: string, verify: () => void): Promise<M3MigrationReport | null> {
  const { snapshot, sourceProjectSchemaVersion, fingerprint } = session
  const originalFilePath = session.path
  if (!snapshot.project.parameters.some(parameter => parameter.key === 'length') ||
    !originalFilePath || !fingerprint) return null
  const encoded = await encodeProjectFile(snapshot)
  if (!encoded.ok) throw Error('INTERNAL')
  const directory = path.join(root, 'm3-migrations')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const copyHash = createHash('sha256').update(encoded.value.bytes).digest('hex')
  const migratedFilePath = path.join(directory, fingerprint + '-' + copyHash + '.cunlian')
  const temporary = migratedFilePath + '.' + randomUUID() + '.tmp'
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(encoded.value.bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    verify()
    await link(temporary, migratedFilePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    verify()
  } finally {
    await rm(temporary, { force: true })
  }
  const archive = snapshot.legacyArchive
  return {
    projectId: snapshot.project.id, sourceFormat: 'cunlian/schema-' + sourceProjectSchemaVersion,
    originalFilePreserved: true, originalFilePath, migratedFilePath,
    migratedAtLabel: new Date().toISOString(),
    unexplainedLegacyFields: archive?.records.map((record, index) => ({
      fieldPath: `legacyArchive.records[${index}]`, rawValueSummary: (JSON.stringify(record) ?? '').slice(0, 160),
      reason: '旧归档记录保留供查阅', preservedInOriginal: true as const,
    })) ?? [],
    restrictedOperations: [{ operation: '生成安装板模型和图纸', reason: '隔套项目使用既有尺寸链与隔套成果',
      workaround: '使用原隔套工作流查看和复算' }],
    legacyChainCompatibility: checkLegacyChain(session),
  }
}
