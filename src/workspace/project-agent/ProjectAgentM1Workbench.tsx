import { useMemo, useRef, useState } from 'react'
import './ProjectAgentPanel.css'
import { resolveWorkbenchTransport, type ElectronTransport } from '../../transport/electronTransport'
import type { Transport } from '../../transport/types'
import type { ViewportSnapshotHandle } from './M2ThreeMeshViewport'
import type {
  AiGdtDraftItem,
  AiMateDraftItem,
  AiPhysicsDraftItem,
  AssemblyModelV1,
  DatumDefinition,
  GdtFeatureControl,
  PartDisplacementField,
  PartMesh,
  SimulationLoopSpec,
  WorkbenchSidebarSection,
} from './assembly3dTypes'
import type {
  M1ConnectionStatusSnapshot,
  M1ExternalActivityItem,
  M1SelectedObjectRef,
  M1TaskbookReference,
} from './m1WorkbenchBridge'
import {
  formatRevisionDisplay,
  type M2PreviewSnapshot,
  type M2ViewMode,
} from './m2WorkbenchBridge'
import { M2CenterCanvas } from './M2CenterCanvas'
import type {
  M3FormalVersionItem,
  M3MigrationReport,
  M3ReopenRestoreStatus,
  M3UncommittedDraftItem,
} from './m3WorkbenchBridge'
import {
  DEFAULT_LOCAL_PROJECTS,
  type WorkbenchChatMessage,
  type WorkbenchLocalProject,
} from './workbenchHelpers'
import { useAssembly3dM1b } from './hooks/useAssembly3dM1b'
import { usePhysicsM4f1 } from './hooks/usePhysicsM4f1'
import {
  useWorkbenchSession,
  type DesktopProjectOpenForAuthResult,
} from './hooks/useWorkbenchSession'
import { WorkbenchTopBar } from './components/WorkbenchTopBar'
import { WorkbenchStatusBanners } from './components/WorkbenchStatusBanners'
import { OnboardingWizard } from './components/OnboardingWizard'
import { CollaborationSidebar } from './components/CollaborationSidebar'

export type { WorkbenchLocalProject, WorkbenchChatMessage, DesktopProjectOpenForAuthResult }

export interface ProjectAgentM1WorkbenchProps {
  /** Optional unified M0 Transport (ElectronTransport or custom Transport). */
  readonly transport?: ElectronTransport | Transport
  /** Legacy preload bridge injection (100% backward compatible). */
  readonly bridge?: unknown
  readonly m2Bridge?: unknown
  readonly m3Bridge?: unknown
  readonly authorizationBridge?: unknown
  readonly initialProjectId?: string
  readonly initialProjectName?: string
  readonly initialBaseRevision?: string | null
  readonly initialDraftRevision?: string | null
  /** Desktop host binding metadata for launching native file selection before readonly auth when unbound. */
  readonly desktopBoundProjectId?: string | null
  readonly onRequestDesktopProjectForReadonlyAuth?: (
    requestedProjectId: string,
  ) => Promise<DesktopProjectOpenForAuthResult>
  readonly autoRequestReadonlyAuth?: boolean
  readonly onAutoReadonlyAuthConsumed?: () => void
  readonly localProjects?: readonly WorkbenchLocalProject[]
  readonly availableObjects?: readonly M1SelectedObjectRef[]
  readonly availableTaskbooks?: readonly M1TaskbookReference[]
  readonly initialConnectionSnapshot?: Partial<M1ConnectionStatusSnapshot>
  readonly initialActivities?: readonly M1ExternalActivityItem[]
  readonly initialMessages?: readonly WorkbenchChatMessage[]
  readonly initialShowOnboarding?: boolean
  readonly initialPreviewSnapshot?: Partial<M2PreviewSnapshot>
  readonly initialViewMode?: M2ViewMode
  readonly initialSidebarSection?: WorkbenchSidebarSection
  readonly initialShowCompletionView?: boolean
  readonly initialFormalVersions?: readonly M3FormalVersionItem[]
  readonly initialUncommittedDrafts?: readonly M3UncommittedDraftItem[]
  readonly initialRestoreStatus?: M3ReopenRestoreStatus | null
  readonly initialMigrationReport?: M3MigrationReport | null
  readonly forceNarrowViewport?: boolean
  readonly clipboardWriter?: (text: string) => Promise<void> | void
  readonly className?: string
  /** M1B 3D assembly feature flag & initial 3D assembly context. */
  readonly feature3dAssemblyM1?: boolean
  readonly initialAssembly3d?: AssemblyModelV1
  readonly initialPartMeshes?: readonly PartMesh[]
  readonly initialAiMateDrafts?: readonly AiMateDraftItem[]
  readonly initialAiGdtDrafts?: readonly AiGdtDraftItem[]
  readonly initialAiPhysicsDrafts?: readonly AiPhysicsDraftItem[]
  readonly initialDisplacementFields?: readonly PartDisplacementField[]
  readonly initialDatums?: readonly DatumDefinition[]
  readonly initialGdtControls?: readonly GdtFeatureControl[]
  readonly initialSimulationSpec?: SimulationLoopSpec
}

