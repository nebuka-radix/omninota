import { ButtonBase } from '@mui/material'
import { SquareExclamationPoint } from 'lucide-react'
import { IMPORTANT_OFF, IMPORTANT_ON } from '../features/tasks/important-presentation'
import { vscodeColors } from '../theme'
export function TaskImportantButton({ title, important, disabled, onToggle }: {
  title: string; important: boolean; disabled?: boolean; onToggle?: () => void
}) {
  return <ButtonBase tabIndex={-1} aria-pressed={important} aria-label={`「${title}」の重要を${important ? '解除' : '設定'}`}
    title={important ? '重要（押すと解除）' : '重要に設定'} disabled={disabled || !onToggle}
    data-testid="task-important" data-important={important ? 'true' : 'false'}
    onClick={onToggle} sx={{ width: 20, height: 22, minWidth: 20, flexShrink: 0, pointerEvents: 'auto', borderRadius: 0.5,
      color: important ? IMPORTANT_ON : IMPORTANT_OFF,
      '&:hover': { bgcolor: vscodeColors.listHover, color: important ? IMPORTANT_ON : '#a0a0a0' },
      '&.Mui-disabled': { opacity: 0.4 } }}>
    <SquareExclamationPoint size={16} aria-hidden strokeWidth={important ? 3 : 1.25} />
  </ButtonBase>
}
