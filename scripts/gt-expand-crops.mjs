#!/usr/bin/env node
/** Offline geometry-only inventory and original PDF crops. No values copied into truth. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { defaultCorpusDir, loadManifest, MANIFEST_RELATIVE_PATH, verifyCorpus, READ_BUDGET } from './real-docs/metrics.mjs'
import { loadExtraction, loadPdfTextExtract, loadEvidenceJson } from './real-docs/tsImport.mjs'
const dir = 'docs/evidence/ground-truth'
const { serializeEvidence } = await loadEvidenceJson()
const corpus = verifyCorpus(loadManifest(MANIFEST_RELATIVE_PATH), process.env.REAL_DOC_CORPUS ?? defaultCorpusDir())
const { buildPdfTextLayer, buildExtractionDraft } = await loadExtraction()
const { extractPdfTextPages } = await loadPdfTextExtract()
mkdirSync(`${dir}/crops/gt-02`, { recursive: true })
const inventory = []
for (const entry of corpus) {
  const raw = await extractPdfTextPages(entry.bytes, { from: 1, to: entry.doc.pages }, READ_BUDGET)
  const layer = buildPdfTextLayer(raw)
  const draft = buildExtractionDraft({ projectId: 'real-doc-baseline', baseToken: 'real-doc-baseline-1', source: {
    documentId: `real-doc-${entry.doc.id}`, revisionId: `real-doc-${entry.doc.id}-${entry.sha256.slice(0,12)}`,
    sha256: entry.sha256, blobKey: `corpus:${entry.doc.file}`, pageCount: entry.doc.pages,
  }, pageRange: { from: 1, to: entry.doc.pages }, layer })
  const pending = draft.candidates.filter(c => c.status === 'pending')
  const task = getDocument({ data: new Uint8Array(entry.bytes), useWorkerFetch: false, verbosity: 0 })
  const pdf = await task.promise
  const pageCanvases = new Map()
  const thumbnails = []
  for (const [i,c] of pending.entries()) {
    const e = c.data.nominal.evidence[0]
    const anchor = c.evidence?.find(a => a.page === e.page) ?? e
    const rect = [Math.min(anchor.rectPdf[0],e.rectPdf[0]), Math.min(anchor.rectPdf[1],e.rectPdf[1]), Math.max(anchor.rectPdf[2],e.rectPdf[2]), Math.max(anchor.rectPdf[3],e.rectPdf[3])]
    if (!pageCanvases.has(e.page)) {
      const page = await pdf.getPage(e.page)
      if(page.rotate !== 0 || page.view[0] !== 0 || page.view[1] !== 0) throw Error('Unsupported page geometry')
      const viewport = page.getViewport({scale:4})
      const canvas = createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise
      pageCanvases.set(e.page,canvas)
    }
    const canvas = pageCanvases.get(e.page)
    const x = Math.max(0,(rect[0]-18)*4), y = Math.max(0,canvas.height-(rect[3]+24)*4)
    const width = Math.min(canvas.width-x,(rect[2]-rect[0]+110)*4)
    const height = Math.min(canvas.height-y,(rect[3]-rect[1]+48)*4)
    const crop = createCanvas(Math.ceil(width),Math.ceil(height))
    crop.getContext('2d').drawImage(canvas,x,y,width,height,0,0,width,height)
    const label = `${entry.doc.id}-${String(i+1).padStart(2,'0')}`
    const cropFile = `crops/gt-02/${label}-p${e.page}.png`
    writeFileSync(`${dir}/${cropFile}`,crop.toBuffer('image/png'))
    inventory.push({ label, docId:entry.doc.id, candidateId:c.candidateId, page:e.page, rect, cropFile,
      deviationGeometry: Object.fromEntries(['upperDeviation','lowerDeviation'].map(field => [field,
        (c.data[field]?.evidence ?? []).map(source => ({page:source.page, rect:source.rectPdf}))])) })
    if (entry.doc.id === 'r6' && [2,13,14,15].includes(i+1)) {
      for (const field of ['upperDeviation','lowerDeviation']) {
        for (const [j,source] of (c.data[field]?.evidence ?? []).entries()) {
          const page = await pdf.getPage(source.page)
          const viewport = page.getViewport({scale:4})
          const full = createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height))
          await page.render({canvasContext:full.getContext('2d'),viewport}).promise
          const [x0,y0,x1,y1] = source.rectPdf
          const sx=Math.max(0,(x0-50)*4), sy=Math.max(0,full.height-(y1+22)*4)
          const sw=Math.min(full.width-sx,(x1-x0+150)*4), sh=Math.min(full.height-sy,(y1-y0+44)*4)
          const extra=createCanvas(Math.ceil(sw),Math.ceil(sh))
          extra.getContext('2d').drawImage(full,sx,sy,sw,sh,0,0,sw,sh)
          writeFileSync(`${dir}/crops/gt-02/${label}-${field}-${j}-p${source.page}.png`,extra.toBuffer('image/png'))
          console.log(`${label} ${field} evidence ${j} page ${source.page}`)
        }
      }
    }
    thumbnails.push({label:`${label} p${e.page}`,crop})
  }
  for(let offset=0;offset<thumbnails.length;offset+=8) {
    const rows=thumbnails.slice(offset,offset+8)
    const sheet=createCanvas(1800,rows.length*230)
    const ctx=sheet.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,sheet.width,sheet.height)
    for(const [i,{label,crop}] of rows.entries()) {
      ctx.fillStyle='black';ctx.font='22px sans-serif';ctx.fillText(label,10,i*230+28)
      const ratio=Math.min(1,1760/crop.width,185/crop.height)
      ctx.drawImage(crop,20,i*230+38,crop.width*ratio,crop.height*ratio)
    }
    writeFileSync(`${dir}/crops/gt-02/${entry.doc.id}-sheet-${offset/8+1}.png`,sheet.toBuffer('image/png'))
  }
  await task.destroy()
  console.log(`${entry.doc.id}: pending=${pending.length}`)
}
writeFileSync(`${dir}/inventory.json`,serializeEvidence({entries:inventory}))
console.log(`geometry inventory: ${inventory.length}; values deliberately omitted`)
