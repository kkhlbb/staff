import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmationPlan } from './confirmation-plan.mjs'
test('counts batches and unit entry per document, not once per corpus', () => {
  const plan = confirmationPlan([
    { id: 'a', pending: 5, confirmableSingle: 2, pendingIndividualDecisions: 1, unitOnly: 3 },
    { id: 'b', pending: 3, confirmableSingle: 1, pendingIndividualDecisions: 1, unitOnly: 0 },
    { id: 'c', pending: 0, confirmableSingle: 0, pendingIndividualDecisions: 0, unitOnly: 2 },
  ])
  assert.equal(plan.status, 'PLANNED_NOT_EXECUTED')
  assert.equal(plan.totals.batchConfirmClicks, 2)
  assert.equal(plan.totals.confirmedAfterSelection, 5)
  assert.equal(plan.totals.unselectedPending, 3)
  assert.equal(plan.totals.pendingAfterUnitAttestation, 8)
  assert.equal(plan.totals.totalOperations, 10)
  assert.equal(plan.documents[2].batchConfirmClicks, 0)
})
