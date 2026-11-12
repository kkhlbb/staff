#!/usr/bin/env node
/**
 * 生成两张「界面必须显式提示」的取证夹具（不是产品数据）：
 *
 * 1. unsupported.dxf：含 LINE + SPLINE + HATCH + INSERT + SOLID；
 *    界面必须显示「未渲染 N 个 XXX（不支持）」，不能静默丢弃。
 * 2. broken-gbk.dxf：真实 GBK 样本末尾追加 0xFF（GBK/UTF-8 都不合法的字节）；
 *    界面必须显示「本文件编码未识别，文字可能不正确」。
 *
 * 运行：node docs/evidence/dxf-viewer/fixtures/make-fixtures.mjs
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const SAMPLES = path.join(process.cwd(), 'docs', 'evidence', 'dxf-depth', 'samples')

const unsupported = [
  '0', 'SECTION', '2', 'HEADER',
  '9', '$ACADVER', '1', 'AC1015',
  '9', '$DWGCODEPAGE', '3', 'UTF-8',
  '9', '$INSUNITS', '70', '4',
  '9', '$EXTMIN', '10', '0', '20', '0', '30', '0',
  '9', '$EXTMAX', '10', '120', '20', '80', '30', '0',
  '9', '$LIMMIN', '10', '0', '20', '0',
  '9', '$LIMMAX', '10', '120', '20', '80',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'TABLES',
  '0', 'TABLE', '2', 'LAYER', '70', '3',
  '0', 'LAYER', '2', '轮廓', '70', '0', '62', '7', '6', 'CONTINUOUS',
  '0', 'LAYER', '2', '文字', '70', '0', '62', '2', '6', 'CONTINUOUS',
  '0', 'LAYER', '2', '不支持', '70', '0', '62', '1', '6', 'CONTINUOUS',
  '0', 'ENDTAB', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', '轮廓', '10', '10', '20', '10', '11', '110', '21', '10',
  '0', 'LINE', '8', '轮廓', '10', '110', '20', '10', '11', '110', '21', '70',
  '0', 'LINE', '8', '轮廓', '10', '110', '20', '70', '11', '10', '21', '70',
  '0', 'LINE', '8', '轮廓', '10', '10', '20', '70', '11', '10', '21', '10',
  '0', 'CIRCLE', '8', '轮廓', '10', '60', '20', '40', '40', '20',
  '0', 'TEXT', '8', '文字', '10', '20', '20', '60', '40', '4', '1', '未支持实体计数：SPLINE / HATCH / INSERT / SOLID',
  '0', 'SPLINE', '8', '不支持', '10', '0', '20', '0',
  '0', 'HATCH', '8', '不支持', '10', '0', '20', '0',
  '0', 'INSERT', '8', '不支持', '2', 'BLOCK_A', '10', '0', '20', '0',
  '0', 'SOLID', '8', '不支持', '10', '0', '20', '0', '11', '1', '21', '1',
  '0', 'ENDSEC', '0', 'EOF',
].join('\n')

await fsp.writeFile(path.join(HERE, 'unsupported.dxf'), unsupported, 'utf8')

const gbk = await fsp.readFile(
  path.join(SAMPLES, 'spacer-20x32x12.05-dxf-2000-1x2.dxf'),
)
const broken = new Uint8Array(gbk.length + 1)
broken.set(gbk)
broken[gbk.length] = 0xff
await fsp.writeFile(path.join(HERE, 'broken-gbk.dxf'), broken)
console.log('fixtures written')
