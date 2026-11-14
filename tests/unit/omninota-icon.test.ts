import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('omninota macOS icon', () => {
  it('sets the application icon without changing its identity', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.productName).toBe('omninota')
    expect(pkg.build.mac.icon).toBe('resources/omninota.icns')
  })
  it('keeps a square source PNG and a valid ICNS container', () => {
    const png = readFileSync('resources/omninota-icon.png')
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20))
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(512)
    const icns = readFileSync('resources/omninota.icns')
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
  })
})
