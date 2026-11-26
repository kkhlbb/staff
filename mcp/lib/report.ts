import { z } from 'zod'

const png = z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
export const reportRequestSchema = z.strictObject({
  projectId: z.string().min(1).regex(/\S/),
  format: z.enum(['html', 'pdf', 'csv', 'json']),
  includeSnapshots: z.boolean().optional(),
  viewportSnapshots: z.strictObject({
    nominalPngDataUrl: png.optional(),
    heatmapPngDataUrl: png.optional(),
  }).optional(),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
})
