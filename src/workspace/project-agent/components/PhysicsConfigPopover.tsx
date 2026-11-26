import { useMemo, useState, type ChangeEvent } from 'react'
import type {
  AssemblyFeatureSelectionItem,
  AssemblyPhysicsSpec,
  CompliantModelSpec,
  MaterialSpec,
  MicMatrixPayloadV1,
} from '../assembly3dTypes'
import {
  ENGINEERING_MATERIAL_PRESETS,
  findMaterialPreset,
  validateMicMatrixJson,
} from '../physics3dMath'

export interface PhysicsConfigPopoverProps {
  readonly selectedItems: readonly AssemblyFeatureSelectionItem[]
  readonly initialClampMode?: boolean
  readonly currentPhysics?: AssemblyPhysicsSpec
  readonly onSavePhysics: (params: {
    readonly partId: string
    readonly partName: string
    readonly material: MaterialSpec
    readonly models: readonly CompliantModelSpec[]
  }) => void
  readonly onImportMicMatrix?: (params: {
    readonly fileName: string
    readonly payload: MicMatrixPayloadV1
  }) => Promise<void> | void
  readonly onClose: () => void
}

/**
 * Lightweight on-demand compliant physics configuration popover anchored to the
 * bottom contextual pill (3-step minimal UX invariant: zero top-bar CAE menus).
 * - 9 engineering material presets (auto-filling E, ν, α with custom numeric override)
 * - 4 compliant physics model checkboxes + 2-4 core inputs
 * - Advanced MIC influence matrix (.json) import with strict MicMatrixPayloadV1 validation
 */
