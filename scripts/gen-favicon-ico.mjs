/**
 * Generate a real 32x32 favicon.ico (single 32-bit BGRA image, uncompressed BMP
 * DIB inside an ICO container) so `/favicon.ico` resolves to an actual icon
 * instead of the SPA's index.html (soft-404). Mirrors public/favicon.svg: an
 * indigo rounded square with a white diamond.
 *
 * Run: node scripts/gen-favicon-ico.mjs  (writes apps/web/public/favicon.ico)
 * Pure Node — no deps, no zlib (BMP is raw), so it is reproducible anywhere.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const S = 32
const R = 7 // corner radius, matches favicon.svg rx
const INDIGO = [0x39, 0x58, 0xd1] // #3958D1 (r,g,b)
const WHITE = [0xff, 0xff, 0xff]

/** Inside the rounded-rect body? (corner-radius test) */
function inRoundedRect(x, y) {
  const nx = x + 0.5
  const ny = y + 0.5
  const cxs = [R, S - R]
  const cys = [R, S - R]
  // Corner regions
  for (const cx of cxs) {
    for (const cy of cys) {
      const inCornerBox = (cx === R ? nx < R : nx > S - R) && (cy === R ? ny < R : ny > S - R)
      if (inCornerBox) {
        const dx = nx - cx
        const dy = ny - cy
        return dx * dx + dy * dy <= R * R
      }
    }
  }
  return true
}

/** Inside the centered diamond |x-16|+|y-16| <= 8.5 (matches the SVG path). */
function inDiamond(x, y) {
  const nx = x + 0.5
  const ny = y + 0.5
  return Math.abs(nx - 16) + Math.abs(ny - 16) <= 8.5
}

// BGRA rows, bottom-up (BMP convention).
const pixels = Buffer.alloc(S * S * 4)
for (let y = 0; y < S; y++) {
  const row = S - 1 - y // bottom-up
  for (let x = 0; x < S; x++) {
    const o = (row * S + x) * 4
    if (!inRoundedRect(x, y)) {
      pixels[o] = 0
      pixels[o + 1] = 0
      pixels[o + 2] = 0
      pixels[o + 3] = 0 // transparent outside the badge
      continue
    }
    const c = inDiamond(x, y) ? WHITE : INDIGO
    pixels[o] = c[2] // B
    pixels[o + 1] = c[1] // G
    pixels[o + 2] = c[0] // R
    pixels[o + 3] = 0xff // A
  }
}

// BITMAPINFOHEADER (40 bytes). Height is doubled (XOR + AND masks) per ICO spec.
const header = Buffer.alloc(40)
header.writeUInt32LE(40, 0) // biSize
header.writeInt32LE(S, 4) // biWidth
header.writeInt32LE(S * 2, 8) // biHeight (image + mask)
header.writeUInt16LE(1, 12) // biPlanes
header.writeUInt16LE(32, 14) // biBitCount
header.writeUInt32LE(0, 16) // biCompression = BI_RGB
header.writeUInt32LE(pixels.length, 20) // biSizeImage

// AND mask: 1 bit/pixel, rows padded to 32-bit. All zero → alpha channel decides.
const andRowBytes = Math.ceil(S / 32) * 4
const andMask = Buffer.alloc(andRowBytes * S) // zeros

const dib = Buffer.concat([header, pixels, andMask])

// ICONDIR (6) + ICONDIRENTRY (16)
const iconDir = Buffer.alloc(6)
iconDir.writeUInt16LE(0, 0) // reserved
iconDir.writeUInt16LE(1, 2) // type = icon
iconDir.writeUInt16LE(1, 4) // count

const entry = Buffer.alloc(16)
entry.writeUInt8(S, 0) // width
entry.writeUInt8(S, 1) // height
entry.writeUInt8(0, 2) // color count (0 = >=256)
entry.writeUInt8(0, 3) // reserved
entry.writeUInt16LE(1, 4) // planes
entry.writeUInt16LE(32, 6) // bit count
entry.writeUInt32LE(dib.length, 8) // bytes in resource
entry.writeUInt32LE(6 + 16, 12) // offset from file start

const ico = Buffer.concat([iconDir, entry, dib])
const out = fileURLToPath(new URL('../apps/web/public/favicon.ico', import.meta.url))
writeFileSync(out, ico)
console.log(`wrote ${out} (${ico.length} bytes)`)
