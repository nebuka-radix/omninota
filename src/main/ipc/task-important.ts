import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { tasksSetImportantArgsSchema } from '../../shared/validation/tasks'
import type { createTaskImportantService } from '../services/task-important-service'
import { createIpcHandler, type SenderPolicy } from './handler'
export function registerTaskImportantHandler(deps: { policy: SenderPolicy; service: ReturnType<typeof createTaskImportantService> }): void {
  ipcMain.handle(IPC_CHANNELS.tasksSetImportant, createIpcHandler({
    channel: IPC_CHANNELS.tasksSetImportant, argsSchema: tasksSetImportantArgsSchema,
    policy: deps.policy, run: ([input]) => deps.service.set(input)
  }))
}
