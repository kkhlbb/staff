// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSyntheticM1Activity,
  createSyntheticM1ContextFields,
  createSyntheticM1Question,
  createSyntheticM1SpacerDraft,
} from './m1FieldFixtures';
import { M1_SYNTHETIC_BADGE, presentM1Context } from './m1FieldPresentation';
import {
  M1_SESSION_FORMAL_SAVE_ENABLED,
  M1_SESSION_PRODUCTION_API_CONNECTED,
  ProjectAgentM1Session,
} from './ProjectAgentM1Session';

afterEach(cleanup);

describe('ProjectAgentM1Session', () => {
  it('renders entry controls in required order and does not auto-load fixtures on default render', () => {
    render(<ProjectAgentM1Session />);

    const localAgentBtn = screen.getByRole('button', { name: '连接本地 Agent' });
    const modelApiBtn = screen.getByRole('button', { name: '使用模型 API' });
    const skipBtn = screen.getByRole('button', { name: '跳过，查看本地项目' });

    expect(
      localAgentBtn.compareDocumentPosition(modelApiBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      modelApiBtn.compareDocumentPosition(skipBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect((skipBtn as HTMLButtonElement).disabled).toBe(false);

    expect(screen.queryByText('proj-alpha')).toBeNull();
    expect(screen.queryByText(M1_SYNTHETIC_BADGE)).toBeNull();
    expect(screen.getByRole('region', { name: '连接：未连接' })).toBeTruthy();
    expect(screen.getByText('生产 API：未接通')).toBeTruthy();
  });

  it('reveals caller-provided local projects on skip without faking connection, and shows empty state when none', () => {
    const onSkip = vi.fn();
    render(
      <ProjectAgentM1Session
        localProjects={[
          { projectId: 'local-proj-1', draftRevision: 'rev-1' },
          { projectId: 'local-proj-2', draftRevision: null },
        ]}
        onSkipToLocalProjects={onSkip}
      />,
    );

    expect(screen.queryByText('local-proj-1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '跳过，查看本地项目' }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(screen.getByText('local-proj-1')).toBeTruthy();
    expect(screen.getByText('local-proj-2')).toBeTruthy();
    expect(screen.getByRole('region', { name: '连接：未连接' })).toBeTruthy();
    expect(screen.queryByText('已连接')).toBeNull();
    expect(screen.getByText('生产 API：未接通')).toBeTruthy();

    cleanup();
    render(<ProjectAgentM1Session />);
    fireEvent.click(screen.getByRole('button', { name: '跳过，查看本地项目' }));
    expect(screen.getByText('无可列本地项目')).toBeTruthy();
  });

  it('renders connection, authorization, and writer as three distinct labeled regions', () => {
    const base = createSyntheticM1ContextFields();
    const connectedUnauthorizedOccupied = createSyntheticM1ContextFields({
      snapshot: {
        ...base.snapshot,
        connection: 'connected',
        authorization: {
          ...base.snapshot.authorization,
          authorized: false,
          canWrite: false,
        },
        writer: {
          ...base.snapshot.writer,
          occupied: true,
        },
      },
    });

    const { rerender } = render(
      <ProjectAgentM1Session context={connectedUnauthorizedOccupied} synthetic />,
    );

    const connRegion1 = screen.getByRole('region', { name: '连接：已连接' });
    const authRegion1 = screen.getByRole('region', { name: '授权：未授权' });
    const writerRegion1 = screen.getByRole('region', { name: '写入：写入位已占用' });
    expect(connRegion1).not.toBe(authRegion1);
    expect(authRegion1).not.toBe(writerRegion1);
    expect(within(connRegion1).getByText('已连接')).toBeTruthy();
    expect(within(authRegion1).getByText('未授权')).toBeTruthy();
    expect(within(writerRegion1).getByText('写入位已占用')).toBeTruthy();

    const disconnectedReadonlyFree = createSyntheticM1ContextFields({
      snapshot: {
        ...base.snapshot,
        connection: 'disconnected',
        authorization: {
          ...base.snapshot.authorization,
          authorized: true,
          canWrite: false,
        },
        writer: {
          ...base.snapshot.writer,
          occupied: false,
        },
      },
    });

    rerender(
      <ProjectAgentM1Session context={disconnectedReadonlyFree} synthetic />,
    );

    expect(screen.getByRole('region', { name: '连接：未连接' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '授权：已授权（只读）' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '写入：写入位空闲' })).toBeTruthy();
  });

  it('handles project switching only when onSelectProject is provided', () => {
    const onSelectProject = vi.fn();
    const { rerender } = render(
      <ProjectAgentM1Session
        localProjects={[{ projectId: 'proj-switch-a', draftRevision: 'rev-2' }]}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '跳过，查看本地项目' }));
    const selectBtn = screen.getByRole('button', { name: '选择项目 proj-switch-a' });
    expect((selectBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(selectBtn);
    expect(onSelectProject).toHaveBeenCalledWith('proj-switch-a');

    rerender(
      <ProjectAgentM1Session
        localProjects={[{ projectId: 'proj-switch-a', draftRevision: 'rev-2' }]}
      />,
    );

    const disabledBtn = screen.getByRole('button', { name: '选择项目 proj-switch-a' });
    expect((disabledBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('已连接')).toBeNull();
  });

  it('retains terminal activities and draft across disconnect without inventing cancellation, and shows disconnect notice', () => {
    const question = createSyntheticM1Question();
    const base = createSyntheticM1ContextFields();
    const connectedContext = createSyntheticM1ContextFields({
      snapshot: {
        ...base.snapshot,
        projectId: 'proj-retention',
        draftRevision: 'rev-9',
        spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'rev-9' }),
        connection: 'connected',
      },
      activities: [
        createSyntheticM1Activity({ taskId: 'task-succeeded', projectId: 'proj-retention', status: 'succeeded' }),
        createSyntheticM1Activity({ taskId: 'task-failed', projectId: 'proj-retention', status: 'failed' }),
        createSyntheticM1Activity({ taskId: 'task-cancelled', projectId: 'proj-retention', status: 'cancelled' }),
        createSyntheticM1Activity({ taskId: 'task-awaiting', projectId: 'proj-retention', status: 'awaitingInput', question }),
      ],
    });

    const disconnectedContext = {
      ...connectedContext,
      snapshot: {
        ...connectedContext.snapshot,
        connection: 'disconnected',
      },
    };

    const { rerender } = render(
      <ProjectAgentM1Session context={connectedContext} synthetic />,
    );

    expect(screen.queryByText(/连接已断开/)).toBeNull();
    expect(screen.getAllByText('已成功')).toHaveLength(1);
    expect(screen.getAllByText('已失败')).toHaveLength(1);
    expect(screen.getAllByText('已取消')).toHaveLength(1);
    expect(screen.getByText(question.prompt)).toBeTruthy();

    rerender(<ProjectAgentM1Session context={disconnectedContext} synthetic />);

    expect(screen.getByRole('region', { name: '连接：未连接' })).toBeTruthy();
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('连接已断开');
    expect(notice.textContent).toContain('proj-retention');
    expect(notice.textContent).toContain('rev-9');

    expect(screen.getAllByText('已成功')).toHaveLength(1);
    expect(screen.getAllByText('已失败')).toHaveLength(1);
    expect(screen.getAllByText('已取消')).toHaveLength(1);
    expect(screen.getByText(question.prompt)).toBeTruthy();
    if (connectedContext.snapshot.spacerDraft) {
      expect(screen.getByRole('region', { name: '隔套草稿' })).toBeTruthy();
    }
  });

  it('shows synthetic badge only when synthetic is true', () => {
    const ctx = createSyntheticM1ContextFields();
    const { rerender } = render(
      <ProjectAgentM1Session context={ctx} synthetic />,
    );
    expect(screen.getByText(M1_SYNTHETIC_BADGE)).toBeTruthy();

    rerender(<ProjectAgentM1Session context={ctx} synthetic={false} />);
    expect(screen.queryByText(M1_SYNTHETIC_BADGE)).toBeNull();

    rerender(<ProjectAgentM1Session context={ctx} />);
    expect(screen.queryByText(M1_SYNTHETIC_BADGE)).toBeNull();
  });

  it('disables connect buttons when callbacks are missing and never fakes connected status on click', () => {
    const { rerender } = render(<ProjectAgentM1Session />);

    expect(
      (screen.getByRole('button', { name: '连接本地 Agent' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '使用模型 API' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    const onSelectLocalAgent = vi.fn();
    const onSelectModelApi = vi.fn();
    const base = createSyntheticM1ContextFields();
    const disconnectedContext = createSyntheticM1ContextFields({
      snapshot: {
        ...base.snapshot,
        connection: 'disconnected',
        authorization: {
          ...base.snapshot.authorization,
          authorized: false,
          canWrite: false,
        },
      },
    });

    rerender(
      <ProjectAgentM1Session
        context={disconnectedContext}
        synthetic
        onSelectLocalAgent={onSelectLocalAgent}
        onSelectModelApi={onSelectModelApi}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '连接本地 Agent' }));
    fireEvent.click(screen.getByRole('button', { name: '使用模型 API' }));

    expect(onSelectLocalAgent).toHaveBeenCalledTimes(1);
    expect(onSelectModelApi).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: '连接：未连接' })).toBeTruthy();
    expect(screen.getByText('生产 API：未接通')).toBeTruthy();
    expect(screen.queryByText('已连接')).toBeNull();
    expect(screen.queryByText('已接通')).toBeNull();
  });

  it('fails closed on invalid context without inventing project or activity data', () => {
    render(<ProjectAgentM1Session context={{ invalid: true }} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: '连接本地 Agent' })).toBeTruthy();
    expect(screen.getByText('生产 API：未接通')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '当前项目' })).toBeNull();
    expect(screen.queryByRole('region', { name: '任务活动' })).toBeNull();
  });

  it('never renders password or secret key inputs and keeps formal save disabled', () => {
    const { container } = render(<ProjectAgentM1Session />);

    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/密钥|API\s*key/i);

    const formalSaveBtn = screen.getByRole('button', { name: '正式保存' });
    expect((formalSaveBtn as HTMLButtonElement).disabled).toBe(true);
    expect(M1_SESSION_FORMAL_SAVE_ENABLED).toBe(false);
    expect(M1_SESSION_PRODUCTION_API_CONNECTED).toBe(false);
  });

  it('renders 隔套草稿 with dimensions, unit mm, sources, excerpts, and draft question without 垫片', () => {
    const draftQuestion = createSyntheticM1Question();
    const base = createSyntheticM1ContextFields();
    const ctx = createSyntheticM1ContextFields({
      snapshot: {
        ...base.snapshot,
        projectId: 'proj-spacer',
        draftRevision: 'rev-spacer-1',
        spacerDraft: createSyntheticM1SpacerDraft({
          draftRevision: 'rev-spacer-1',
          question: draftQuestion,
        }),
        connection: 'connected',
      },
      activities: [],
    });

    const presented = presentM1Context(ctx, { synthetic: true });
    expect(presented.ok).toBe(true);
    if (!presented.ok || !presented.value.spacerDraft) {
      throw new Error('Expected valid synthetic spacer draft presentation');
    }
    const presentedDraft = presented.value.spacerDraft;

    render(<ProjectAgentM1Session context={ctx} synthetic />);

    expect(screen.getByText(M1_SYNTHETIC_BADGE)).toBeTruthy();
    expect(screen.getByText('生产 API：未接通')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toContain('垫片');

    const spacerRegion = screen.getByRole('region', { name: '隔套草稿' });
    expect(within(spacerRegion).getByText('隔套草稿')).toBeTruthy();

    const dimensionItems = within(spacerRegion).getAllByRole('listitem');
    expect(dimensionItems).toHaveLength(3);

    const expectedDimensions = [
      {
        label: '内径',
        mm: presentedDraft.innerDiameterMm,
        source: presentedDraft.sources.innerDiameterQ,
      },
      {
        label: '外径',
        mm: presentedDraft.outerDiameterMm,
        source: presentedDraft.sources.outerDiameterQ,
      },
      {
        label: '长度',
        mm: presentedDraft.lengthMm,
        source: presentedDraft.sources.lengthQ,
      },
    ] as const;

    expectedDimensions.forEach((dim, idx) => {
      const item = dimensionItems[idx];
      expect(item.textContent).toContain(dim.label);
      expect(item.textContent).toContain(`${dim.mm} mm`);
      expect(item.textContent).toContain(dim.source.label);
      if (dim.source.anchor?.excerpt) {
        expect(item.textContent).toContain(dim.source.anchor.excerpt);
      }
    });

    expect(presentedDraft.question).not.toBeNull();
    if (presentedDraft.question) {
      expect(
        within(spacerRegion).getByText(presentedDraft.question.reasonLabel),
      ).toBeTruthy();
      expect(
        within(spacerRegion).getByText(presentedDraft.question.prompt),
      ).toBeTruthy();
    }
  });

  it('renders real activity taskId and lastStep, and omits lastStep when null without inventing placeholder text', () => {
    const base = createSyntheticM1ContextFields();
    const ctx = createSyntheticM1ContextFields({
      snapshot: {
        ...base.snapshot,
        projectId: 'proj-activities',
        draftRevision: 'rev-act-1',
        spacerDraft: null,
        connection: 'connected',
      },
      activities: [
        createSyntheticM1Activity({
          taskId: 'task-real-with-step',
          projectId: 'proj-activities',
          status: 'succeeded',
          lastStep: '核对隔套端面尺寸',
        }),
        createSyntheticM1Activity({
          taskId: 'task-real-no-step',
          projectId: 'proj-activities',
          status: 'failed',
          lastStep: null,
        }),
      ],
    });

    const presented = presentM1Context(ctx, { synthetic: true });
    expect(presented.ok).toBe(true);

    render(<ProjectAgentM1Session context={ctx} synthetic />);

    const activitiesRegion = screen.getByRole('region', { name: '任务活动' });
    const activityItems = within(activitiesRegion).getAllByRole('listitem');
    expect(activityItems).toHaveLength(2);

    expect(within(activityItems[0]).getByText('task-real-with-step')).toBeTruthy();
    expect(within(activityItems[0]).getByText('核对隔套端面尺寸')).toBeTruthy();
    expect(activityItems[0].textContent ?? '').not.toContain('任务活动 1');

    expect(within(activityItems[1]).getByText('task-real-no-step')).toBeTruthy();
    expect(activityItems[1].textContent ?? '').not.toContain('任务活动 2');
    expect(activityItems[1].textContent ?? '').not.toMatch(/无步骤|暂无步骤|未知步骤/);
    expect(activityItems[1].querySelector('p')).toBeNull();
  });
});