export function ProjectAgentM1Workbench({
  transport: transportProp,
  bridge: bridgeProp,
  m2Bridge: m2BridgeProp,
  m3Bridge: m3BridgeProp,
  authorizationBridge: authorizationBridgeProp,
  initialProjectId = 'proj-plate-01',
  initialProjectName = '安装板项目',
  initialBaseRevision = 'v1',
  initialDraftRevision = null,
  desktopBoundProjectId,
  onRequestDesktopProjectForReadonlyAuth,
  autoRequestReadonlyAuth = false,
  onAutoReadonlyAuthConsumed,
  localProjects = DEFAULT_LOCAL_PROJECTS,
  availableObjects: availableObjectsProp,
  availableTaskbooks: availableTaskbooksProp,
  initialConnectionSnapshot,
  initialActivities = [],
  initialMessages = [],
  initialShowOnboarding = true,
  initialPreviewSnapshot,
  initialViewMode,
  initialSidebarSection = 'conversation',
  initialShowCompletionView = false,
  initialFormalVersions,
  initialUncommittedDrafts,
  initialRestoreStatus = null,
  initialMigrationReport = null,
  forceNarrowViewport,
  clipboardWriter,
  className,
  feature3dAssemblyM1: feature3dAssemblyM1Prop,
  initialAssembly3d,
  initialPartMeshes,
  initialAiMateDrafts,
  initialAiGdtDrafts,
  initialAiPhysicsDrafts,
  initialDisplacementFields,
  initialDatums,
  initialGdtControls,
  initialSimulationSpec,
}: ProjectAgentM1WorkbenchProps) {
  const [simulationTabActive, setSimulationTabActive] = useState(
    initialSidebarSection === 'simulation',
  )
  const snapshotHandleRef = useRef<ViewportSnapshotHandle | null>(null)
  const transport = useMemo(
    () =>
      resolveWorkbenchTransport({
        transport: transportProp,
        bridge: bridgeProp,
        m2Bridge: m2BridgeProp,
        m3Bridge: m3BridgeProp,
        authorizationBridge: authorizationBridgeProp,
      }),
    [transportProp, bridgeProp, m2BridgeProp, m3BridgeProp, authorizationBridgeProp],
  )

  const session = useWorkbenchSession({
    transport, initialProjectId, initialProjectName, initialBaseRevision, initialDraftRevision,
    desktopBoundProjectId, onRequestDesktopProjectForReadonlyAuth, autoRequestReadonlyAuth,
    onAutoReadonlyAuthConsumed, availableObjectsProp, availableTaskbooksProp,
    initialConnectionSnapshot, initialActivities, initialMessages, initialShowOnboarding,
    initialPreviewSnapshot, initialViewMode,
    initialSidebarSection: initialSidebarSection === 'simulation' ? 'conversation' : initialSidebarSection,
    initialShowCompletionView, initialFormalVersions, initialUncommittedDrafts,
    initialRestoreStatus, initialMigrationReport, forceNarrowViewport, clipboardWriter,
  })

  const { viewport } = session
  const effectiveAssembly3d = session.activeTemplateContext?.assembly3d ?? initialAssembly3d
  const effectivePartMeshes = session.activeTemplateContext?.partMeshes ?? initialPartMeshes
  const effectiveSimulationSpec = session.activeTemplateContext?.simulationSpec ?? initialSimulationSpec

  const assembly3d = useAssembly3dM1b({
    transport, projectId: session.projectId, baseRevision: session.baseRevision,
    draftRevision: session.draftRevision, writerEpoch: session.writerEpoch, feature3dAssemblyM1Prop,
    initialAssembly3d: effectiveAssembly3d, initialPartMeshes: effectivePartMeshes,
    initialAiMateDrafts, initialAiGdtDrafts, initialDatums, initialGdtControls,
    initialSimulationSpec: effectiveSimulationSpec,
    selectedObjectIds: viewport.selectedObjectIds, onSelectFeature: viewport.handleSelectFeature,
    onClearSelection: viewport.handleClearSelection, onUpdateCamera: viewport.updateCamera,
    onSetContextFeedback: viewport.setContextActionFeedback,
    onBringTextToChat: (promptText) => {
      setSimulationTabActive(false)
      session.setSidebarSection('conversation')
      session.setSidebarTab('builtin')
      session.setChatInput((prev) => (prev.trim().length > 0 ? `${prev}\n${promptText}` : promptText))
    },
  })

  const physics = usePhysicsM4f1({
    transport, enabled: assembly3d.feature3dAssemblyM1, projectId: session.projectId,
    baseRevision: session.baseRevision, draftRevision: session.draftRevision, writerEpoch: session.writerEpoch,
    partMeshes: assembly3d.partMeshes, baseSimulationResult: assembly3d.simulationResult,
    initialPhysics: effectiveAssembly3d?.physics, hasExplicitAssembly: Boolean(effectiveAssembly3d),
    initialAiPhysicsDrafts, initialDisplacementFields,
    onSetContextFeedback: viewport.setContextActionFeedback,
  })

  const effectiveHighlightedFeatureIds = useMemo(() => {
    if (!assembly3d.feature3dAssemblyM1) {
      return viewport.highlightedFeatureIds
    }
    const next = new Set(viewport.highlightedFeatureIds)
    if (assembly3d.hoveredFeatureId) next.add(assembly3d.hoveredFeatureId)
    for (const fid of assembly3d.goldenPulseFeatureIds) next.add(fid)
    return next
  }, [
    assembly3d.feature3dAssemblyM1,
    assembly3d.hoveredFeatureId,
    assembly3d.goldenPulseFeatureIds,
    viewport.highlightedFeatureIds,
  ])

  // Four-way sync: propagate active 3D/GD&T feature highlight to matching 2D drawing annotations
  const effectiveHighlightedAnnotationIds = useMemo(() => {
    if (!assembly3d.feature3dAssemblyM1 || assembly3d.goldenPulseFeatureIds.size === 0) {
      return viewport.highlightedAnnotationIds
    }
    const next = new Set(viewport.highlightedAnnotationIds)
    for (const ann of viewport.canvasState.annotations) {
      if (ann.linkedFeatureIds.some((fid) => assembly3d.goldenPulseFeatureIds.has(fid))) {
        next.add(ann.annotationId)
      }
    }
    if (assembly3d.fourWayTarget?.annotationId) {
      next.add(assembly3d.fourWayTarget.annotationId)
    }
    return next
  }, [
    assembly3d.feature3dAssemblyM1,
    assembly3d.goldenPulseFeatureIds,
    assembly3d.fourWayTarget,
    viewport.highlightedAnnotationIds,
    viewport.canvasState.annotations,
  ])

  const activeSidebarSection: WorkbenchSidebarSection =
    assembly3d.feature3dAssemblyM1 && simulationTabActive ? 'simulation' : session.sidebarSection

  const handleSelectSidebarSection = (nextSection: WorkbenchSidebarSection) => {
    if (nextSection === 'simulation') {
      setSimulationTabActive(true)
      return
    }
    setSimulationTabActive(false)
    session.setSidebarSection(nextSection)
  }

  const reportExportProps = useMemo(
    () => ({
      transport, projectId: session.projectId, projectName: session.projectName,
      baseRevision: session.baseRevision, draftRevision: session.draftRevision,
      checksetFingerprint: session.checkSetFingerprint, simulationResult: physics.simulationResult,
      assembly3d: effectiveAssembly3d, seed: effectiveSimulationSpec?.seed,
      captureSnapshots: () => snapshotHandleRef.current?.captureSnapshots() ?? {},
      onExportComplete: (msg: string) => session.setPreviewMessage(msg),
    }),
    [transport, session, physics.simulationResult, effectiveAssembly3d, effectiveSimulationSpec?.seed],
  )

  const rootClassName = className ? `pa-workbench ${className}` : 'pa-workbench'

  return (
    <main
      className={rootClassName}
      data-theme={session.theme}
      aria-label="寸链 M1 双入口工作台"
      onKeyDown={session.handleWorkbenchKeyDown}
    >
      <WorkbenchTopBar
        projectId={session.projectId}
        projectName={session.projectName}
        baseRevision={session.baseRevision}
        draftRevision={session.draftRevision}
        workflowStep={session.workflowStep}
        showOnboarding={session.showOnboarding}
        effectiveViewMode={viewport.effectiveViewMode}
        isNarrow={viewport.isNarrow}
        modelStatusMeta={viewport.modelStatusMeta}
        drawingStatusMeta={viewport.drawingStatusMeta}
        onChangeViewMode={viewport.handleChangeViewMode}
        connectionState={session.connectionState}
        connectionSource={session.connectionSource}
        clientName={session.clientName}
        apiModel={session.apiModel}
        skippedConnection={session.skippedConnection}
        compactConnectionLabel={session.compactConnectionLabel}
        authorizationState={session.authorizationState}
        connectionPopoverOpen={session.connectionPopoverOpen}
        readonlyAuthPending={session.readonlyAuthPending}
        takeoverPending={session.takeoverPending}
        selectedTakeoverTarget={session.selectedTakeoverTarget}
        onToggleConnectionPopover={() => {
          session.setMoreMenuOpen(false)
          session.setConnectionPopoverOpen((prev) => !prev)
        }}
        onCloseConnectionPopover={() => session.setConnectionPopoverOpen(false)}
        onRequestReadonlyAuthorization={() => {
          void session.handleRequestReadonlyAuthorization()
        }}
        onChangeSelectedTakeoverTarget={session.setSelectedTakeoverTarget}
        onTakeoverDraft={() => {
          void session.handleTakeoverDraft()
        }}
        onToggleOnboardingFromPopover={() => {
          session.setConnectionPopoverOpen(false)
          session.setShowOnboarding((prev) => !prev)
        }}
        hasSaveableResult={session.hasSaveableResult}
        showCompletionView={session.showCompletionView}
        onToggleCompletionView={() => {
          session.setCommitFeedback(null)
          session.setShowCompletionView((prev) => !prev)
        }}
        moreMenuOpen={session.moreMenuOpen}
        sidebarTab={session.sidebarTab}
        theme={session.theme}
        hasMigrationReport={session.migrationReport !== null}
        onToggleMoreMenu={() => {
          session.setConnectionPopoverOpen(false)
          session.setMoreMenuOpen((prev) => !prev)
        }}
        onCloseMoreMenu={() => session.setMoreMenuOpen(false)}
        onSwitchSidebarMode={() => {
          session.setSidebarSection('conversation')
          session.setSidebarTab((prev) => (prev === 'builtin' ? 'external' : 'builtin'))
          session.setMoreMenuOpen(false)
        }}
        onToggleTheme={() => {
          session.handleToggleTheme()
          session.setMoreMenuOpen(false)
        }}
        onOpenLocalProjectSelector={() => {
          session.setOnboardingChoice('skip-local')
          session.setShowOnboarding(true)
          session.setMoreMenuOpen(false)
        }}
        onOpenMigrationReport={() => {
          session.setMoreMenuOpen(false)
          if (session.migrationReport) session.setMigrationDrawerOpen(true)
          else { session.setSidebarSection('history'); void session.handleLoadMigrationReport() }
        }}
        reportExport={reportExportProps}
      />

      <WorkbenchStatusBanners
        externalNotifications={session.externalNotifications}
        externalOpenPendingId={session.externalOpenPendingId}
        externalOpenFeedback={session.externalOpenFeedback}
        onOpenExternalProjectResult={(item) => {
          void session.handleOpenExternalProjectResult(item)
        }}
        onDismissExternalNotification={session.handleDismissExternalNotification}
        migrationReport={session.migrationReport}
        migrationDrawerOpen={session.migrationDrawerOpen}
        onToggleMigrationDrawer={() => session.setMigrationDrawerOpen((prev) => !prev)}
        showCompletionView={session.showCompletionView}
        partName={session.partName}
        projectName={session.projectName}
        baseRevision={session.baseRevision}
        draftRevision={session.draftRevision}
        modelSlot={viewport.canvasState.model}
        drawingSlot={viewport.canvasState.drawing}
        checkSetFingerprint={session.checkSetFingerprint}
        completionReadiness={session.completionReadiness}
        activePendingConfirmation={session.activePendingConfirmation}
        effectiveInvalidatedConfirmationNotice={session.effectiveInvalidatedConfirmationNotice}
        commitPending={session.commitPending}
        commitFeedback={session.commitFeedback}
        canUndoInCompletionView={session.canUndoInCompletionView}
        undoPending={session.undoPending}
        undoFeedback={session.undoFeedback}
        onCloseCompletionView={() => session.setShowCompletionView(false)}
        onKeepDraft={() => {
          session.setPendingConfirmation(null)
          session.setShowCompletionView(false)
          session.setPreviewMessage(
            `已保留当前工作草稿（${formatRevisionDisplay(session.draftRevision)}），正式版保持 ${session.baseRevision ?? '无'}。`,
          )
        }}
        onUndoBlockedDraft={() => {
          void session.handleUndoBlockedDraft()
        }}
        onLocateCheckSource={(check) => {
          session.setSidebarSection('checks')
          viewport.handleSelectCheck(check)
        }}
        onStartOneTimeConfirm={session.handleStartOneTimeConfirm}
        onCancelOneTimeConfirm={session.handleCancelOneTimeConfirm}
        onConfirmCommitFormal={() => { void session.handleConfirmCommitFormal() }}
        reportExport={reportExportProps}
        showDisconnectBanner={session.showDisconnectBanner}
        scopeEpoch={session.scopeEpoch}
        writerEpoch={session.writerEpoch}
        reconnectButtonRef={session.reconnectButtonRef}
        takeoverPending={session.takeoverPending}
        authorizationState={session.authorizationState}
        readonlyAuthPending={session.readonlyAuthPending}
        connectionSource={session.connectionSource}
        selectedTakeoverTarget={session.selectedTakeoverTarget}
        onReconnect={() => {
          void session.handleReconnect()
        }}
        onRequestReadonlyAuthorization={() => {
          void session.handleRequestReadonlyAuthorization()
        }}
        onChangeSelectedTakeoverTarget={session.setSelectedTakeoverTarget}
        onTakeoverDraft={() => {
          void session.handleTakeoverDraft()
        }}
        onOpenOnboarding={() => session.setShowOnboarding(true)}
        readonlyAuthNotice={session.readonlyAuthNotice}
        readonlyAuthError={session.readonlyAuthError}
        takeoverNotice={session.takeoverNotice}
        takeoverError={session.takeoverError}
        discardedStaleCount={session.discardedStaleCount}
      />

      {session.showOnboarding ? (
        <OnboardingWizard
          onboardingChoice={session.onboardingChoice}
          onSelectChoice={session.setOnboardingChoice}
          onClose={() => session.setShowOnboarding(false)}
          hasLocalAgentInstallInfo={session.probe.capabilities.localAgentInstallInfo}
          hasConnectionStatus={session.probe.capabilities.connectionStatus}
          hasDetectLocalAgents={session.connUxProbe.capabilities.detectLocalAgents}
          hasModelApiTest={session.probe.capabilities.modelApiTest}
          detectingLocalAgents={session.detectingLocalAgents}
          localAgentDetectCompleted={session.localAgentDetectCompleted}
          localAgentDetectError={session.localAgentDetectError}
          sortedDetectedLocalAgents={session.sortedDetectedLocalAgents}
          registeringAgentId={session.registeringAgentId}
          registerFeedback={session.registerFeedback}
          localAgentConfig={session.localAgentConfig}
          statusChecking={session.statusChecking}
          connectionState={session.connectionState}
          clientName={session.clientName}
          authorizationState={session.authorizationState}
          writerOwner={session.writerOwner}
          draftRevision={session.draftRevision}
          readonlyAuthPending={session.readonlyAuthPending}
          takeoverPending={session.takeoverPending}
          localAgentCopyFeedback={session.localAgentCopyFeedback}
          localAgentNotice={session.localAgentNotice}
          onDetectLocalAgents={() => {
            void session.handleDetectLocalAgents()
          }}
          onRegisterLocalAgent={(agent) => {
            void session.handleRegisterLocalAgent(agent)
          }}
          onCopyLocalAgent={(text, label) => {
            void session.handleCopy(text, label, 'local-agent')
          }}
          onRefreshConnectionStatus={() => {
            void session.handleRefreshConnectionStatus()
          }}
          onRequestReadonlyAuthorization={() => {
            void session.handleRequestReadonlyAuthorization()
          }}
          onTakeoverForLocalAgent={() => {
            void session.handleTakeoverDraft('local-agent')
          }}
          onEnterWorkbenchExternal={() => {
            session.setSidebarSection('conversation')
            session.setSidebarTab('external')
            session.setShowOnboarding(false)
          }}
          apiProviderId={session.apiProviderId}
          currentProviderPreset={session.currentProviderPreset}
          apiBaseUrl={session.apiBaseUrl}
          apiKey={session.apiKey}
          apiModel={session.apiModel}
          availableApiModels={session.availableApiModels}
          manualModelInputMode={session.manualModelInputMode}
          modelListLoading={session.modelListLoading}
          effectiveModelListNotice={session.effectiveModelListNotice}
          outgoingContextSummary={session.outgoingContextSummary}
          modelApiFailure={session.modelApiFailure}
          modelApiTestResult={session.modelApiTestResult}
          builtinUnlocked={session.builtinUnlocked}
          apiTesting={session.apiTesting}
          testModelApiButtonRef={session.testModelApiButtonRef}
          onProviderChange={session.handleProviderChange}
          onChangeApiBaseUrl={(value) => {
            session.setApiBaseUrl(value)
            session.setAvailableApiModels([])
            session.setModelListNotice(null)
            session.resetModelApiUnlock()
          }}
          onChangeApiKey={(value) => {
            session.setApiKey(value)
            session.resetModelApiUnlock()
          }}
          onChangeApiModel={(value) => {
            session.setApiModel(value)
            session.resetModelApiUnlock()
          }}
          onToggleManualModelInputMode={() => session.setManualModelInputMode((prev) => !prev)}
          onRefreshModelList={() => {
            void session.fetchModelApiModels({
              baseUrl: session.apiBaseUrl,
              apiKey: session.apiKey,
              providerId: session.apiProviderId,
              explicit: true,
            })
          }}
          onTestModelApi={() => {
            void session.handleTestModelApi()
          }}
          onStartBuiltinModeling={() => {
            session.setSidebarSection('conversation')
            session.setSidebarTab('builtin')
            session.setShowOnboarding(false)
          }}
          localProjects={localProjects}
          onSkipDirectlyToWorkbench={() => {
            session.setSkippedConnection(true)
            session.setShowOnboarding(false)
          }}
          onSkipToLocalProjects={() => {
            session.setOnboardingChoice('skip-local')
            session.setSkippedConnection(true)
          }}
          onOpenLocalProject={session.handleOpenLocalProject}
        />
      ) : (
        <div className="pa-workbench-body">
          <M2CenterCanvas
            viewMode={viewport.canvasState.viewMode}
            lastSingleTab={viewport.canvasState.lastSingleTab}
            isNarrow={viewport.isNarrow}
            sidebarMode={session.sidebarTab}
            model={viewport.canvasState.model}
            drawing={viewport.canvasState.drawing}
            drawingFailure={viewport.canvasState.drawingFailure}
            checksInProgress={viewport.canvasState.checksInProgress}
            naturalCompletionSummary={viewport.naturalCompletionSummary}
            features={
              assembly3d.feature3dAssemblyM1
                ? assembly3d.assemblyFeatures
                : viewport.canvasState.features
            }
            annotations={viewport.canvasState.annotations}
            modelMesh={viewport.canvasState.modelMesh}
            drawingVector={viewport.canvasState.drawingVector}
            selectedObjectId={viewport.canvasState.selectedObjectId}
            selectedObjectIds={viewport.selectedObjectIds}
            selectedAnnotationId={viewport.canvasState.selectedAnnotationId}
            highlightedFeatureIds={effectiveHighlightedFeatureIds}
            highlightedAnnotationIds={effectiveHighlightedAnnotationIds}
            selectionInvalidated={viewport.canvasState.selectionInvalidated}
            invalidatedObjectLabel={viewport.canvasState.invalidatedObjectLabel}
            camera={viewport.canvasState.camera}
            drawingViewport={viewport.canvasState.drawingViewport}
            structureOpen={viewport.structureOpen}
            retryDrawingPending={viewport.retryDrawingPending}
            retryDrawingFeedback={viewport.retryDrawingFeedback}
            contextActionFeedback={viewport.contextActionFeedback}
            previewMessage={session.previewMessage}
            theme={session.theme}
            canvasRegionRef={session.canvasRegionRef}
            objectListRegionRef={session.objectListRegionRef}
            retryDrawingButtonRef={session.retryDrawingButtonRef}
            onToggleStructure={() => viewport.setStructureOpen((prev) => !prev)}
            onCloseStructure={() => viewport.setStructureOpen(false)}
            onSelectFeature={viewport.handleSelectFeature}
            onSelectAnnotation={viewport.handleSelectAnnotation}
            onClearSelection={
              assembly3d.feature3dAssemblyM1
                ? assembly3d.handleClearAssemblySelection
                : viewport.handleClearSelection
            }
            onBringIntoNextPrompt={session.handleBringIntoNextPrompt}
            onCopyToExternalSession={session.handleCopyToExternalSession}
            onRetryDrawing={() => {
              void viewport.handleRetryDrawing()
            }}
            onOpenCompletionView={() => {
              session.setCommitFeedback(null)
              session.setShowCompletionView(true)
            }}
            onUpdateCamera={viewport.updateCamera}
            onUpdateDrawingViewport={viewport.updateDrawingViewport}
            feature3dAssemblyM1={assembly3d.feature3dAssemblyM1}
            assemblyGroups={assembly3d.assemblyGroups}
            partMeshes={assembly3d.partMeshes}
            hiddenPartIds={assembly3d.hiddenPartIds}
            explosionFactor={viewport.explosionFactor}
            xrayMode={viewport.xrayMode}
            selectedAssemblyItems={assembly3d.selectedAssemblyItems}
            additivePickMode={assembly3d.additivePickMode}
            activeCameraPreset={assembly3d.activeCameraPreset}
            onTogglePartVisibility={assembly3d.togglePartVisibility}
            onSetPartsVisibility={assembly3d.setPartsVisibility}
            onSelectPart={assembly3d.selectPart}
            onChangeExplosionFactor={viewport.setExplosionFactor}
            onToggleXrayMode={viewport.toggleXrayMode}
            onPickAssemblyFeature={assembly3d.handlePickAssemblyFeature}
            onExecuteAssemblyAction={assembly3d.executeContextAction}
            onSelectCameraPreset={assembly3d.applyCameraPreset}
            datums={assembly3d.datums}
            gdtControls={assembly3d.gdtControls}
            gdtPreviewControls={assembly3d.gdtPreviewControls}
            gdtPreviewDatums={assembly3d.gdtPreviewDatums}
            gdtDisplayMode={assembly3d.gdtDisplayMode}
            onChangeGdtDisplayMode={assembly3d.setGdtDisplayMode}
            focusedLoopFeatureIds={assembly3d.focusedLoopFeatureIds}
            goldenPulseFeatureIds={assembly3d.goldenPulseFeatureIds}
            goldenPulseGdtIds={assembly3d.goldenPulseGdtIds}
            editingGdtId={assembly3d.editingGdtId}
            featureKindById={assembly3d.featureKindById}
            onSelectGdtCallout={assembly3d.handleSelectGdtCallout}
            onHoverGdtCallout={(target) => {
              assembly3d.setHoveredFeatureId(target ? target.featureId : null)
              assembly3d.setFourWayTarget(
                target
                  ? { featureId: target.featureId, partId: target.partId, gdtId: target.gdtId, datumId: target.datumId }
                  : null,
              )
            }}
            onAssignDatum={assembly3d.assignDatum}
            onCreateGdtControl={assembly3d.createGdtControl}
            onUpdateGdtCallout={assembly3d.updateGdtControl}
            onDeleteGdtCallout={assembly3d.deleteGdtControl}
            snapshotHandleRef={snapshotHandleRef}
            physicsM4={physics.canvasBundle}
          />

          <CollaborationSidebar
            sidebarRegionRef={session.sidebarRegionRef}
            chatInputRef={session.chatInputRef}
            retryChatButtonRef={session.retryChatButtonRef}
            sidebarSection={activeSidebarSection}
            sidebarTab={session.sidebarTab}
            onSelectSidebarSection={handleSelectSidebarSection}
            checksSummaryCounts={viewport.checksSummaryCounts}
            feature3dAssemblyM1={assembly3d.feature3dAssemblyM1}
            aiMateDrafts={assembly3d.aiMateDrafts}
            appliedMatesCount={assembly3d.appliedMatesCount}
            mateDraftsFeedback={assembly3d.mateDraftsFeedback}
            onToggleMateDraft={assembly3d.toggleMateDraft}
            onApplySelectedMateDrafts={assembly3d.applySelectedMateDrafts}
            onFocusAssemblyFeature={assembly3d.focusFeatureById}
            datums={assembly3d.datums}
            gdtControls={assembly3d.gdtControls}
            aiGdtDrafts={assembly3d.aiGdtDrafts}
            appliedGdtCount={assembly3d.appliedGdtCount}
            gdtDraftsFeedback={assembly3d.gdtDraftsFeedback}
            onToggleGdtDraft={assembly3d.toggleGdtDraft}
            onApplySelectedGdtDrafts={assembly3d.applySelectedGdtDrafts}
            onHoverGdtDraft={(draft) => {
              assembly3d.setHoveredGdtDraft(draft)
              assembly3d.setFourWayTarget(
                draft
                  ? {
                      featureId: draft.featureId,
                      partId: draft.partId,
                      gdtId: draft.gdt?.id,
                      datumId: draft.datum?.id,
                      annotationId: draft.linkedAnnotationId,
                    }
                  : null,
              )
            }}
            onFocusGdtDraft={(draft) => {
              assembly3d.setFourWayTarget({
                featureId: draft.featureId,
                partId: draft.partId,
                gdtId: draft.gdt?.id,
                datumId: draft.datum?.id,
                annotationId: draft.linkedAnnotationId,
              })
              assembly3d.focusFeatureById(draft.featureId)
            }}
            onUpdateGdtControl={assembly3d.updateGdtControl}
            simulationResult={physics.simulationResult}
            simulationComputing={assembly3d.simulationComputing || physics.compliantComputing}
            activeAssemblyFeatureId={
              assembly3d.fourWayTarget?.featureId ??
              assembly3d.hoveredFeatureId ??
              viewport.canvasState.selectedObjectId
            }
            activeGdtId={assembly3d.fourWayTarget?.gdtId ?? assembly3d.editingGdtId}
            onChangeContributorTolerance={(id, val) => {
              assembly3d.updateWhatIfTolerance(id, val)
              physics.scheduleCompliantAnalysis()
            }}
            physicsM4={{
              physicsSpec: physics.physicsSpec, includeCompliant: physics.includeCompliant,
              onToggleIncludeCompliant: physics.toggleIncludeCompliant, aiPhysicsDrafts: physics.aiPhysicsDrafts,
              appliedPhysicsCount: physics.appliedPhysicsCount, physicsDraftsFeedback: physics.physicsDraftsFeedback,
              activePartId: physics.hoveredPhysicsDraft?.partId ?? assembly3d.fourWayTarget?.partId ?? null,
              onTogglePhysicsDraft: physics.togglePhysicsDraft, onApplySelectedPhysicsDrafts: physics.applySelectedPhysicsDrafts,
              onHoverPhysicsDraft: physics.setHoveredPhysicsDraft,
              onFocusPhysicsDraft: (draft) => assembly3d.selectPart(draft.partId),
            }}
            onHoverContributor={(target) => {
              assembly3d.setHoveredFeatureId(target ? target.featureId : null)
              assembly3d.setFourWayTarget(
                target ? { featureId: target.featureId, partId: target.partId, gdtId: target.gdtId } : null,
              )
            }}
            onClickContributor={(target) => {
              assembly3d.setFourWayTarget({ featureId: target.featureId, partId: target.partId, gdtId: target.gdtId })
              assembly3d.focusFeatureById(target.featureId)
            }}
            reportExport={reportExportProps}
            requirements={viewport.canvasState.requirements}
            checks={viewport.canvasState.checks}
            checksInProgress={viewport.canvasState.checksInProgress}
            history={viewport.canvasState.history}
            formalVersions={session.formalVersions}
            uncommittedDrafts={session.uncommittedDrafts}
            restoreStatus={session.restoreStatus}
            migrationReport={session.migrationReport}
            migrationLoading={session.migrationLoading}
            migrationNotice={session.migrationNotice}
            canUndoBlockedDraft={session.canUndoBlockedDraft}
            undoPending={session.undoPending}
            undoFeedback={session.undoFeedback}
            activeCheckId={viewport.activeCheckId}
            activeEvidence={viewport.activeEvidence}
            evidenceLoading={viewport.evidenceLoading}
            evidenceNotice={viewport.evidenceNotice}
            clarificationFeedback={viewport.clarificationFeedback}
            clarificationPendingId={viewport.clarificationPendingId}
            onSelectCheck={viewport.handleSelectCheck}
            onSelectRequirement={viewport.handleSelectRequirement}
            onSubmitClarification={(params) => {
              void viewport.handleSubmitClarification(params)
            }}
            onUndoBlockedDraft={() => {
              void session.handleUndoBlockedDraft()
            }}
            onLoadMigrationReport={() => {
              void session.handleLoadMigrationReport()
            }}
            onOpenMigrationDrawer={() => session.setMigrationDrawerOpen(true)}
            activities={session.activities}
            activitiesNotice={session.activitiesNotice}
            objectRefCopyFeedback={session.objectRefCopyFeedback}
            draftRevision={session.draftRevision}
            onRefreshExternalActivities={() => {
              void session.handleRefreshExternalActivities()
            }}
            onSetPreviewMessage={session.setPreviewMessage}
            builtinUnlocked={session.builtinUnlocked}
            hasBuiltinChatCapability={session.probe.capabilities.builtinChat}
            messages={session.messages}
            lastFailedTurn={session.lastFailedTurn}
            chatPending={session.chatPending}
            chatNotice={session.chatNotice}
            chatInput={session.chatInput}
            attachedTaskbooks={session.attachedTaskbooks}
            availableTaskbooks={session.availableTaskbooks}
            attachedRefIds={session.attachedRefIds}
            includeSelectedInChat={session.includeSelectedInChat}
            selectedObject={viewport.selectedObject}
            attachPopoverOpen={session.attachPopoverOpen}
            onOpenModelApiOnboarding={() => {
              session.setOnboardingChoice('model-api')
              session.setShowOnboarding(true)
            }}
            onChangeChatInput={session.setChatInput}
            onSendChat={() => {
              void session.handleSendChat()
            }}
            onStopChat={() => {
              void session.handleStopChat()
            }}
            onRetryChat={() => {
              void session.handleRetryChat()
            }}
            onToggleAttachPopover={() => session.setAttachPopoverOpen((prev) => !prev)}
            onCloseAttachPopover={() => session.setAttachPopoverOpen(false)}
            onToggleTaskbookAttachment={session.toggleTaskbookAttachment}
            onChangeIncludeSelectedInChat={session.setIncludeSelectedInChat}
          />
        </div>
      )}
    </main>
  )
}
