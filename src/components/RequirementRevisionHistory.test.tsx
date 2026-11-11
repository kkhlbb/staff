// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTwoVersionRequirementProject } from '../requirements/__fixtures__/requirementFixture'
import { listRequirementRevisionHistory } from '../requirements/history'
import { RequirementRevisionHistory } from './RequirementRevisionHistory'

afterEach(cleanup)

describe('V3.5 复核区：条款版本历史列表', () => {
  it('列出全部版本及各自的父版本/时间/区间/PDF 版本/页码/选区/活动状态', async () => {
    const project = await createTwoVersionRequirementProject()
    const items = listRequirementRevisionHistory(project.snapshot)

    render(<RequirementRevisionHistory items={items} onLocate={() => undefined} />)

    const section = screen.getByLabelText('条款版本历史')
    const oldRow = within(section).getByTestId('requirement-history-row-reqrev-1')
    expect(oldRow).toHaveTextContent('reqrev-1')
    expect(oldRow).toHaveTextContent('无（首版）')
    expect(oldRow).toHaveTextContent('2026-11-09T09:00:00.000Z')
    expect(oldRow).toHaveTextContent('0.100 ～ 0.300 mm')
    expect(oldRow).toHaveTextContent('sr-1')
    expect(oldRow).toHaveTextContent('第 2 页')
    expect(oldRow).toHaveTextContent('[10, 10, 110, 30]')
    expect(oldRow).toHaveTextContent('历史版本')

    const newRow = within(section).getByTestId('requirement-history-row-reqrev-2')
    expect(newRow).toHaveTextContent('reqrev-2')
    expect(newRow).toHaveTextContent('reqrev-1')
    expect(newRow).toHaveTextContent('taskbook-v2.pdf')
    expect(newRow).toHaveTextContent('sr-taskbook-2')
    expect(newRow).toHaveTextContent('第 1 页')
    expect(newRow).toHaveTextContent('[20, 40, 220, 80]')
    expect(newRow).toHaveTextContent('当前活动')
  })

  it('点击任一版本只把该 revisionId 交给调用方（含旧版本）', async () => {
    const project = await createTwoVersionRequirementProject()
    const items = listRequirementRevisionHistory(project.snapshot)
    const onLocate = vi.fn()

    render(<RequirementRevisionHistory items={items} onLocate={onLocate} />)

    fireEvent.click(screen.getByTestId('locate-revision-requirement-history-reqrev-1'))
    expect(onLocate).toHaveBeenLastCalledWith('reqrev-1')
    fireEvent.click(screen.getByTestId('locate-revision-requirement-history-reqrev-2'))
    expect(onLocate).toHaveBeenLastCalledWith('reqrev-2')
  })
})
