/**
 * Generate the raster app icons from the same vector motif as public/favicon.svg
 * (an indigo rounded square with a white diamond), so nothing soft-404s to the
 * SPA's index.html and iOS gets a real PNG home-screen icon:
 *   - favicon.ico          32×32 BGRA BMP inside an ICO container
 *   - apple-touch-icon.png 180×180 full-bleed indigo PNG (iOS ignores the SVG for
 *     `apple-touch-icon` and rounds the corners itself, so it is drawn edge-to-edge)
 *
 * Run: node scripts/gen-favicon-ico.mjs
 * Pure Node — zlib is built in (used for the PNG's IDAT) — reproducible anywhere.
 */
import { deflateSync } from 'node:zlib'
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

/* -------------------------------------------------------------------- PNG -- */
// apple-touch-icon.png: 180×180, full-bleed indigo, white diamond centred at the
// same proportion as the 32px badge (half-extent 8.5/16 of the half-size).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A PNG chunk: length + type + data + CRC32(type+data). */
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const AT = 180
const half = AT / 2
const diamondExtent = (half * 8.5) / 16 // same proportion as the 32px badge

// RGBA scanlines, each prefixed with a filter byte (0 = None).
const stride = AT * 4
const raw = Buffer.alloc((stride + 1) * AT)
for (let y = 0; y < AT; y++) {
  const rowStart = y * (stride + 1)
  raw[rowStart] = 0 // filter: None
  for (let x = 0; x < AT; x++) {
    const nx = x + 0.5
    const ny = y + 0.5
    const white = Math.abs(nx - half) + Math.abs(ny - half) <= diamondExtent
    const c = white ? WHITE : INDIGO
    const o = rowStart + 1 + x * 4
    raw[o] = c[0]
    raw[o + 1] = c[1]
    raw[o + 2] = c[2]
    raw[o + 3] = 0xff // fully opaque; iOS masks the corners itself
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(AT, 0) // width
ihdr.writeUInt32BE(AT, 4) // height
ihdr.writeUInt8(8, 8) // bit depth
ihdr.writeUInt8(6, 9) // colour type: RGBA
ihdr.writeUInt8(0, 10) // compression
ihdr.writeUInt8(0, 11) // filter
ihdr.writeUInt8(0, 12) // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
])

const pngOut = fileURLToPath(new URL('../apps/web/public/apple-touch-icon.png', import.meta.url))
writeFileSync(pngOut, png)
console.log(`wrote ${pngOut} (${png.length} bytes)`)
