import { parseMm } from '../../../../src/domain/units'
import { createHash } from 'node:crypto'
import { extractPdfTextPages } from '../../pdfTextExtract'
import type { M2SourceAnchor, M2RequirementItem } from '../../../shared/project-agent/m2-preview'
import { createMountingPlate, type MountingPlate } from './model.mjs'

interface Clause {
  id: string
  anchors: M2SourceAnchor[]
  correction?: { mode: 'answer' | 'correct_interpretation'; content: string }
}

export interface RequirementsSource {
  documentRef: string
  documentName: string
  sha256: string
  pageCount: number
  bytes: Uint8Array
}

export async function importRequirements(source: RequirementsSource): Promise<Clause[]> {
  if (createHash('sha256').update(source.bytes).digest('hex') !== source.sha256) throw Error('STALE_SOURCE')
  const pages = await extractPdfTextPages(source.bytes, { from: 1, to: source.pageCount })
  const clauses = new Map<string, Clause>()
  for (const { page, items } of pages) {
    const text = items.map(item => item.str).join(' ').replace(/\s+/g, ' ').replace(/Page \d+ of \d+\s*$/, '')
    for (const match of text.matchAll(/\b(MP-\d{2})\b\s+(.+?)(?=\bMP-\d{2}\b|$)/g)) {
      const [, id, excerpt] = match
      const clause = clauses.get(id) ?? { id, anchors: [] }
      clause.anchors.push({ documentRef: source.documentRef, documentName: source.documentName, page, excerpt: excerpt.trim() })
      clauses.set(id, clause)
    }
  }
  return clauses.has('MP-01') && clauses.has('MP-02') ? [...clauses.values()] : []
}

const titles: Record<string, string> = {
  'MP-01': '板件尺寸与基准', 'MP-02': '通孔与孔中心', 'MP-03': '右孔边距',
  'MP-04': '参考盖板姿态与板厚', 'MP-05': '最小间隙',
}
const number = '(\\d{1,7}(?:\\.\\d{1,4})?)'
const dimensions = new RegExp(`${number}\\s*[×x]\\s*${number}\\s*[×x]\\s*${number}\\s*mm`, 'i')
const thickness = new RegExp(`(?:thickness|板厚)\\s*[:=：]?\\s*${number}(?:\\s*±\\s*${number})?\\s*mm`, 'gi')
const centers = new RegExp(`\\(\\s*${number}\\s*,\\s*${number}\\s*\\)\\s*mm`, 'g')
const q = parseMm

