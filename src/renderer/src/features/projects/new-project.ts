import { isWorkspaceRoute, type WorkspaceRoute } from '../../../../shared/contracts/workspace'

// 新規プロジェクトの画面（フェーズ5.5）。プロジェクトは名前を保存した時に作成し、この画面を開いただけではDBに作らない。
export const NEW_PROJECT_PATH = '/projects/new'

// 作成前にキャンセルした時に戻る画面（NEW PROJECT を押した時の画面）。保存しない画面内の状態。
let returnRoute: WorkspaceRoute = '/projects'

export function rememberNewProjectReturn(pathname: string): void {
  if (isWorkspaceRoute(pathname)) returnRoute = pathname
}

export function newProjectReturnRoute(): WorkspaceRoute {
  return returnRoute
}
