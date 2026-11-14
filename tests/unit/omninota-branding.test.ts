import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_IDENTITY } from '../../src/shared/app-identity'
import { resolveDatabaseFile, resolveUserDataDir } from '../../src/main/infrastructure/app-paths'

describe('omninota branding and data continuity', () => {
  it('uses the requested lowercase display and package name', () => {
    expect(APP_IDENTITY.displayName).toBe('omninota')
    expect(APP_IDENTITY.packageName).toBe('omninota')
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.name).toBe('omninota')
    expect(pkg.productName).toBe('omninota')
    expect(pkg.build.productName).toBe('omninota')
    expect(pkg.build.executableName).toBe('omninota')
    expect(pkg.build.mac.executableName).toBe('omninota')
    expect(pkg.build.appId).toBe(APP_IDENTITY.appId)
  })
  it('keeps the existing database directories and filename', () => {
    expect(APP_IDENTITY.userDataDirName).toBe('GTD')
    expect(APP_IDENTITY.devUserDataDirName).toBe('GTD-dev')
    const root = join('example', 'Application Support')
    expect(resolveDatabaseFile(resolveUserDataDir({ isPackaged: true, appDataDir: root }))).toBe(join(root, 'GTD', 'gtd.sqlite'))
    expect(resolveDatabaseFile(resolveUserDataDir({ isPackaged: false, appDataDir: root }))).toBe(join(root, 'GTD-dev', 'gtd.sqlite'))
  })
  it('uses the new HTML title and the shared sidebar identity', () => {
    expect(readFileSync('src/renderer/index.html', 'utf8')).toContain('<title>omninota</title>')
    const sidebar = readFileSync('src/renderer/src/layouts/shell/NavigationPane.tsx', 'utf8')
    expect(sidebar).toContain('title={APP_IDENTITY.displayName}')
    expect(sidebar).not.toContain('title="GTD"')
  })
})