export function interpret(clauses: Clause[]) {
  const model: MountingPlate = createMountingPlate()
  const texts = new Map(clauses.map(clause => [clause.id, clause.correction?.content ?? clause.anchors.map(a => a.excerpt).join(' ')]))
  const plate = dimensions.exec(texts.get('MP-01') ?? '')
  const coverClause = clauses.find(clause => clause.id === 'MP-04')
  const originalCover = coverClause?.anchors.map(anchor => anchor.excerpt).join(' ') ?? ''
  const cover = [texts.get('MP-04'), originalCover].filter(Boolean).join(' ')
  const chosen = clauses.find(clause => clause.id === 'MP-04')?.correction
  const coverAnswer = chosen ? [...chosen.content.matchAll(thickness)] : []
  const thicknesses = coverAnswer.length ? coverAnswer : [...cover.matchAll(thickness)]
  const conflict = new Set([...(plate && !coverAnswer.length ? [q(plate[3])] : []), ...thicknesses.map(match => q(match[1]))]).size > 1
  const holeClause = clauses.find(clause => clause.id === 'MP-02')
  const originalHoles = holeClause?.anchors.map(anchor => anchor.excerpt).join(' ') ?? ''
  const holeAnswer = (texts.get('MP-02') ?? '')
  const holes = holeClause?.correction && [...holeAnswer.matchAll(centers)].length === 0
    ? holeAnswer + ' ' + originalHoles : holeAnswer
  const coords = [...holes.matchAll(centers)]
  const diameterPattern = new RegExp(`[Ø⌀]${number}\\s*mm`, 'i')
  const diameter = diameterPattern.exec(holes) ?? diameterPattern.exec(originalHoles)
  const hasDatum = /(?:along X.*along Y|左下.*[XY])/i.test(texts.get('MP-01') ?? '') &&
    /(?:\(X,\s*Y\)|中心.*[XY])/i.test(holes)
  const bottom = new RegExp(`Z\\s*=\\s*${number}\\s*±\\s*${number}\\s*mm`, 'i').exec(cover)
  const edge = new RegExp(`at least\\s+${number}\\s*mm`, 'i').exec(texts.get('MP-03') ?? '')
  const gap = new RegExp(`at least\\s+${number}\\s*mm`, 'i').exec(texts.get('MP-05') ?? '')
  const tolerances = [...(texts.get('MP-03') ?? '').matchAll(new RegExp(`tolerance:\\s*±\\s*${number}\\s*mm`, 'gi'))]

  if (plate) {
    model.plate.lengthQ = q(plate[1])
    model.plate.widthQ = q(plate[2])
    model.plate.thickness.nominalQ = q(plate[3])
  }
  if (!conflict && thicknesses[0]) {
    model.plate.thickness.nominalQ = q(thicknesses[0][1])
    if (thicknesses[0][2]) model.plate.thickness.toleranceQ = q(thicknesses[0][2])
  }
  if (hasDatum && coords.length === 2 && diameter) {
    for (const hole of model.holes) model.bindings[hole.role] = hole.id
    model.holes.forEach((hole, i) => {
      hole.x.nominalQ = q(coords[i][1])
      hole.y.nominalQ = q(coords[i][2])
      hole.diameter.nominalQ = q(diameter[1])
    })
  } else {
    model.holes = []
    delete model.bindings['hole.left.axis']
    delete model.bindings['hole.right.axis']
  }
  if (tolerances.length === 3) {
    const right = model.holes.find(hole => hole.role === 'hole.right.axis')
    if (right) [right.x.toleranceQ, right.y.toleranceQ, right.diameter.toleranceQ] = tolerances.map(match => q(match[1]))
  }
  if (bottom) [model.cover.bottom.nominalQ, model.cover.bottom.toleranceQ] = bottom.slice(1).map(q)
  if (edge) model.constraints.rightMargin.minQ = q(edge[1])
  if (gap) model.constraints.gap.minQ = q(gap[1])

  const interpretations: Record<string, string> = {
    'MP-01': plate ? `板件 ${plate[1]} × ${plate[2]} × ${plate[3]} mm，采用局部 XYZ 坐标。` : '等待板件尺寸和基准。',
    'MP-02': diameter && coords.length === 2 ? `两处 Ø${diameter[1]} mm 通孔，中心分别为 ${coords.map(c => `(${c[1]}, ${c[2]})`).join('、')} mm。` : '等待通孔尺寸及中心坐标。',
    'MP-03': edge ? `在允许偏差内，右孔到右端面的最小边距为 ${edge[1]} mm。` : '等待右孔边距阈值。',
    'MP-04': bottom ? `盖板底面 Z = ${bottom[1]} ± ${bottom[2]} mm。` : '等待参考盖板位置。',
    'MP-05': gap ? `板件和盖板间隙至少为 ${gap[1]} mm。` : '等待间隙阈值。',
  }
  const requirements = clauses.map((clause): M2RequirementItem => {
    const { id, anchors, correction } = clause
    const text = texts.get(id)!
    const unsupported = !Object.hasOwn(titles, id) || /(?:geometric tolerance|true position|flatness|perpendicularity|形位|平面度|垂直度)/i.test(text + ' ' + anchors.map(anchor => anchor.excerpt).join(' '))
    const contradiction = id === 'MP-04' && conflict
    const missing = (id === 'MP-01' && (!plate || !/(?:along X.*along Y|左下.*[XY])/i.test(text))) || (id === 'MP-02' && (!hasDatum || coords.length !== 2 || !diameter)) ||
      (id === 'MP-03' && (!edge || tolerances.length !== 3)) || (id === 'MP-04' && (!bottom || !thicknesses.length)) ||
      (id === 'MP-05' && !gap)
    return {
      requirementId: id, title: titles[id] ?? id, required: true, anchor: anchors[0],
      interpretation: correction?.content ?? interpretations[id] ?? '当前求解器无法解释此条款',
      status: unsupported ? 'uncovered' : contradiction ? 'conflict' : missing ? 'needsClarification' : 'confirmed',
      ...(contradiction || missing ? {
        clarificationReason: contradiction ? 'conflict' : 'missing',
        clarificationPrompt: contradiction ? '请确认唯一板厚及其公差。' : '请补齐条款尺寸、公差或孔中心坐标基准。',
      } : {}),
      linkedFeatureIds: [], linkedAnnotationIds: [],
    }
  })
  return { model, requirements }
}
