export type ProjectTreeDisplayMode = 'PROJECT' | 'MILESTONE' | 'ALL' | 'CUSTOM'

/** 隠れた子ノードの展開フラグではなく、現在の表示階層を判定する。 */
export function projectTreeDisplayMode(
  projectIds: readonly string[],
  milestones: readonly { id: string; projectId: string | null }[],
  expandedNodes: ReadonlySet<string>,
  preferred: ProjectTreeDisplayMode = 'MILESTONE'
): ProjectTreeDisplayMode {
  if (projectIds.length === 0) return preferred === 'CUSTOM' ? 'MILESTONE' : preferred
  const openedProjects = projectIds.filter((id) => expandedNodes.has(`project:${id}`)).length
  if (openedProjects === 0) return 'PROJECT'
  if (openedProjects !== projectIds.length) return 'CUSTOM'
  const ids = new Set(projectIds)
  const children = milestones.filter((item) => item.projectId !== null && ids.has(item.projectId))
  // マイルストン0件ではMILESTONEとALLが同じ表示になるため、明示操作を優先する。
  if (children.length === 0) return preferred === 'ALL' ? 'ALL' : 'MILESTONE'
  const openedMilestones = children.filter((item) => expandedNodes.has(`milestone:${item.id}`)).length
  if (openedMilestones === 0) return 'MILESTONE'
  if (openedMilestones === children.length) return 'ALL'
  return 'CUSTOM'
}
