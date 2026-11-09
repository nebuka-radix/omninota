import type { QueryClient } from '@tanstack/react-query'
import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect
} from '@tanstack/react-router'
import { DEFAULT_WORKSPACE_SETTINGS, projectIdFromRoute } from '../../shared/contracts/workspace'
import { projectListQueryOptions } from './features/projects/project-queries'
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
    const projectId = projectIdFromRoute(target)
    if (projectId) {
      // 保存済みのプロジェクトが存在しなければ /projects へ。取得に失敗した場合は判定せず、そのまま開く
      // （画面側で取得失敗として表示する。存在しないとは扱わない）
      let exists = true
      try {
        const projects = await context.queryClient.ensureQueryData(projectListQueryOptions)
        exists = projects.some((project) => project.id === projectId)
      } catch {
        exists = true
      }
      if (!exists) throw redirect({ to: '/projects', replace: true })
      throw redirect({ to: '/projects/$projectId', params: { projectId }, replace: true })
    }
    if (target === '/inbox' || target === '/settings' || target === '/projects') {
      throw redirect({ to: target, replace: true })
    }
    throw redirect({ to: '/inbox', replace: true })
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