export function PhysicsConfigPopover({
  selectedItems,
  initialClampMode = false,
  currentPhysics,
  onSavePhysics,
  onImportMicMatrix,
  onClose,
}: PhysicsConfigPopoverProps) {
  const primary = selectedItems[0]
  const partId = primary?.partId ?? 'part-bracket'
  const partName = primary?.partName ?? '零件'
  const primaryFeatureId = primary?.featureId ?? `${partId}-face-0`

  const existingMat = currentPhysics?.materials?.find((m) => m.partId === partId)
  const existingPartModels = useMemo(
    () =>
      (currentPhysics?.compliantModels ?? []).filter((m) =>
        m.kind === 'thermal-expansion' ? m.partIds.includes(partId) : m.partId === partId,
      ),
    [currentPhysics?.compliantModels, partId],
  )

  const defaultPreset = findMaterialPreset(existingMat?.presetId ?? 'al-6061') ?? ENGINEERING_MATERIAL_PRESETS[2]

  const [presetId, setPresetId] = useState<string>(existingMat?.presetId ?? defaultPreset.presetId)
  const [youngsModulusMpa, setYoungsModulusMpa] = useState<string>(
    String(existingMat?.youngsModulusMpa ?? defaultPreset.youngsModulusMpa),
  )
  const [poissonRatio, setPoissonRatio] = useState<string>(
    String(existingMat?.poissonRatio ?? defaultPreset.poissonRatio),
  )
  const [alphaPpmPerK, setAlphaPpmPerK] = useState<string>(
    String(
      Math.round(
        ((existingMat?.thermalExpansionPerK ?? defaultPreset.thermalExpansionPerK) * 1e6) * 100,
      ) / 100,
    ),
  )
  const [deltaTempK, setDeltaTempK] = useState<string>(
    String(existingMat?.deltaTemperatureK ?? defaultPreset.defaultDeltaTemperatureK),
  )

  const existingAxial = existingPartModels.find((m) => m.kind === 'axial-compression')
  const existingPlate = existingPartModels.find((m) => m.kind === 'plate-clamping')
  const existingBeam = existingPartModels.find((m) => m.kind === 'beam-bending')
  const existingThermal = existingPartModels.find((m) => m.kind === 'thermal-expansion')

  const [enableAxial, setEnableAxial] = useState<boolean>(Boolean(existingAxial))
  const [enablePlate, setEnablePlate] = useState<boolean>(
    initialClampMode || Boolean(existingPlate) || existingPartModels.length === 0,
  )
  const [enableBeam, setEnableBeam] = useState<boolean>(Boolean(existingBeam))
  const [enableThermal, setEnableThermal] = useState<boolean>(Boolean(existingThermal))

  // Axial compression params
  const [preloadN, setPreloadN] = useState<string>(String(existingAxial?.preloadN ?? 600))
  const [stiffnessNPerMm, setStiffnessNPerMm] = useState<string>(
    String(existingAxial?.stiffnessNPerMm ?? 4200),
  )
  const [springbackRatio, setSpringbackRatio] = useState<string>(
    String(existingAxial?.springbackRatio ?? 0.1),
  )

  // Plate clamping params
  const [plateThicknessMm, setPlateThicknessMm] = useState<string>(
    String(existingPlate ? existingPlate.thicknessQ / 10000 : 1.5),
  )
  const [initialWarpMm, setInitialWarpMm] = useState<string>(
    String(existingPlate ? existingPlate.initialWarpPeakQ / 10000 : 0.28),
  )
  const [clampForceN, setClampForceN] = useState<string>(
    String(existingPlate?.clampForceN ?? 450),
  )

  // Beam bending params
  const [beamSupport, setBeamSupport] = useState<'cantilever' | 'simply-supported'>(
    existingBeam?.supportKind ?? 'cantilever',
  )
  const [beamSpanMm, setBeamSpanMm] = useState<string>(String(existingBeam?.spanMm ?? 45))
  const [beamInertiaMm4, setBeamInertiaMm4] = useState<string>(
    String(existingBeam?.momentOfInertiaMm4 ?? 120),
  )
  const [beamForceN, setBeamForceN] = useState<string>(String(existingBeam?.forceN ?? 80))

  // Thermal params
  const [thermalDeltaK, setThermalDeltaK] = useState<string>(
    String(existingThermal?.deltaTemperatureK ?? 65),
  )
  const [bimetallicCoupling, setBimetallicCoupling] = useState<boolean>(
    existingThermal?.bimetallicCoupling ?? true,
  )

  // MIC matrix advanced import state
  const [showMicSection, setShowMicSection] = useState(false)
  const [micFileName, setMicFileName] = useState<string>('mic-matrix.json')
  const [micJsonText, setMicJsonText] = useState<string>('')
  const [micImporting, setMicImporting] = useState(false)
  const [micImportStatus, setMicImportStatus] = useState<string | null>(null)

  const micValidation = useMemo(
    () => (micJsonText.trim().length > 0 ? validateMicMatrixJson(micJsonText) : null),
    [micJsonText],
  )

  const handleSelectPreset = (nextPresetId: string) => {
    setPresetId(nextPresetId)
    const preset = findMaterialPreset(nextPresetId)
    if (!preset) return
    setYoungsModulusMpa(String(preset.youngsModulusMpa))
    setPoissonRatio(String(preset.poissonRatio))
    setAlphaPpmPerK(String(Math.round(preset.thermalExpansionPerK * 1e6 * 100) / 100))
    setDeltaTempK(String(preset.defaultDeltaTemperatureK))
  }

  const handleMicFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setMicFileName(file.name)
    setMicImportStatus(null)
    if (typeof file.text === 'function') {
      void file.text().then((text) => setMicJsonText(text))
    } else if (typeof FileReader !== 'undefined') {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setMicJsonText(reader.result)
        }
      }
      reader.readAsText(file)
    }
  }

  const handleConfirmMicImport = async () => {
    if (!micValidation || !micValidation.ok || !onImportMicMatrix) return
    setMicImporting(true)
    setMicImportStatus(null)
    try {
      await onImportMicMatrix({
        fileName: micFileName || 'mic-matrix.json',
        payload: micValidation.payload,
      })
      setMicImportStatus(
        `已导入 MIC 矩阵（${micValidation.summary.solverName} · ${micValidation.summary.measurePointCount}×${micValidation.summary.controlPointCount}）。`,
      )
    } finally {
      setMicImporting(false)
    }
  }

  const parsedE = Number(youngsModulusMpa)
  const parsedNu = Number(poissonRatio)
  const parsedAlpha = Number(alphaPpmPerK) * 1e-6
  const parsedDT = Number(deltaTempK)
  const materialValid =
    Number.isFinite(parsedE) &&
    parsedE > 0 &&
    Number.isFinite(parsedNu) &&
    parsedNu > -1 &&
    parsedNu < 0.5 &&
    Number.isFinite(parsedAlpha) &&
    Number.isFinite(parsedDT)

  const handleSave = () => {
    if (!materialValid) return
    const preset = findMaterialPreset(presetId)
    const material: MaterialSpec = {
      partId,
      presetId: preset?.presetId,
      name: preset?.name ?? '自定义材料',
      youngsModulusMpa: parsedE,
      poissonRatio: parsedNu,
      thermalExpansionPerK: parsedAlpha,
      deltaTemperatureK: parsedDT,
      ...(preset ? { yieldStrengthMpa: preset.yieldStrengthMpa } : {}),
    }

    const models: CompliantModelSpec[] = []
    if (enableAxial) {
      const pN = Math.max(0, Number(preloadN) || 0)
      const kVal = Math.max(1, Number(stiffnessNPerMm) || 4200)
      const sb = Math.max(0, Math.min(1, Number(springbackRatio) || 0))
      models.push({
        id: existingAxial?.id ?? `model-axial-${partId}`,
        kind: 'axial-compression',
        partId,
        featureId: primaryFeatureId,
        preloadN: pN,
        preloadTolN: Math.round(pN * 0.15 * 10) / 10,
        stiffnessNPerMm: kVal,
        springbackRatio: sb,
      })
    }
    if (enablePlate) {
      const holeIds = selectedItems
        .filter((item) => item.geometryKind === 'cylindrical-hole-axis')
        .map((item) => item.featureId)
      const clampFeatureIds =
        holeIds.length >= 2
          ? holeIds.slice(0, 16)
          : existingPlate?.clampFeatureIds ?? [
              holeIds[0] ?? `${partId}-clamp-1`,
              `${partId}-clamp-2`,
            ]
      const faceItem = selectedItems.find((item) => item.geometryKind === 'face')
      models.push({
        id: existingPlate?.id ?? `model-plate-${partId}`,
        kind: 'plate-clamping',
        partId,
        surfaceFeatureId: faceItem?.featureId ?? existingPlate?.surfaceFeatureId ?? primaryFeatureId,
        thicknessQ: Math.max(100, Math.round((Number(plateThicknessMm) || 1.5) * 10000)),
        initialWarpPeakQ: Math.round((Number(initialWarpMm) || 0.28) * 10000),
        warpTolQ: 500,
        clampFeatureIds,
        clampForceN: Math.max(1, Number(clampForceN) || 450),
        boundaryKind: 'clamped',
      })
    }
    if (enableBeam) {
      models.push({
        id: existingBeam?.id ?? `model-beam-${partId}`,
        kind: 'beam-bending',
        partId,
        loadFeatureId: primaryFeatureId,
        supportKind: beamSupport,
        spanMm: Math.max(1, Number(beamSpanMm) || 45),
        momentOfInertiaMm4: Math.max(0.1, Number(beamInertiaMm4) || 120),
        forceN: Number(beamForceN) || 80,
        forceTolN: Math.round(Math.abs(Number(beamForceN) || 80) * 0.1 * 10) / 10,
      })
    }
    if (enableThermal) {
      models.push({
        id: existingThermal?.id ?? `model-thermal-${partId}`,
        kind: 'thermal-expansion',
        partIds: [partId],
        deltaTemperatureK: Number(thermalDeltaK) || 65,
        deltaTempTolK: 5,
        bimetallicCoupling,
      })
    }

    onSavePhysics({ partId, partName, material, models })
    onClose()
  }

  return (
    <div
      className="pa-gdt-config-popover pa-physics-config-popover"
      role="dialog"
      aria-label="柔性形变轻配置浮层"
      data-testid="physics-config-popover"
    >
      <div className="pa-header">
        <strong>
          {initialClampMode ? '锁紧点 & 翘曲拉平' : '柔性形变配置'} · {partName}
        </strong>
        <button
          type="button"
          className="pa-icon-btn"
          aria-label="关闭柔性配置浮层"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* 1. Material Preset Selector (9 engineering presets) */}
      <div className="pa-gdt-field-group">
        <label className="pa-gdt-field-label" htmlFor="pa-physics-material-select">
          工程材料预设（9 种 · 自动填充 E / ν / α）
        </label>
        <select
          id="pa-physics-material-select"
          data-testid="physics-material-preset"
          className="pa-physics-select"
          value={presetId}
          onChange={(event) => handleSelectPreset(event.target.value)}
        >
          {ENGINEERING_MATERIAL_PRESETS.map((preset) => (
            <option key={preset.presetId} value={preset.presetId}>
              {preset.name}（E={preset.youngsModulusMpa.toLocaleString('en-US')} MPa）
            </option>
          ))}
        </select>

        <div className="pa-physics-param-grid">
          <label className="pa-gdt-field-inline">
            <span>E (MPa)</span>
            <input
              type="number"
              data-testid="physics-youngs-modulus"
              aria-label="弹性模量 E (MPa)"
              className="pa-gdt-inline-num"
              min={1}
              step={100}
              value={youngsModulusMpa}
              onChange={(e) => setYoungsModulusMpa(e.target.value)}
            />
          </label>
          <label className="pa-gdt-field-inline">
            <span>ν</span>
            <input
              type="number"
              data-testid="physics-poisson-ratio"
              aria-label="泊松比 ν"
              className="pa-gdt-inline-num"
              min={0.01}
              max={0.49}
              step={0.01}
              value={poissonRatio}
              onChange={(e) => setPoissonRatio(e.target.value)}
            />
          </label>
          <label className="pa-gdt-field-inline">
            <span>α (10⁻⁶/K)</span>
            <input
              type="number"
              data-testid="physics-thermal-alpha"
              aria-label="热膨胀系数 α"
              className="pa-gdt-inline-num"
              step={0.5}
              value={alphaPpmPerK}
              onChange={(e) => setAlphaPpmPerK(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* 2. Four Compliant Physics Models */}
      <div className="pa-gdt-field-group">
        <span className="pa-gdt-field-label">物理形变模型（按需勾选）</span>
        <div className="pa-physics-model-list">
          <label className="pa-toggle">
            <input
              type="checkbox"
              data-testid="physics-model-axial-compression"
              checked={enableAxial}
              onChange={(e) => setEnableAxial(e.target.checked)}
            />
            轴向压缩（预紧 / 垫片回弹）
          </label>
          {enableAxial ? (
            <div className="pa-physics-param-grid">
              <label className="pa-gdt-field-inline">
                <span>预紧力 (N)</span>
                <input
                  type="number"
                  data-testid="physics-axial-preload"
                  className="pa-gdt-inline-num"
                  value={preloadN}
                  onChange={(e) => setPreloadN(e.target.value)}
                />
              </label>
              <label className="pa-gdt-field-inline">
                <span>刚度 (N/mm)</span>
                <input
                  type="number"
                  data-testid="physics-axial-stiffness"
                  className="pa-gdt-inline-num"
                  value={stiffnessNPerMm}
                  onChange={(e) => setStiffnessNPerMm(e.target.value)}
                />
              </label>
              <label className="pa-gdt-field-inline">
                <span>回弹比</span>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  className="pa-gdt-inline-num"
                  value={springbackRatio}
                  onChange={(e) => setSpringbackRatio(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <label className="pa-toggle">
            <input
              type="checkbox"
              data-testid="physics-model-plate-clamping"
              checked={enablePlate}
              onChange={(e) => setEnablePlate(e.target.checked)}
            />
            薄板锁紧翘曲（多点螺栓拉平）
          </label>
          {enablePlate ? (
            <div className="pa-physics-param-grid">
              <label className="pa-gdt-field-inline">
                <span>板厚 (mm)</span>
                <input
                  type="number"
                  data-testid="physics-plate-thickness"
                  step={0.1}
                  className="pa-gdt-inline-num"
                  value={plateThicknessMm}
                  onChange={(e) => setPlateThicknessMm(e.target.value)}
                />
              </label>
              <label className="pa-gdt-field-inline">
                <span>初始翘曲 (mm)</span>
                <input
                  type="number"
                  data-testid="physics-plate-warp"
                  step={0.02}
                  className="pa-gdt-inline-num"
                  value={initialWarpMm}
                  onChange={(e) => setInitialWarpMm(e.target.value)}
                />
              </label>
              <label className="pa-gdt-field-inline">
                <span>锁紧力 (N)</span>
                <input
                  type="number"
                  data-testid="physics-plate-clamp-force"
                  className="pa-gdt-inline-num"
                  value={clampForceN}
                  onChange={(e) => setClampForceN(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <label className="pa-toggle">
            <input
              type="checkbox"
              data-testid="physics-model-beam-bending"
              checked={enableBeam}
              onChange={(e) => setEnableBeam(e.target.checked)}
            />
            梁弯曲（悬臂 / 简支挠度）
          </label>
          {enableBeam ? (
            <div className="pa-physics-param-grid">
              <label className="pa-gdt-field-inline">
                <span>支承</span>
                <select
                  data-testid="physics-beam-support"
                  className="pa-physics-select"
                  value={beamSupport}
                  onChange={(e) =>
                    setBeamSupport(e.target.value as 'cantilever' | 'simply-supported')
                  }
                >
                  <option value="cantilever">悬臂</option>
                  <option value="simply-supported">简支</option>
                </select>
              </label>
              <label className="pa-gdt-field-inline">
                <span>跨距 (mm)</span>
                <input
                  type="number"
                  data-testid="physics-beam-span"
                  className="pa-gdt-inline-num"
                  value={beamSpanMm}
                  onChange={(e) => setBeamSpanMm(e.target.value)}
                />
              </label>
              <label className="pa-gdt-field-inline">
                <span>截面惯性矩</span>
                <input
                  type="number"
                  className="pa-gdt-inline-num"
                  value={beamInertiaMm4}
                  onChange={(e) => setBeamInertiaMm4(e.target.value)}
                />
              </label>
              <label className="pa-gdt-field-inline">
                <span>载荷 (N)</span>
                <input
                  type="number"
                  data-testid="physics-beam-force"
                  className="pa-gdt-inline-num"
                  value={beamForceN}
                  onChange={(e) => setBeamForceN(e.target.value)}
                />
              </label>
            </div>
          ) : null}

          <label className="pa-toggle">
            <input
              type="checkbox"
              data-testid="physics-model-thermal-expansion"
              checked={enableThermal}
              onChange={(e) => setEnableThermal(e.target.checked)}
            />
            热膨胀（温差 &amp; 双金属弯曲）
          </label>
          {enableThermal ? (
            <div className="pa-physics-param-grid">
              <label className="pa-gdt-field-inline">
                <span>温差 ΔT (K)</span>
                <input
                  type="number"
                  data-testid="physics-thermal-delta"
                  className="pa-gdt-inline-num"
                  value={thermalDeltaK}
                  onChange={(e) => setThermalDeltaK(e.target.value)}
                />
              </label>
              <label className="pa-toggle">
                <input
                  type="checkbox"
                  checked={bimetallicCoupling}
                  onChange={(e) => setBimetallicCoupling(e.target.checked)}
                />
                异种材料双金属弯曲
              </label>
            </div>
          ) : null}
        </div>
      </div>

      {/* 3. Advanced MIC Matrix Import (.json) */}
      <div className="pa-gdt-field-group pa-physics-mic-section">
        <button
          type="button"
          data-testid="physics-mic-import-toggle"
          className="pa-btn pa-btn-ghost pa-btn-sm"
          aria-expanded={showMicSection}
          onClick={() => setShowMicSection((prev) => !prev)}
        >
          {showMicSection ? '▾ ' : '▸ '}导入 MIC 影响系数矩阵 (.json)
        </button>

        {showMicSection ? (
          <div className="pa-physics-mic-panel" data-testid="physics-mic-panel">
            <label className="pa-gdt-field-inline">
              <span>选择 JSON 文件</span>
              <input
                type="file"
                accept=".json,application/json"
                data-testid="mic-file-input"
                onChange={handleMicFileChange}
              />
            </label>
            <textarea
              data-testid="mic-json-textarea"
              aria-label="MIC 矩阵 JSON 内容"
              className="pa-physics-mic-textarea pa-mono"
              rows={3}
              placeholder='粘贴 MicMatrixPayloadV1 JSON（含 schemaVersion: 1, controlPointsMm, measurePointsMm, sensitivityMatrix）'
              value={micJsonText}
              onChange={(e) => {
                setMicJsonText(e.target.value)
                setMicImportStatus(null)
              }}
            />

            {micValidation && !micValidation.ok ? (
              <div
                className="pa-danger-box pa-gdt-validation-box"
                role="alert"
                data-testid="mic-validation-errors"
              >
                {micValidation.errors.map((err, idx) => (
                  <div key={idx}>{err}</div>
                ))}
              </div>
            ) : null}

            {micValidation && micValidation.ok ? (
              <div className="pa-pass-box pa-physics-mic-summary" data-testid="mic-summary-card">
                <strong>MIC 矩阵校验通过</strong>
                <div className="pa-mono">
                  求解器：{micValidation.summary.solverName}
                  {micValidation.summary.meshNodes !== null
                    ? ` · 节点 ${micValidation.summary.meshNodes.toLocaleString('en-US')}`
                    : ''}
                </div>
                <div className="pa-mono">
                  维度：{micValidation.summary.measurePointCount} 观测点 ×{' '}
                  {micValidation.summary.controlPointCount} 控制载荷自由度
                </div>
                <button
                  type="button"
                  data-testid="mic-import-confirm-btn"
                  className="pa-btn pa-btn-primary pa-btn-sm"
                  disabled={micImporting || !onImportMicMatrix}
                  onClick={() => void handleConfirmMicImport()}
                >
                  {micImporting ? '导入中…' : '确认导入 MIC 矩阵'}
                </button>
              </div>
            ) : null}

            {micImportStatus ? (
              <div className="pa-muted" role="status" data-testid="mic-import-status">
                {micImportStatus}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {!materialValid ? (
        <div className="pa-danger-box" role="alert">
          请输入有效的材料参数（E &gt; 0，-1 &lt; ν &lt; 0.5）。
        </div>
      ) : null}

      <div className="pa-gdt-inline-footer">
        <button type="button" className="pa-btn pa-btn-ghost pa-btn-sm" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          data-testid="physics-config-save-btn"
          className="pa-btn pa-btn-primary pa-btn-sm"
          disabled={!materialValid}
          onClick={handleSave}
        >
          保存柔性配置
        </button>
      </div>
    </div>
  )
}
