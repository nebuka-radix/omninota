import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC_CHANNELS, type AppInfo } from '../../shared/contracts/ipc'
import { appGetInfoArgsSchema } from '../../shared/validation/app'
import {
  milestonesCreateArgsSchema,
  milestonesDeleteArgsSchema,
  milestonesGetDeletionSummaryArgsSchema,
  milestonesListArgsSchema,
  milestonesRenameArgsSchema,
  milestonesReorderArgsSchema
} from '../../shared/validation/milestones'
import {
  projectsCreateArgsSchema,
  projectsDeleteArgsSchema,
  projectsGetDeletionSummaryArgsSchema,
  projectsListArgsSchema,
  projectsRenameArgsSchema,
  projectsSetCompletedArgsSchema,
  projectsSetFavoriteArgsSchema
} from '../../shared/validation/projects'
import {
  tasksAssignFromInboxArgsSchema,
  tasksCreateArgsSchema,
  tasksDeleteArgsSchema,
  tasksDeleteManyArgsSchema,
  tasksReorderInMilestoneArgsSchema,
  tasksSetDueArgsSchema,
  tasksSetDayManyArgsSchema,
  summaryGetArgsSchema,
  tasksSetFavoriteArgsSchema,
  tasksListArgsSchema,
  tasksSetCompletedArgsSchema,
  tasksSetAssignmentArgsSchema,
  tasksUpdateTitleArgsSchema
} from '../../shared/validation/tasks'
import {
  workspaceFlushResultArgsSchema,
  workspaceGetArgsSchema,
  workspaceSaveArgsSchema
} from '../../shared/validation/workspace'
import type { FlushRequester } from '../lifecycle/workspace-flush'
import type { MilestoneService } from '../services/milestone-service'
import type { ProjectService } from '../services/project-service'
import type { SummaryService } from '../services/summary-service'
import type { TaskService } from '../services/task-service'
import type { WorkspaceSettingsService } from '../services/workspace-settings-service'
import { createIpcHandler, type SenderPolicy } from './handler'

