#!/usr/bin/env node
/** Offline re-render of fixed, visually verified ground-truth regions; never derives truth values. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { defaultCorpusDir, loadManifest, MANIFEST_RELATIVE_PATH, verifyCorpus } from './real-docs/metrics.mjs'

const directory = 'docs/evidence/ground-truth'
const { entries: truths } = JSON.parse(readFileSync(`${directory}/gt-01.json`, 'utf8'))
const corpus = verifyCorpus(loadManifest(MANIFEST_RELATIVE_PATH), process.env.REAL_DOC_CORPUS ?? defaultCorpusDir())
mkdirSync(`${directory}/crops`, { recursive: true })
let rendered = 0
for (const entry of corpus) {
  const regions = truths.filter(truth => truth.docId === entry.doc.id)
  if (regions.length === 0) continue
  const task = getDocument({ data: new Uint8Array(entry.bytes), useWorkerFetch: false, verbosity: 0 })
  try {
    const pdf = await task.promise
    for (const truth of regions) {
      const page = await pdf.getPage(truth.page)
      if (page.rotate !== 0 || page.view[0] !== 0 || page.view[1] !== 0) {
        throw new Error('Ground-truth renderer requires unrotated, zero-origin source pages')
      }
      const viewport = page.getViewport({ scale: 4 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      const rect = truth.rect
      const x = (rect[0] - 8) * 4
      const y = viewport.height - (rect[3] + 12) * 4
      const width = (rect[2] - rect[0] + 16) * 4
      const height = (rect[3] - rect[1] + 20) * 4
      const crop = createCanvas(Math.ceil(width), Math.ceil(height))
      crop.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height)
      writeFileSync(`${directory}/${truth.cropFile}`, crop.toBuffer('image/png'))
      rendered += 1
      console.log(`${truth.docId} p${truth.page} ${truth.cropFile}`)
    }
  } finally {
    await task.destroy()
  }
}
if (rendered !== 19) throw new Error(`Expected 19 crops, rendered ${rendered}`)
console.log(`Rendered ${rendered} fixed regions; no truth values modified`)
