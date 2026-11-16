export function confirmationPlan(documents) {
  const rows = documents.map(doc => {
    const batchConfirmClicks = doc.confirmableSingle > 0 ? 1 : 0
    const individualPicks = doc.pendingIndividualDecisions
    const confirmedAfterSelection = doc.confirmableSingle + individualPicks
    const unselectedPending = doc.pending - confirmedAfterSelection
    const unitOperations = doc.unitOnly > 0 ? { clicks: 2, inputs: 1 } : { clicks: 0, inputs: 0 }
    return { id: doc.id, beforeConfirmClicks: confirmedAfterSelection, batchConfirmClicks, individualPicks,
      confirmClicks: batchConfirmClicks + individualPicks, confirmedAfterSelection, unselectedPending,
      unitOperations, pendingAfterUnitAttestation: unselectedPending + doc.unitOnly,
      totalOperations: batchConfirmClicks + individualPicks + unitOperations.clicks + unitOperations.inputs }
  })
  const totals = Object.fromEntries(['beforeConfirmClicks', 'batchConfirmClicks', 'individualPicks', 'confirmClicks', 'confirmedAfterSelection', 'unselectedPending', 'pendingAfterUnitAttestation', 'totalOperations'].map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]))
  return { status: 'PLANNED_NOT_EXECUTED', scope: 'per-document action lower bound; reading/review time and remaining candidate decisions excluded; unit attestation is not confirmation', documents: rows, totals }
}
