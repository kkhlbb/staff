// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MmInput } from './MmInput'

function Harness({ initial = '12.05' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><MmInput aria-label="mm" value={value} onChange={event => setValue(event.target.value)} /><output data-testid="raw">{value}</output></>
}
describe('MmInput：显示不更改原文或解析精度', () => {
  it('非编辑三位，聚焦后逐字保留；失焦规范显示但不重写草稿', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('12.050')
    fireEvent.focus(input)
    expect(input).toHaveValue('12.05')
    for (const text of ['1', '12', '12.', '12.0', '12.05', '12.0500']) {
      fireEvent.change(input, { target: { value: text } })
      expect(input).toHaveValue(text)
    }
    fireEvent.blur(input)
    expect(input).toHaveValue('12.050')
    expect(screen.getByTestId('raw')).toHaveTextContent('12.0500')
  })
  it.each(['0.0501', '-0.0001', '12.', '0.00001', ''])('失焦保留精细或非法文本 %j', initial => {
    render(<Harness initial={initial} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(input).toHaveValue(initial)
    fireEvent.blur(input)
    expect(input).toHaveValue(initial)
  })
})