// チャンネルごとに用途を限定したハンドラーだけを登録する（汎用の転送口は作らない）。
// タスクAPIは、DBのマイグレーション完了後に呼び出すこと。
export function registerIpcHandlers(deps: {
  policy: SenderPolicy
  getAppInfo: () => AppInfo
  setCompact: (compact: boolean) => null
  taskService: TaskService
  projectService: ProjectService
  milestoneService: MilestoneService
  summaryService: SummaryService
  workspaceSettingsService: WorkspaceSettingsService
  flushRequester: FlushRequester
}): void {
  const { policy, taskService, projectService, milestoneService, workspaceSettingsService } = deps
  ipcMain.handle(IPC_CHANNELS.projectsSetFavorite,
    createIpcHandler({ channel: IPC_CHANNELS.projectsSetFavorite, argsSchema: projectsSetFavoriteArgsSchema, policy,
      run: ([input]) => projectService.setFavorite(input) }))
  ipcMain.handle(
    IPC_CHANNELS.appSetCompact,
    createIpcHandler({
      channel: IPC_CHANNELS.appSetCompact,
      argsSchema: z.tuple([z.boolean()]),
      policy,
      run: ([compact]) => deps.setCompact(compact)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.appGetInfo,
    createIpcHandler({
      channel: IPC_CHANNELS.appGetInfo,
      argsSchema: appGetInfoArgsSchema,
      policy,
      run: () => deps.getAppInfo()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksCreate,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksCreate,
      argsSchema: tasksCreateArgsSchema,
      policy,
      run: ([input]) => taskService.create(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksList,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksList,
      argsSchema: tasksListArgsSchema,
      policy,
      run: () => taskService.list()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksUpdateTitle,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksUpdateTitle,
      argsSchema: tasksUpdateTitleArgsSchema,
      policy,
      run: ([input]) => taskService.updateTitle(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksSetCompleted,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksSetCompleted,
      argsSchema: tasksSetCompletedArgsSchema,
      policy,
      run: ([input]) => taskService.setCompleted(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksSetAssignment,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksSetAssignment,
      argsSchema: tasksSetAssignmentArgsSchema,
      policy,
      run: ([input]) => taskService.setAssignment(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksDelete,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksDelete,
      argsSchema: tasksDeleteArgsSchema,
      policy,
      run: ([input]) => taskService.delete(input)
    })
  )

  // フェーズ5.9: 一括紐付け・一括削除・タスクの手動順（いずれも1つのトランザクション。入力はZodで検証）
  ipcMain.handle(
    IPC_CHANNELS.tasksAssignFromInbox,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksAssignFromInbox,
      argsSchema: tasksAssignFromInboxArgsSchema,
      policy,
      run: ([input]) => taskService.assignFromInbox(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksDeleteMany,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksDeleteMany,
      argsSchema: tasksDeleteManyArgsSchema,
      policy,
      run: ([input]) => taskService.deleteMany(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksReorderInMilestone,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksReorderInMilestone,
      argsSchema: tasksReorderInMilestoneArgsSchema,
      policy,
      run: ([input]) => taskService.reorderInMilestone(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.tasksSetDayMany,
    createIpcHandler({ channel: IPC_CHANNELS.tasksSetDayMany, argsSchema: tasksSetDayManyArgsSchema, policy,
      run: ([input]) => taskService.setDayMany(input) })
  )

  // フェーズ6: 期限の設定・変更・解除と Summary Review
  ipcMain.handle(
    IPC_CHANNELS.tasksSetDue,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksSetDue,
      argsSchema: tasksSetDueArgsSchema,
      policy,
      run: ([input]) => taskService.setDue(input)
    })
  )

  // お気に入りの設定・解除
  ipcMain.handle(
    IPC_CHANNELS.tasksSetFavorite,
    createIpcHandler({
      channel: IPC_CHANNELS.tasksSetFavorite,
      argsSchema: tasksSetFavoriteArgsSchema,
      policy,
      run: ([input]) => taskService.setFavorite(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.summaryGet,
    createIpcHandler({
      channel: IPC_CHANNELS.summaryGet,
      argsSchema: summaryGetArgsSchema,
      policy,
      run: () => deps.summaryService.get()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.summaryToday,
    createIpcHandler({
      channel: IPC_CHANNELS.summaryToday,
      argsSchema: summaryGetArgsSchema,
      policy,
      run: () => deps.summaryService.today()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.milestonesList,
    createIpcHandler({
      channel: IPC_CHANNELS.milestonesList,
      argsSchema: milestonesListArgsSchema,
      policy,
      run: () => milestoneService.list()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.milestonesCreate,
    createIpcHandler({
      channel: IPC_CHANNELS.milestonesCreate,
      argsSchema: milestonesCreateArgsSchema,
      policy,
      run: ([input]) => milestoneService.create(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.milestonesRename,
    createIpcHandler({
      channel: IPC_CHANNELS.milestonesRename,
      argsSchema: milestonesRenameArgsSchema,
      policy,
      run: ([input]) => milestoneService.rename(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.milestonesGetDeletionSummary,
    createIpcHandler({
      channel: IPC_CHANNELS.milestonesGetDeletionSummary,
      argsSchema: milestonesGetDeletionSummaryArgsSchema,
      policy,
      run: ([input]) => milestoneService.getDeletionSummary(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.milestonesDelete,
    createIpcHandler({
      channel: IPC_CHANNELS.milestonesDelete,
      argsSchema: milestonesDeleteArgsSchema,
      policy,
      run: ([input]) => milestoneService.delete(input)
    })
  )

  // カードの順序（フェーズ5.9）
  ipcMain.handle(
    IPC_CHANNELS.milestonesReorder,
    createIpcHandler({
      channel: IPC_CHANNELS.milestonesReorder,
      argsSchema: milestonesReorderArgsSchema,
      policy,
      run: ([input]) => milestoneService.reorder(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.projectsList,
    createIpcHandler({
      channel: IPC_CHANNELS.projectsList,
      argsSchema: projectsListArgsSchema,
      policy,
      run: () => projectService.list()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.projectsCreate,
    createIpcHandler({
      channel: IPC_CHANNELS.projectsCreate,
      argsSchema: projectsCreateArgsSchema,
      policy,
      run: ([input]) => projectService.create(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.projectsRename,
    createIpcHandler({
      channel: IPC_CHANNELS.projectsRename,
      argsSchema: projectsRenameArgsSchema,
      policy,
      run: ([input]) => projectService.rename(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.projectsSetCompleted,
    createIpcHandler({
      channel: IPC_CHANNELS.projectsSetCompleted,
      argsSchema: projectsSetCompletedArgsSchema,
      policy,
      run: ([input]) => projectService.setCompleted(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.projectsGetDeletionSummary,
    createIpcHandler({
      channel: IPC_CHANNELS.projectsGetDeletionSummary,
      argsSchema: projectsGetDeletionSummaryArgsSchema,
      policy,
      run: ([input]) => projectService.getDeletionSummary(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.projectsDelete,
    createIpcHandler({
      channel: IPC_CHANNELS.projectsDelete,
      argsSchema: projectsDeleteArgsSchema,
      policy,
      run: ([input]) => projectService.delete(input)
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.workspaceGet,
    createIpcHandler({
      channel: IPC_CHANNELS.workspaceGet,
      argsSchema: workspaceGetArgsSchema,
      policy,
      run: () => workspaceSettingsService.get()
    })
  )

  ipcMain.handle(
    IPC_CHANNELS.workspaceSave,
    createIpcHandler({
      channel: IPC_CHANNELS.workspaceSave,
      argsSchema: workspaceSaveArgsSchema,
      policy,
      run: ([settings]) => workspaceSettingsService.save(settings)
    })
  )

  // 終了前の保存問い合わせへの応答。未知・期限切れのrequestIdは無視する。
  ipcMain.handle(
    IPC_CHANNELS.workspaceFlushResult,
    createIpcHandler({
      channel: IPC_CHANNELS.workspaceFlushResult,
      argsSchema: workspaceFlushResultArgsSchema,
      policy,
      run: ([result]) => {
        if (!deps.flushRequester.resolve(result.requestId, result.outcome, result.draftKind)) {
          console.warn(`[ipc] 対応する保存問い合わせがありません: ${result.requestId}`)
        }
        return null
      }
    })
  )
}
