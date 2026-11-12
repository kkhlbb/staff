/**
 * ADR-001 第 3 步：无任务书入口（意图建件）的领域契约。
 *
 * 三条边界（全部是纯函数，不读盘、不写项目、不计算）：
 * 1. 所有数值都必须能在**当前这一轮用户原话**里找到；模型自行给出的值一律拒绝。
 * 2. 条款区间只认用户原话：不允许引用标准等级、不允许从标准库推默认值。
 * 3. 每个写入都产生 `user-attestation` 出处（actorId + sessionSeq + turnId + 原话），
 *    出处只追加、不抹掉；提交时随版本冻结。
 */
import type { EvidenceRef, UserAttestation } from '../document-extraction/types'

/** 项目内的输入会话（一次连续建件过程）；`sessionSeq` 由 main 自增，不是 UUID。 */
export interface IntentSession {
  readonly actorId: string
  readonly sessionSeq: number
  readonly sessionLabel: string | null
}

/** 当前这一轮用户输入：原话逐字 + 会话轮次身份（由 main 绑定，不由模型提供）。 */
export interface IntentTurn {
  readonly userText: string
  readonly turnId: string
  readonly at: string
}

export const ACTOR_ID_MAX_LENGTH = 40
export const SESSION_LABEL_MAX_LENGTH = 120
export const STATEMENT_MAX_LENGTH = 4000

export type IntentInputErrorCode =
  | 'ACTOR_REQUIRED'
  | 'ACTOR_INVALID'
  | 'STATEMENT_NOT_USER_GIVEN'
  | 'REQUIREMENT_MUST_BE_USER_GIVEN'
  | 'VALUE_MUST_BE_USER_GIVEN'
  | 'VALUE_UNSUPPORTED'
  | 'VALUE_CONFLICT'
  | 'RING_NOT_FOUND'
  | 'SYMBOL_DUPLICATED'
  | 'BINDING_CONFLICT'
  | 'FORMULA_UNSUPPORTED'

export interface IntentInputFailure {
  readonly ok: false
  readonly code: IntentInputErrorCode
  readonly message: string
}

export type IntentInputResult<T> = { readonly ok: true; readonly value: T } | IntentInputFailure

export function intentFail<T>(code: IntentInputErrorCode, message: string): IntentInputResult<T> {
  return { ok: false, code, message }
}

export function intentOk<T>(value: T): IntentInputResult<T> {
  return { ok: true, value }
}

/** 文本归一：NFKC + 去首尾空白 + 连续空白折叠；只用于比对，不改原话存储。 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

/**
 * 断言原话必须能在本轮用户输入里逐字找到（归一后）。
 * 模型转述、概括或自行编造的句子都不算“用户原话”。
 */
export function statementIsUserGiven(statement: string, userText: string): boolean {
  const normalizedStatement = normalizeText(statement)
  if (normalizedStatement === '') return false
  return normalizeText(userText).includes(normalizedStatement)
}

const NUMBER_TOKEN = /[+-]?\d+(?:\.\d+)?/gu
/** 全角数字与小数点先归一，再抽数字。 */
export function numbersInText(text: string): string[] {
  const normalized = text.normalize('NFKC')
  return normalized.match(NUMBER_TOKEN) ?? []
}

function canonicalNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/u.test(trimmed)) return null
  return Number(trimmed)
}

/**
 * 工具给出的每个数值都必须能在本轮用户原话里找到同一个数。
 *
 * 比较的是数值（`20` 与 `20.00` 视为同一个数），不比较写法；这样“φ20”能支持
 * 模型写成 20.00，但 21 不会因为原话里有 210 而被误放行。
 */
export function numbersAreUserGiven(values: readonly string[], userText: string): boolean {
  const tokens = numbersInText(userText)
    .map(canonicalNumber)
    .filter((value): value is number => value !== null)
  return values.every((value) => {
    const parsed = canonicalNumber(value)
    if (parsed === null) return false
    if (tokens.includes(parsed)) return true
    // 偏差的正负号是工程约定（“±0.01”同时给出上下偏差），数值本身仍必须出现；
    // 只允许“数值相同、符号为负”的回退，不允许改数。
    return parsed < 0 && tokens.includes(Math.abs(parsed))
  })
}

export interface AttestationInput {
  readonly session: IntentSession
  readonly turn: IntentTurn
  readonly statement: string
  readonly fieldPath: string
}

/**
 * 生成一条用户断言。调用方必须先通过 `statementIsUserGiven` 与数值校验；
 * 本函数只负责形状（没有 UUID、没有唯一性校验）。
 */
export function buildAttestation(input: AttestationInput): UserAttestation {
  return {
    kind: 'user-attestation',
    actorId: input.session.actorId,
    at: input.turn.at,
    sessionSeq: input.session.sessionSeq,
    sessionLabel: input.session.sessionLabel,
    statement: input.statement,
    fieldPath: input.fieldPath,
    turnId: input.turn.turnId,
  }
}

/** 出处集合里必须至少有一条本项目会话的用户断言。 */
export function attestationRefs(...items: readonly UserAttestation[]): EvidenceRef[] {
  return [...items]
}
