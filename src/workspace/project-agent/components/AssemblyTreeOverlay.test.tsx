// @vitest-environment jsdom
import { createRef, useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAssemblyTree,
  DEFAULT_PART_SWATCH_PALETTE,
  normalizePartDisplayColor,
  resolveGroupVisibilityState,
  resolvePartDisplayColor,
} from '../assemblyTreeModel'
import {
  IDENTITY_MATRIX_4X4,
  type AssemblyGroup,
  type AssemblyModelV1,
  type PartMesh,
  type PartRgbColorInput,
} from '../assembly3dTypes'
import { ProjectAgentM1Workbench } from '../ProjectAgentM1Workbench'
import { AssemblyTreeOverlay } from './AssemblyTreeOverlay'

function makePartMesh(
  partId: string,
  displayName: string,
  options?: {
    readonly color?: string
    readonly displayColor?: PartRgbColorInput
    readonly groupId?: string
  },
): PartMesh {
  return {
    partId,
    displayName,
    color: options?.color ?? '#64748b',
    ...(options?.displayColor !== undefined ? { displayColor: options.displayColor } : {}),
    ...(options?.groupId !== undefined ? { groupId: options.groupId } : {}),
    positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    indices: [0, 1, 2],
    faceTriangleRanges: [
      {
        partId,
        objectId: `feat-${partId}-face`,
        startTriangle: 0,
        endTriangle: 1,
        label: '主基准面',
        geometryKind: 'face',
      },
    ],
    nominalTransform: IDENTITY_MATRIX_4X4,
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
  }
}

function StatefulAssemblyTreeHarness({
  assemblyGroups,
  partMeshes,
  initialHiddenIds = [],
  useBatchCallback = true,
}: {
  readonly assemblyGroups?: readonly AssemblyGroup[]
  readonly partMeshes: readonly PartMesh[]
  readonly initialHiddenIds?: readonly string[]
  readonly useBatchCallback?: boolean
}) {
  const [hiddenPartIds, setHiddenPartIds] = useState<ReadonlySet<string>>(
    () => new Set(initialHiddenIds),
  )
  const regionRef = createRef<HTMLElement | null>()

  return (
    <AssemblyTreeOverlay
      features={[]}
      selectedObjectId={null}
      highlightedFeatureIds={new Set()}
      structureOpen={true}
      objectListRegionRef={regionRef}
      onToggleStructure={vi.fn()}
      onCloseStructure={vi.fn()}
      onSelectFeature={vi.fn()}
      showAssemblyControls={true}
      assemblyGroups={assemblyGroups}
      partMeshes={partMeshes}
      hiddenPartIds={hiddenPartIds}
      onTogglePartVisibility={(partId) => {
        setHiddenPartIds((prev) => {
          const next = new Set(prev)
          if (next.has(partId)) next.delete(partId)
          else next.add(partId)
          return next
        })
      }}
      onSetPartsVisibility={
        useBatchCallback
          ? (partIds, hidden) => {
              setHiddenPartIds((prev) => {
                const next = new Set(prev)
                for (const id of partIds) {
                  if (hidden) next.add(id)
                  else next.delete(id)
                }
                return next
              })
            }
          : undefined
      }
    />
  )
}

