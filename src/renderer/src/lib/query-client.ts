import { MutationCache, QueryClient } from '@tanstack/react-query'

// Queryのキャッシュは表示用。永続データの正本はMain側のSQLiteとする。
// Routerの読み込み処理（起動時の画面復元）からも使うため、モジュールとして共有する。
// フェーズ6: タスク・プロジェクト・マイルストンの更新（期限・完了・削除・非表示化・名前・所属など）に成功したら、
// Summary Review の取得結果を古いものとして扱う（表示中なら取り直す。表示していなければ次に開いた時に取り直す）。
const SUMMARY_SOURCES: readonly unknown[] = ['tasks', 'projects', 'milestones']

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ローカルIPCなのでウィンドウのフォーカスごとに再取得しない。
      refetchOnWindowFocus: false,
      retry: false
    }
  },
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      if (SUMMARY_SOURCES.includes(mutation.options.mutationKey?.[0])) {
        void queryClient.invalidateQueries({ queryKey: ['summary'] })
      }
    }
  })
})
