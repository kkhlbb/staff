/**
 * D 证据记录（真实执行，不是手写示例）：
 * - 在临时目录里对一份 schema6 `.cunlian` 做 12→14 参数确认；
 * - 把保存前后文件复制到 docs/evidence/V3-D/commit/，写 SHA-256 与摘要；
 * - 用两版权威 DrawingData 的 renderDrawingSvg 输出生成并排 HTML，供截图。
 *
 * 这个文件也是回归：任何一步失败都会让 desktop 测试套件变红。
 */
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import type {
  ChangeApplyValue,
  ChangeCompareValueResponse,
  ChangeDraftValue,
  ChangePreviewValue,
} from '../shared/contracts'
import { createHarness } from './helpers/a04'
import { ChangeService } from '../main/changeService'
import { registerChangeChannels } from '../main/changeChannels'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { decodeProjectFile } from '../../src/project-file/codec'
import { renderDrawingSvg } from '../../src/drawing/renderDrawingSvg'

const EVIDENCE = fileURLToPath(new URL('../../docs/evidence/V3-D/', import.meta.url))

async function hash(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('D 证据记录：12→14 确认前后文件与双图', () => {
  it('记录 before/after .cunlian 指纹与双图 HTML', async () => {
    await fsp.mkdir(path.join(EVIDENCE, 'commit'), { recursive: true })
    const harness = await createHarness()
    try {
      const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true, material: '' })
      const filePath = await harness.writeSample(snapshot, 'spacer-evidence')
      const opened = await harness.projectService.openFile(filePath)
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      const sessionId = opened.value.sessionId
      await harness.controller.attach(1, sessionId)

      let counter = 0
      const changeService = new ChangeService({
        projectService: harness.projectService,
        recovery: harness.recovery,
        controller: harness.controller,
        now: () => new Date('2026-11-09T12:00:00.000Z'),
        newId: () => `evidence-${(counter += 1)}`,
        pickSaveTarget: async () => filePath,
      })
      registerChangeChannels(harness.ipc, {
        guard: harness.guard,
        controller: harness.controller,
        changeService,
      })

      const beforeBytes = new Uint8Array(await fsp.readFile(filePath))
      const beforeHash = await hash(beforeBytes)

      const staged = await harness.invoke<ChangeDraftValue>(IPC_CHANNELS.changeStage, {
        sessionId,
        baseEditSeq: 0,
        inputs: { innerDiameter: '20.00', outerDiameter: '32.00', length: '14.00' },
        reason: '证据记录：隔套 12→14',
      })
      expect(staged.ok).toBe(true)
      if (!staged.ok) return
      const preview = await harness.invoke<ChangePreviewValue>(IPC_CHANNELS.changePreview, {
        sessionId,
        baseToken: staged.value.baseToken,
        draftToken: staged.value.draftToken,
      })
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(preview.value.result.minQ).toBe(-18500)
      expect(preview.value.result.maxQ).toBe(-17500)

      const applied = await harness.invoke<ChangeApplyValue>(IPC_CHANNELS.changeApply, {
        sessionId,
        baseToken: staged.value.baseToken,
        draftToken: staged.value.draftToken,
        previewId: preview.value.previewId,
        previewToken: preview.value.previewToken,
        requestId: 'evidence-request',
        reason: '证据记录：隔套 12→14',
      })
      expect(applied.ok).toBe(true)
      if (!applied.ok) return

      const afterBytes = new Uint8Array(await fsp.readFile(filePath))
      const afterHash = await hash(afterBytes)
      expect(afterHash).not.toBe(beforeHash)
      await fsp.writeFile(path.join(EVIDENCE, 'commit', 'before.cunlian'), beforeBytes)
      await fsp.writeFile(path.join(EVIDENCE, 'commit', 'after.cunlian'), afterBytes)

      const decoded = await decodeProjectFile(afterBytes)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      const parameters = decoded.value.snapshot.project.parameters.map((item) => ({
        parameterId: item.parameterId,
        valueQ: item.valueQ,
        parameterRevision: item.parameterRevision,
      }))
      const lengthTerm = decoded.value.snapshot.project.dimensionChain.terms.find((term) => term.id === 't-s')!
      const revision = decoded.value.snapshot.fileRevisions.find(
        (item) => item.revisionId === applied.value.revisionId,
      )!
      const summary = {
        beforeSha256: beforeHash,
        afterSha256: afterHash,
        beforeBytes: beforeBytes.byteLength,
        afterBytes: afterBytes.byteLength,
        revisionId: applied.value.revisionId,
        parentId: revision.parentId,
        currentRevisionId: decoded.value.snapshot.project.currentRevisionId,
        parameters,
        spacerNominalQ: lengthTerm.nominalQ,
        spacerTermRevision: lengthTerm.termRevision,
        drawingFingerprint: decoded.value.snapshot.project.drawings[0]!.dataFingerprint,
        drawingTemplateVersion: decoded.value.snapshot.project.drawings[0]!.templateVersion,
        analysisSnapshotId: revision.evidence?.analysisSnapshotId ?? null,
        eventIds: revision.evidence?.eventIds ?? [],
        analysisSnapshots: decoded.value.snapshot.analysisSnapshots.length,
        fileRevisions: decoded.value.snapshot.fileRevisions.length,
      }
      await fsp.writeFile(
        path.join(EVIDENCE, 'commit', 'summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
      )

      // 双图：左=旧版本冻结输入重建，右=当前版本；都由权威 DrawingData 渲染。
      const compared = await harness.invoke<ChangeCompareValueResponse>(IPC_CHANNELS.changeCompare, {
        sessionId,
        leftRevisionId: 'rev-a1',
      })
      expect(compared.ok).toBe(true)
      if (!compared.ok) return
      expect(compared.value.left).not.toBeNull()
      const leftSvg = renderDrawingSvg(compared.value.left!.data)
      const rightSvg = renderDrawingSvg(compared.value.right.data)
      const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>寸链 V3-D 双图并排（真实 DrawingData）</title>
<style>
body{font:13px/1.4 -apple-system,sans-serif;margin:16px;color:#1f2937}
h1{font-size:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
figure{margin:0;border:1px solid #cbd5e1;padding:8px}
figcaption{font-weight:600;margin-bottom:6px}
svg{width:100%;height:auto;border:1px solid #e2e8f0}
table{border-collapse:collapse;margin-top:12px;font-size:12px}
td,th{border:1px solid #cbd5e1;padding:3px 8px;text-align:left}
</style></head><body>
<h1>寸链 V3-D · 12→14 双图并排（由项目内 renderDrawingSvg 渲染真实重建数据）</h1>
<div class="grid">
<figure><figcaption>旧版本 ${compared.value.left!.revisionId} · 比例 ${compared.value.left!.scale.numerator}:${compared.value.left!.scale.denominator} · 指纹 ${compared.value.left!.data.fingerprint.slice(0, 12)}…</figcaption>${leftSvg}</figure>
<figure><figcaption>新版本 ${compared.value.right.revisionId} · 比例 ${compared.value.right.scale.numerator}:${compared.value.right.scale.denominator} · 指纹 ${compared.value.right.data.fingerprint.slice(0, 12)}…</figcaption>${rightSvg}</figure>
</div>
<table><thead><tr><th>范围</th><th>字段</th><th>旧</th><th>新</th></tr></thead><tbody>
${compared.value.diff
  .filter((row) => ['parameter', 'annotation', 'version'].includes(row.scope))
  .map((row) => `<tr><td>${row.scope}</td><td>${row.field}（${row.id}）</td><td>${row.before ?? ''}</td><td>${row.after ?? ''}</td></tr>`)
  .join('\n')}
</tbody></table>
</body></html>
`
      await fsp.writeFile(path.join(EVIDENCE, 'drawing-compare.html'), html)
      await fsp.writeFile(
        path.join(EVIDENCE, 'commit', 'compare-diff.json'),
        `${JSON.stringify(compared.value.diff, null, 2)}\n`,
      )
    } finally {
      await harness.dispose()
    }
  })
})
