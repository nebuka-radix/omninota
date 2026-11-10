import type { QueryClient } from '@tanstack/react-query'
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect
} from '@tanstack/react-router'
import { DEFAULT_WORKSPACE_SETTINGS } from '../../shared/contracts/workspace'
import { projectListQueryOptions } from './features/projects/project-queries'
import { resolveStartupTarget } from './features/projects/project-route'
import { workspaceSettingsQueryOptions } from './features/workspace/workspace-queries'
import { AppFrame } from './layouts/AppFrame'
import { queryClient } from './lib/query-client'
import { InboxPage } from './routes/InboxPage'
import { ProjectPage, ProjectsIndexPage } from './routes/ProjectsPage'
import { NotFoundPage } from './routes/NotFoundPage'
import { SettingsPage } from './routes/SettingsPage'

// コードベースのルート定義。ビルド後はfile://で読み込むため、履歴はハッシュ方式とする。
const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: AppFrame,
  notFoundComponent: NotFoundPage
})

// ルート未指定（'/'）で起動した場合だけ、保存済みの最後の画面へ移動する。
// 明示的なルート（#/settings など）が指定されていればそれを優先する。
// 保存値はMain側で検証済みで、未知の画面はInboxに正規化される。読み込み失敗時もInboxへ。
// 保存済みのプロジェクトが存在しなければ /projects へ（判定は resolveStartupTarget）。
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    let target = DEFAULT_WORKSPACE_SETTINGS.lastRoute
    try {
      target = (await context.queryClient.ensureQueryData(workspaceSettingsQueryOptions)).lastRoute
    } catch {
      // 読み込み失敗はAppFrame側で表示する
    }
    const next = await resolveStartupTarget(target, () => context.queryClient.ensureQueryData(projectListQueryOptions))
    if (next.to === '/projects/$projectId') {
      throw redirect({ to: next.to, params: { projectId: next.projectId }, replace: true })
    }
    throw redirect({ to: next.to, replace: true })
  }
})

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsIndexPage
})

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: function ProjectRouteComponent() {
    const { projectId } = projectRoute.useParams()
    return <ProjectPage projectId={projectId} />
  }
})

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxPage
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage
})

const routeTree = rootRoute.addChildren([indexRoute, inboxRoute, settingsRoute, projectsRoute, projectRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { queryClient }
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
