// sandbox付きPreload: requireできるのはelectronだけ。
// 用途別の関数だけを公開し、ipcRendererそのものや汎用invokeは公開しない。
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type GtdApi } from '../shared/contracts/ipc'

const api: GtdApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
    setCompact: (compact) => ipcRenderer.invoke(IPC_CHANNELS.appSetCompact, compact)
  },
  tasks: {
    // 入力の検証はMain側で行う。ここでは引数を1つだけ転送する。
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksCreate, input),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.tasksList),
    updateTitle: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksUpdateTitle, input),
    setCompleted: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetCompleted, input),
    setAssignment: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetAssignment, input),
    delete: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksDelete, input),
    assignFromInbox: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksAssignFromInbox, input),
    deleteMany: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksDeleteMany, input),
    reorderInMilestone: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksReorderInMilestone, input),
    setDue: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetDue, input),
    setDayMany: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetDayMany, input),
    setFavorite: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetFavorite, input)
  },
  summary: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.summaryGet),
    today: () => ipcRenderer.invoke(IPC_CHANNELS.summaryToday)
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.projectsList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsCreate, input),
    rename: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsRename, input),
    setCompleted: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsSetCompleted, input),
    setFavorite: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsSetFavorite, input),
    getDeletionSummary: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsGetDeletionSummary, input),
    delete: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectsDelete, input)
  },
  milestones: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.milestonesList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.milestonesCreate, input),
    rename: (input) => ipcRenderer.invoke(IPC_CHANNELS.milestonesRename, input),
    getDeletionSummary: (input) => ipcRenderer.invoke(IPC_CHANNELS.milestonesGetDeletionSummary, input),
    delete: (input) => ipcRenderer.invoke(IPC_CHANNELS.milestonesDelete, input),
    reorder: (input) => ipcRenderer.invoke(IPC_CHANNELS.milestonesReorder, input)
  },
  workspace: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceGet),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSave, settings),
    // このチャンネルだけを購読する（任意チャンネルの購読口は公開しない）。
    onFlushRequest: (listener) => {
      // Mainから届く値だけを、形を確かめてから渡す
      const handler = (_event: unknown, request: unknown) => {
        if (typeof request !== 'object' || request === null) return
        const { requestId, draftAction } = request as Record<string, unknown>
        if (typeof requestId !== 'string') return
        if (draftAction !== 'check' && draftAction !== 'save' && draftAction !== 'discard') return
        listener({ requestId, draftAction })
      }
      ipcRenderer.on(IPC_CHANNELS.workspaceFlushRequest, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.workspaceFlushRequest, handler)
      }
    },
    reportFlushResult: (result) => ipcRenderer.invoke(IPC_CHANNELS.workspaceFlushResult, result)
  }
}

contextBridge.exposeInMainWorld('gtd', api)
