import { QueryClient } from '@tanstack/react-query'

// Queryのキャッシュは表示用。永続データの正本はMain側のSQLiteとする。
// Routerの読み込み処理（起動時の画面復元）からも使うため、モジュールとして共有する。
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ローカルIPCなのでウィンドウのフォーカスごとに再取得しない。
      refetchOnWindowFocus: false,
      retry: false
    }
  }
})
