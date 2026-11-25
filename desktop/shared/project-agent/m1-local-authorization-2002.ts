// Additive native-consent request only; the 1933 read requests/replies remain unchanged.
import { nat, object, text } from './schema.ts'
import type { Infer } from './schema.ts'
export const isM1AuthorizationRequest = object({ projectId: text, requestId: text, requestGeneration: nat })
export type M1AuthorizationRequest = Infer<typeof isM1AuthorizationRequest>
