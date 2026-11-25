import { fingerprint } from '../../src/core/geometry/geometryManager.mjs'

function entities(drawing) {
  let offset = 0
  return drawing.views.flatMap(view => {
    const x = offset
    offset += view.size[0] + 20
    const point = ([u, v]) => [u + x, v]
    return [
      ...view.geometry.map(shape => shape.kind === 'circle'
        ? { ...shape, center: point(shape.center) }
        : { ...shape, points: shape.points.map(point) }),
      ...drawing.annotations.filter(row => row.view === view.id).flatMap(row => [
        { kind: 'line', points: row.witnesses.map(point) },
        { kind: 'text', at: point(row.witnesses[0]), text: row.valueMm.toFixed(drawing.displayDecimals) },
      ]),
    ]
  })
}

function svg(drawing, shapes) {
  const width = drawing.views.reduce((sum, view) => sum + view.size[0] + 20, 0)
  const height = Math.max(...drawing.views.map(view => view.size[1]))
  const point = ([x, y]) => [x, height - y].join(',')
  const markup = shapes.map(shape => {
    if (shape.kind === 'circle') return `<circle cx="${shape.center[0]}" cy="${height - shape.center[1]}" r="${shape.radius}"/>`
    if (shape.kind === 'text') return `<text x="${shape.at[0]}" y="${height - shape.at[1]}" fill="#111" stroke="none" font-size="3">${shape.text}</text>`
    const tag = shape.closed ? 'polygon' : 'polyline'
    const dash = shape.style === 'hidden' ? ' stroke-dasharray="2 1"' : ''
    return `<${tag} points="${shape.points.map(point).join(' ')}"${dash}/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 ${width + 5} ${height + 10}"><g fill="none" stroke="#111" stroke-width=".3">${markup}</g></svg>`
}

function dxf(shapes, version) {
  const rows = [0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, version, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES']
  for (const shape of shapes) {
    if (shape.kind === 'circle') {
      rows.push(0, 'CIRCLE', 8, '0', 10, shape.center[0], 20, shape.center[1], 40, shape.radius)
    } else if (shape.kind === 'text') {
      rows.push(0, 'TEXT', 8, '0', 10, shape.at[0], 20, shape.at[1], 40, 2, 1, shape.text)
    } else {
      const points = shape.closed ? [...shape.points, shape.points[0]] : shape.points
      for (let i = 1; i < points.length; i++) {
        rows.push(0, 'LINE', 8, '0', 10, points[i - 1][0], 20, points[i - 1][1], 11, points[i][0], 21, points[i][1])
      }
    }
  }
  rows.push(0, 'ENDSEC', 0, 'EOF', '')
  return rows.join('\r\n')
}

export function plateDrawing(drawing, format) {
  const shapes = entities(drawing)
  return {
    fingerprint: fingerprint(drawing),
    bytes: Buffer.from(format === 'svg' ? svg(drawing, shapes) : dxf(shapes, format === 'dxf-r12' ? 'AC1009' : 'AC1015')),
  }
}
