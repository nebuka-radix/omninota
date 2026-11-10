import type { ReactNode } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'
import { Trash2 } from 'lucide-react'

// 削除の確認ダイアログ（フェーズ5.6。タスク・マイルストン・プロジェクトで共通）。
// - 既定のフォーカスは「キャンセル」（Enter の押し間違いで削除しない）。Esc・外側のクリックはキャンセル（削除中は閉じない）。
// - 削除中は両方のボタンを無効にして二重実行を防ぐ。失敗時は閉じずに理由を表示する（対象・入力は変えない）。
// - notice: 確認内容を取り直した時の説明（件数が変わった時など）
// - ポータル内のキー操作が画面側（一覧のキー操作など）へ伝わらないようにする
export function ConfirmDeleteDialog({
  open,
  title,
  children,
  confirmLabel,
  pending,
  error,
  notice,
  onConfirm,
  onCancel,
  testId
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  pending: boolean
  error: string | null
  notice?: string | null
  onConfirm: () => void
  onCancel: () => void
  testId: string
}) {
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onCancel()
      }}
      aria-labelledby={`${testId}-title`}
      aria-describedby={`${testId}-description`}
      onKeyDown={(event) => event.stopPropagation()}
      data-testid={testId}
    >
      <DialogTitle id={`${testId}-title`} sx={{ fontSize: 15 }}>
        {title}
      </DialogTitle>
      <DialogContent id={`${testId}-description`} sx={{ fontSize: 13 }}>
        {notice && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }} data-testid={`${testId}-notice`}>
            {notice}
          </Alert>
        )}
        {children}
        {error && (
          <Alert severity="error" variant="outlined" sx={{ mt: 2 }} role="alert" data-testid={`${testId}-error`}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={pending} autoFocus data-testid={`${testId}-cancel`}>
          キャンセル
        </Button>
        <Button
          onClick={onConfirm}
          disabled={pending}
          color="error"
          variant="contained"
          startIcon={<Trash2 size={14} aria-hidden />}
          data-testid={`${testId}-confirm`}
        >
          {pending ? '削除中…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
