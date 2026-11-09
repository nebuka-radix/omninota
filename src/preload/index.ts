// sandbox付きPreload: requireできるのはelectronだけ。
// 用途別の関数だけを公開し、ipcRendererそのものや汎用invokeは公開しない。
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type GtdApi } from '../shared/contracts/ipc'

const api: GtdApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo)
  },
  tasks: {
    // 入力の検証はMain側で行う。ここでは引数を1つだけ転送する。
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksCreate, input),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.tasksList),
    updateTitle: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksUpdateTitle, input),
    setCompleted: (input) => ipcRenderer.invoke(IPC_CHANNELS.tasksSetCompleted, input)
  },
  workspace: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceGet),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSave, settings),
    // このチャンネルだけを購読する（任意チャンネルの購読口は公開しない）。
    onFlushRequest: (listener) => {
      const handler = (_event: unknown, requestId: unknown) => {
        if (typeof requestId === 'string') listener(requestId)
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
