import { describe, expect, it } from 'vitest'
import { projectTreeDisplayMode } from '../src/renderer/src/features/projects/project-tree-display'
const projects = ['p1', 'p2']
const milestones = [{ id: 'm1', projectId: 'p1' }, { id: 'm2', projectId: 'p2' }]
const state = (...keys: string[]) => new Set(keys)
describe('project tree display mode', () => {
  it('PROJECT: all projects closed, even if hidden children are open', () => {
    expect(projectTreeDisplayMode(projects, milestones, state())).toBe('PROJECT')
    expect(projectTreeDisplayMode(projects, milestones, state('milestone:m1'))).toBe('PROJECT')
  })
  it('MILESTONE: projects open and milestones closed', () => {
    expect(projectTreeDisplayMode(projects, milestones, state('project:p1', 'project:p2'))).toBe('MILESTONE')
  })
  it('ALL: all levels open', () => {
    expect(projectTreeDisplayMode(projects, milestones, state('project:p1', 'project:p2', 'milestone:m1', 'milestone:m2'))).toBe('ALL')
  })
  it('CUSTOM: mixed project or milestone expansion', () => {
    expect(projectTreeDisplayMode(projects, milestones, state('project:p1'))).toBe('CUSTOM')
    expect(projectTreeDisplayMode(projects, milestones, state('project:p1', 'project:p2', 'milestone:m1'))).toBe('CUSTOM')
  })
  it('ignores milestones of projects outside the visible list', () => {
    expect(projectTreeDisplayMode(projects, [...milestones, { id: 'hidden', projectId: 'p3' }],
      state('project:p1', 'project:p2', 'milestone:m1', 'milestone:m2'))).toBe('ALL')
  })
  it('uses the explicit preset when no child milestones exist', () => {
    expect(projectTreeDisplayMode(['p1'], [], state('project:p1'), 'ALL')).toBe('ALL')
    expect(projectTreeDisplayMode(['p1'], [], state('project:p1'), 'MILESTONE')).toBe('MILESTONE')
  })
})
