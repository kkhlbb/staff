import { useMemo } from 'react'
import './ProjectAgentPanel.css'
import {
  resolveWorkbenchTransport,
  type ElectronTransport,
} from '../../transport/electronTransport'
import type { Transport } from '../../transport/types'
import type {
  M1ConnectionStatusSnapshot,
  M1ExternalActivityItem,
  M1SelectedObjectRef,
  M1TaskbookReference,
} from './m1WorkbenchBridge'
import {
  formatRevisionDisplay,
  type M2PreviewSnapshot,
  type M2SidebarSection,
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
import { useWorkbenchSession } from './hooks/useWorkbenchSession'
import { WorkbenchTopBar } from './components/WorkbenchTopBar'
import { WorkbenchStatusBanners } from './components/WorkbenchStatusBanners'
import { OnboardingWizard } from './components/OnboardingWizard'
import { CollaborationSidebar } from './components/CollaborationSidebar'

export type { WorkbenchLocalProject, WorkbenchChatMessage }

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
  readonly localProjects?: readonly WorkbenchLocalProject[]
  readonly availableObjects?: readonly M1SelectedObjectRef[]
  readonly availableTaskbooks?: readonly M1TaskbookReference[]
  readonly initialConnectionSnapshot?: Partial<M1ConnectionStatusSnapshot>
  readonly initialActivities?: readonly M1ExternalActivityItem[]
  readonly initialMessages?: readonly WorkbenchChatMessage[]
  readonly initialShowOnboarding?: boolean
  readonly initialPreviewSnapshot?: Partial<M2PreviewSnapshot>
  readonly initialViewMode?: M2ViewMode
  readonly initialSidebarSection?: M2SidebarSection
  readonly initialShowCompletionView?: boolean
  readonly initialFormalVersions?: readonly M3FormalVersionItem[]
  readonly initialUncommittedDrafts?: readonly M3UncommittedDraftItem[]
  readonly initialRestoreStatus?: M3ReopenRestoreStatus | null
  readonly initialMigrationReport?: M3MigrationReport | null
  readonly forceNarrowViewport?: boolean
  readonly clipboardWriter?: (text: string) => Promise<void> | void
  readonly className?: string
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
}: ProjectAgentM1WorkbenchProps) {
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
    transport,
    initialProjectId,
    initialProjectName,
    initialBaseRevision,
    initialDraftRevision,
    availableObjectsProp,
    availableTaskbooksProp,
    initialConnectionSnapshot,
    initialActivities,
    initialMessages,
    initialShowOnboarding,
    initialPreviewSnapshot,
    initialViewMode,
    initialSidebarSection,
    initialShowCompletionView,
    initialFormalVersions,
    initialUncommittedDrafts,
    initialRestoreStatus,
    initialMigrationReport,
    forceNarrowViewport,
    clipboardWriter,
  })

  const { viewport } = session
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
          if (session.migrationReport) {
            session.setMigrationDrawerOpen(true)
          } else {
            session.setSidebarSection('history')
            void session.handleLoadMigrationReport()
          }
        }}
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
        onConfirmCommitFormal={() => {
          void session.handleConfirmCommitFormal()
        }}
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
            features={viewport.canvasState.features}
            annotations={viewport.canvasState.annotations}
            modelMesh={viewport.canvasState.modelMesh}
            drawingVector={viewport.canvasState.drawingVector}
            selectedObjectId={viewport.canvasState.selectedObjectId}
            selectedAnnotationId={viewport.canvasState.selectedAnnotationId}
            highlightedFeatureIds={viewport.highlightedFeatureIds}
            highlightedAnnotationIds={viewport.highlightedAnnotationIds}
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
            onClearSelection={viewport.handleClearSelection}
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
          />

          <CollaborationSidebar
            sidebarRegionRef={session.sidebarRegionRef}
            chatInputRef={session.chatInputRef}
            retryChatButtonRef={session.retryChatButtonRef}
            sidebarSection={session.sidebarSection}
            sidebarTab={session.sidebarTab}
            onSelectSidebarSection={session.setSidebarSection}
            checksSummaryCounts={viewport.checksSummaryCounts}
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
