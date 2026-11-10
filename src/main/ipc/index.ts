import { ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '../../shared/contracts/ipc'
import { appGetInfoArgsSchema } from '../../shared/validation/app'
import {
  milestonesCreateArgsSchema,
  milestonesListArgsSchema,
  milestonesRenameArgsSchema
} from '../../shared/validation/milestones'
import {
  projectsCreateArgsSchema,
  projectsListArgsSchema,
  projectsRenameArgsSchema,
  projectsSetCompletedArgsSchema
} from '../../shared/validation/projects'
import {
  tasksCreateArgsSchema,
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
import type { TaskService } from '../services/task-service'
import type { WorkspaceSettingsService } from '../services/workspace-settings-service'
import { createIpcHandler, type SenderPolicy } from './handler'

// チャンネルごとに用途を限定したハンドラーだけを登録する（汎用の転送口は作らない）。
// タスクAPIは、DBのマイグレーション完了後に呼び出すこと。
export function registerIpcHandlers(deps: {
  policy: SenderPolicy
  getAppInfo: () => AppInfo
  taskService: TaskService
  projectService: ProjectService
  milestoneService: MilestoneService
  workspaceSettingsService: WorkspaceSettingsService
  flushRequester: FlushRequester
}): void {
  const { policy, taskService, projectService, milestoneService, workspaceSettingsService } = deps

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
