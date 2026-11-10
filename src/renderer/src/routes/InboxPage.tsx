import { useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import { Inbox } from 'lucide-react'
import { Page } from '../components/Page'
import { TaskScopeView } from '../features/tasks/TaskScopeView'
import { INBOX_SCOPE } from '../features/tasks/task-scope'
import { DEFAULT_TASK_SORTING } from '../features/tasks/task-table'

// Inbox: プロジェクトに属さないタスク（フェーズ5.2の暫定定義。「未整理」と同じ意味とは扱わない。
// Next Actionsなどの分類を導入する時に改めて設計する）。
export function InboxPage() {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_TASK_SORTING)
  return (
    // フェーズ5.7: タイトル行・説明行は表示しない（見出しは読み上げ用に残す）
    <Page title="Inbox" icon={Inbox} fill titleHidden>
      <TaskScopeView
        scope={INBOX_SCOPE}
        scopeLabel="Inbox: プロジェクトに属さないタスク"
        addTargetLabel="追加先: Inbox（プロジェクトに属さないタスク）"
        sorting={sorting}
        onSortingChange={setSorting}
      />
    </Page>
  )
}
