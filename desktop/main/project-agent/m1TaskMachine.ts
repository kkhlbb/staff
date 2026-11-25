import { isM1Activity, isM1ActivityStatus } from '../../shared/project-agent/m1-fields'
import type { M1Activity } from '../../shared/project-agent/m1-fields'
import { list, object, text } from '../../shared/project-agent/schema'
import type { Infer } from '../../shared/project-agent/schema'

export const isStep = object({
  stepId: text, taskId: text, status: isM1ActivityStatus, owner: text,
})
export type TaskStep = Infer<typeof isStep>

const transitions: Record<M1Activity['status'], readonly M1Activity['status'][]> = {
  queued: ['running', 'cancelled'],
  running: ['awaitingInput', 'interrupted', 'succeeded', 'failed', 'cancelled'],
  awaitingInput: ['running', 'cancelled'],
  interrupted: ['running', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

export function canTransition(from: M1Activity['status'], to: M1Activity['status']) {
  return transitions[from].includes(to)
}

export function validTaskJournal(projectId: string, tasks: unknown, steps: unknown): boolean {
  if (!list(isM1Activity)(tasks) || !list(isStep)(steps)) return false
  const byTask = new Map<string, TaskStep>()
  const ids = new Set<string>()
  for (const step of steps) {
    const previous = byTask.get(step.taskId)
    if (ids.has(step.stepId) || (previous
      ? previous.owner !== step.owner || !canTransition(previous.status, step.status)
      : step.status !== 'queued')) return false
    ids.add(step.stepId)
    byTask.set(step.taskId, step)
  }
  for (const task of tasks) {
    const step = byTask.get(task.taskId)
    if (!step || task.projectId !== projectId || step.status !== task.status || step.stepId !== task.lastStep ||
      (task.status === 'awaitingInput' && task.question === null)) return false
    byTask.delete(task.taskId)
  }
  return byTask.size === 0
}
