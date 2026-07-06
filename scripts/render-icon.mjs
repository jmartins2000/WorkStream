/**
 * Renders build/icon.svg → build/icon.png (1024px, TRANSPARENT background)
 * and regenerates build/icon.icns plus the renderer's copy of the logo.
 *
 * Why this exists: qlmanage (the quick-and-dirty macOS rasterizer) flattens
 * transparency to white, which put a white square behind the squircle in the
 * Dock, README and topbar. sharp preserves alpha.
 *
 * Usage: node scripts/render-icon.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import sharp from 'sharp'

const SVG = 'build/icon.svg'
const PNG = 'build/icon.png'

await sharp(SVG, { density: 300 }).resize(1024, 1024).png().toFile(PNG)
console.log('rendered', PNG, '(with alpha)')

// icns: macOS iconset from the master png.
rmSync('build/icon.iconset', { recursive: true, force: true })
mkdirSync('build/icon.iconset', { recursive: true })
for (const size of [16, 32, 128, 256, 512]) {
  await sharp(PNG).resize(size, size).png().toFile(`build/icon.iconset/icon_${size}x${size}.png`)
  await sharp(PNG)
    .resize(size * 2, size * 2)
    .png()
    .toFile(`build/icon.iconset/icon_${size}x${size}@2x.png`)
}
execFileSync('iconutil', ['-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns'])
rmSync('build/icon.iconset', { recursive: true, force: true })
console.log('rendered build/icon.icns')

// Keep the renderer's topbar copy in sync.
copyFileSync(PNG, 'src/renderer/src/assets/icon.png')
console.log('synced src/renderer/src/assets/icon.png')