describe('M3X-INT-01-FE: 多层级 XCAF 装配树、防环回退、整组显隐与零件 RGB 颜色同步', () => {
  describe('纯函数：颜色规范化与多层级树构建', () => {
    it('规范化支持 #rrggbb、#rgb、rgb(...)、[r,g,b] 0–1 浮点 / 0–255 整数浮点与 {r,g,b}，非法输入回退默认配色', () => {
      expect(normalizePartDisplayColor('#D9480F')).toBe('#d9480f')
      expect(normalizePartDisplayColor('#0f8')).toBe('#00ff88')
      expect(normalizePartDisplayColor('rgb(204, 120, 92)')).toBe('#cc785c')
      expect(normalizePartDisplayColor('rgba(0.5, 0.25, 1, 0.8)')).toBe('#8040ff')
      expect(normalizePartDisplayColor([1, 0, 0])).toBe('#ff0000')
      expect(normalizePartDisplayColor([0, 0.5, 1])).toBe('#0080ff')
      expect(normalizePartDisplayColor([255, 128, 0])).toBe('#ff8000')
      expect(normalizePartDisplayColor([200.4, 100.6, 50])).toBe('#c86532')
      expect(normalizePartDisplayColor({ r: 0.2, g: 0.6, b: 0.8 })).toBe('#3399cc')
      expect(normalizePartDisplayColor([-1, 0, 0])).toBeNull()
      expect(normalizePartDisplayColor([300, 0, 0])).toBeNull()
      expect(normalizePartDisplayColor('not-a-color')).toBeNull()

      expect(resolvePartDisplayColor({ color: '' }, 0)).toBe(DEFAULT_PART_SWATCH_PALETTE[0])
      expect(resolvePartDisplayColor({ color: 'invalid' }, 2)).toBe(DEFAULT_PART_SWATCH_PALETTE[2])
      expect(
        resolvePartDisplayColor(
          { color: '#64748b', displayColor: [0.1, 0.8, 0.4] },
          0,
          '#112233',
        ),
      ).toBe('#1acc66')
      expect(resolvePartDisplayColor({ color: '#64748b' }, 0, '#112233')).toBe('#112233')
    })

    it('防御自引用、双节点/多节点循环、缺失 parentGroupId 与孤儿 part.groupId，不死循环且不丢失任何零件', () => {
      const groups: readonly AssemblyGroup[] = [
        { id: 'self', name: '自引用组', parentGroupId: 'self' },
        { id: 'cyc-a', name: '环节点 A', parentGroupId: 'cyc-b' },
        { id: 'cyc-b', name: '环节点 B', parentGroupId: 'cyc-c' },
        { id: 'cyc-c', name: '环节点 C', parentGroupId: 'cyc-a' },
        { id: 'tail', name: '入环子节点', parentGroupId: 'cyc-b' },
        { id: 'missing-parent', name: '缺失父组', parentGroupId: 'does-not-exist' },
      ]
      const parts = [
        makePartMesh('p-self', '自引用零件', { groupId: 'self' }),
        makePartMesh('p-cyc', '环内零件', { groupId: 'cyc-c' }),
        makePartMesh('p-tail', '入环零件', { groupId: 'tail' }),
        makePartMesh('p-missing', '缺失父组零件', { groupId: 'missing-parent' }),
        makePartMesh('p-orphan', '孤儿组零件', { groupId: 'ghost-group' }),
        makePartMesh('p-root', '无组零件'),
      ]

      const tree = buildAssemblyTree(parts, groups)
      expect(tree.isGrouped).toBe(true)
      expect(tree.detachedGroupIds).toEqual(
        expect.arrayContaining(['self', 'missing-parent', 'cyc-a']),
      )
      expect(tree.rootParts.map((p) => p.partId)).toEqual(['p-orphan', 'p-root'])

      // Collect all parts reachable from rootGroups + rootParts: zero parts lost
      const collectedPartIds = new Set<string>(tree.rootParts.map((p) => p.partId))
      for (const rootGroup of tree.rootGroups) {
        for (const pid of rootGroup.descendantPartIds) {
          collectedPartIds.add(pid)
        }
      }
      expect(collectedPartIds).toEqual(new Set(parts.map((p) => p.partId)))
    })

    it('assemblyGroups 为空或未提供时返回平铺模式 (isGrouped: false)', () => {
      const parts = [makePartMesh('p1', '零件 1')]
      expect(buildAssemblyTree(parts, undefined).isGrouped).toBe(false)
      expect(buildAssemblyTree(parts, []).isGrouped).toBe(false)
      expect(resolveGroupVisibilityState([], new Set())).toBe('empty')
    })
  })

  describe('AssemblyTreeOverlay 组件交互', () => {
    it('1. 多层级嵌套 assemblyGroups（3 层）渲染层级、递归零件计数、逐级展开/折叠与整组一键显隐（含部分隐藏态切换）', async () => {
      const user = userEvent.setup()
      const groups: readonly AssemblyGroup[] = [
        { id: 'grp-drive', name: '驱动模组' },
        { id: 'grp-trans', name: '传动子装配', parentGroupId: 'grp-drive' },
        { id: 'grp-gearbox', name: '齿轮箱', parentGroupId: 'grp-trans' },
        { id: 'grp-frame', name: '机架总成' },
      ]
      const parts: readonly PartMesh[] = [
        makePartMesh('p-motor', '伺服电机', { groupId: 'grp-drive', color: '#cc785c' }),
        makePartMesh('p-shaft', '传动主轴', { groupId: 'grp-trans', color: '#16a34a' }),
        makePartMesh('p-gear', '行星齿轮', { groupId: 'grp-gearbox', color: '#ea580c' }),
        makePartMesh('p-base', '底座机架', { groupId: 'grp-frame', color: '#64748b' }),
        makePartMesh('p-bolt', '散装螺栓'),
      ]

      render(<StatefulAssemblyTreeHarness assemblyGroups={groups} partMeshes={parts} />)

      const treeContainer = screen.getByRole('group', { name: '装配体零件与特征' })
      expect(treeContainer).toHaveAttribute('data-tree-mode', 'grouped')

      // 验证 3 层嵌套与递归零件计数
      expect(screen.getByTestId('assembly-group-grp-drive')).toHaveAttribute('data-group-depth', '0')
      expect(screen.getByTestId('assembly-group-grp-trans')).toHaveAttribute('data-group-depth', '1')
      expect(screen.getByTestId('assembly-group-grp-gearbox')).toHaveAttribute(
        'data-group-depth',
        '2',
      )
      expect(screen.getByTestId('toggle-group-expand-grp-drive')).toHaveTextContent('驱动模组(3)')
      expect(screen.getByTestId('toggle-group-expand-grp-trans')).toHaveTextContent('传动子装配(2)')
      expect(screen.getByTestId('toggle-group-expand-grp-gearbox')).toHaveTextContent('齿轮箱(1)')
      expect(screen.getByTestId('toggle-group-expand-grp-frame')).toHaveTextContent('机架总成(1)')
      expect(screen.getByTestId('assembly-part-p-bolt')).toBeInTheDocument()

      // 折叠中间子装配 -> 下属齿轮箱与零件隐藏；再次点击恢复展开
      const transExpandBtn = screen.getByTestId('toggle-group-expand-grp-trans')
      expect(transExpandBtn).toHaveAttribute('aria-expanded', 'true')
      await user.click(transExpandBtn)
      expect(transExpandBtn).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByTestId('assembly-group-grp-gearbox')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assembly-part-p-gear')).not.toBeInTheDocument()
      await user.click(transExpandBtn)
      expect(transExpandBtn).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('assembly-part-p-gear')).toBeInTheDocument()

      // 整组一键隐藏「驱动模组」-> 电机、传动主轴、行星齿轮全部隐藏，机架不受影响
      const driveVisBtn = screen.getByTestId('toggle-group-visibility-grp-drive')
      expect(driveVisBtn).toHaveAttribute('data-visibility-state', 'visible')
      await user.click(driveVisBtn)
      expect(driveVisBtn).toHaveAttribute('data-visibility-state', 'hidden')
      expect(screen.getByTestId('toggle-part-visibility-p-motor')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByTestId('toggle-part-visibility-p-shaft')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByTestId('toggle-part-visibility-p-gear')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByTestId('toggle-part-visibility-p-base')).toHaveAttribute(
        'aria-pressed',
        'false',
      )

      // 单独恢复显示「行星齿轮」-> 驱动模组与传动子装配呈现清晰的 partial（部分隐藏）态
      await user.click(screen.getByTestId('toggle-part-visibility-p-gear'))
      expect(driveVisBtn).toHaveAttribute('data-visibility-state', 'partial')
      expect(driveVisBtn).toHaveAttribute('aria-pressed', 'mixed')
      expect(driveVisBtn).toHaveTextContent('半')
      expect(screen.getByTestId('toggle-group-visibility-grp-trans')).toHaveAttribute(
        'data-visibility-state',
        'partial',
      )

      // 部分隐藏态下点击整组显隐按钮 -> 整组 3 个零件全部恢复显示
      await user.click(driveVisBtn)
      expect(driveVisBtn).toHaveAttribute('data-visibility-state', 'visible')
      expect(screen.getByTestId('toggle-part-visibility-p-motor')).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expect(screen.getByTestId('toggle-part-visibility-p-shaft')).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expect(screen.getByTestId('toggle-part-visibility-p-gear')).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    it('2. 循环/自引用/缺失父组与孤儿 groupId 在组件中安全渲染至根层级且不丢失零件', () => {
      const groups: readonly AssemblyGroup[] = [
        { id: 'g-self', name: '自环组', parentGroupId: 'g-self' },
        { id: 'g-a', name: '环组 A', parentGroupId: 'g-b' },
        { id: 'g-b', name: '环组 B', parentGroupId: 'g-a' },
        { id: 'g-missing', name: '断链组', parentGroupId: 'non-existent' },
      ]
      const parts: readonly PartMesh[] = [
        makePartMesh('p-1', '零件 1', { groupId: 'g-self' }),
        makePartMesh('p-2', '零件 2', { groupId: 'g-a' }),
        makePartMesh('p-3', '零件 3', { groupId: 'g-b' }),
        makePartMesh('p-4', '零件 4', { groupId: 'g-missing' }),
        makePartMesh('p-5', '孤儿零件', { groupId: 'unknown-group' }),
      ]

      render(<StatefulAssemblyTreeHarness assemblyGroups={groups} partMeshes={parts} />)

      for (const part of parts) {
        expect(screen.getByTestId(`assembly-part-${part.partId}`)).toBeInTheDocument()
      }
      expect(screen.getByTestId('assembly-group-g-self')).toHaveAttribute('data-group-depth', '0')
      expect(screen.getByTestId('assembly-group-g-missing')).toHaveAttribute(
        'data-group-depth',
        '0',
      )
      expect(screen.getByTestId('assembly-part-p-5')).toHaveAttribute('data-tree-depth', '0')
    })

    it('3. 零件 XCAF RGB 颜色准确同步到色块，无色/非法色兜底沿用默认配色', () => {
      const parts: readonly PartMesh[] = [
        makePartMesh('p-hex', '十六进制色零件', { color: '#D9480F' }),
        makePartMesh('p-unit-rgb', '浮点 RGB 零件', {
          color: '#64748b',
          displayColor: [0, 0.5, 1],
        }),
        makePartMesh('p-int-rgb', '整数 RGB 零件', {
          color: '#64748b',
          displayColor: [34, 197, 94],
        }),
        makePartMesh('p-css-rgb', 'CSS RGB 零件', {
          color: 'rgb(168, 85, 247)',
        }),
        makePartMesh('p-fallback', '无色兜底零件', { color: '' }),
      ]

      render(<StatefulAssemblyTreeHarness partMeshes={parts} />)

      expect(screen.getByTestId('part-swatch-p-hex')).toHaveAttribute('data-part-color', '#d9480f')
      expect(screen.getByTestId('part-swatch-p-hex')).toHaveStyle({
        backgroundColor: 'rgb(217, 72, 15)',
      })
      expect(screen.getByTestId('part-swatch-p-unit-rgb')).toHaveAttribute(
        'data-part-color',
        '#0080ff',
      )
      expect(screen.getByTestId('part-swatch-p-int-rgb')).toHaveAttribute(
        'data-part-color',
        '#22c55e',
      )
      expect(screen.getByTestId('part-swatch-p-css-rgb')).toHaveAttribute(
        'data-part-color',
        '#a855f7',
      )
      expect(screen.getByTestId('part-swatch-p-fallback')).toHaveAttribute(
        'data-part-color',
        DEFAULT_PART_SWATCH_PALETTE[4 % DEFAULT_PART_SWATCH_PALETTE.length],
      )
    })

    it('4. assemblyGroups 为空或未提供时 100% 保持既有平铺零件列表向后兼容', () => {
      const parts = [makePartMesh('p1', '底座'), makePartMesh('p2', '盖板')]
      const { rerender } = render(<StatefulAssemblyTreeHarness partMeshes={parts} />)

      const flatContainer = screen.getByRole('group', { name: '装配体零件与特征' })
      expect(flatContainer).toHaveAttribute('data-tree-mode', 'flat')
      expect(screen.queryByTestId(/^assembly-group-/)).not.toBeInTheDocument()
      expect(within(flatContainer).getByText('底座')).toBeInTheDocument()
      expect(within(flatContainer).getByText('盖板')).toBeInTheDocument()

      rerender(<StatefulAssemblyTreeHarness assemblyGroups={[]} partMeshes={parts} />)
      expect(screen.getByRole('group', { name: '装配体零件与特征' })).toHaveAttribute(
        'data-tree-mode',
        'flat',
      )
      expect(screen.queryByTestId(/^assembly-group-/)).not.toBeInTheDocument()
    })

    it('5. 端到端透传：ProjectAgentM1Workbench 将 AssemblyModelV1.assemblyGroups 与零件 XCAF 颜色同步到装配树与 3D 视口', async () => {
      const user = userEvent.setup()
      const assemblyModel: AssemblyModelV1 = {
        schemaVersion: 1,
        units: 'mm',
        assemblyGroups: [
          { id: 'grp-upper', name: '上模组件' },
          { id: 'grp-core', name: '核心腔体', parentGroupId: 'grp-upper' },
        ],
        parts: [
          {
            id: 'step-part-1',
            displayName: '上模盖板',
            color: '#e11d48',
            kind: 'imported-step',
            attachmentId: 'att-1',
            solidIndex: 0,
            groupId: 'grp-upper',
            nominalTransform: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1],
            ],
          },
          {
            id: 'step-part-2',
            displayName: '型腔嵌件',
            color: '#0d9488',
            kind: 'imported-step',
            attachmentId: 'att-1',
            solidIndex: 1,
            groupId: 'grp-core',
            nominalTransform: [
              [1, 0, 0, 0],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1],
            ],
          },
        ],
        features: [],
        mates: [],
        datums: [],
        gdt: [],
        measurements: [],
      }

      const initialMeshes: readonly PartMesh[] = [
        makePartMesh('step-part-1', '上模盖板', { color: '#64748b' }),
        makePartMesh('step-part-2', '型腔嵌件', { color: '#64748b' }),
      ]

      render(
        <ProjectAgentM1Workbench
          bridge={{}}
          feature3dAssemblyM1={true}
          initialShowOnboarding={false}
          initialViewMode="model"
          initialDraftRevision="draft-1"
          initialAssembly3d={assemblyModel}
          initialPartMeshes={initialMeshes}
        />,
      )

      await user.click(screen.getByTestId('toggle-structure-btn'))
      expect(screen.getByTestId('toggle-group-expand-grp-upper')).toHaveTextContent('上模组件(2)')
      expect(screen.getByTestId('toggle-group-expand-grp-core')).toHaveTextContent('核心腔体(1)')
      expect(screen.getByTestId('part-swatch-step-part-1')).toHaveAttribute(
        'data-part-color',
        '#e11d48',
      )
      expect(screen.getByTestId('part-swatch-step-part-2')).toHaveAttribute(
        'data-part-color',
        '#0d9488',
      )

      // 整组隐藏上模组件 -> 3D 视口中两个零件同时隐藏
      const svg = screen.getByTestId('m2-three-fallback-svg')
      expect(svg.querySelectorAll('[data-part-id="step-part-1"]').length).toBeGreaterThan(0)
      expect(svg.querySelectorAll('[data-part-id="step-part-2"]').length).toBeGreaterThan(0)

      await user.click(screen.getByTestId('toggle-group-visibility-grp-upper'))
      expect(svg.querySelectorAll('[data-part-id="step-part-1"]')).toHaveLength(0)
      expect(svg.querySelectorAll('[data-part-id="step-part-2"]')).toHaveLength(0)

      await user.click(screen.getByTestId('toggle-group-visibility-grp-upper'))
      expect(svg.querySelectorAll('[data-part-id="step-part-1"]').length).toBeGreaterThan(0)
      expect(svg.querySelectorAll('[data-part-id="step-part-2"]').length).toBeGreaterThan(0)
    })
  })
})
