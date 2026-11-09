import {connect} from './cdp.mjs'
const p=await connect(9344,'page')
await p.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false })
await p.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='尺寸链').click()`)
await new Promise(resolve => setTimeout(resolve, 400))
console.log(await p.eval(`[...document.querySelectorAll('.desktop-workspace, .desktop-workspace__body, .desktop-workspace__canvas:not([hidden]), .desktop-workspace__content, .desktop-workspace__review')].map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),height:getComputedStyle(e).height,overflow:getComputedStyle(e).overflow,min:getComputedStyle(e).minHeight,shrink:getComputedStyle(e).flexShrink}))`))
p.close()
