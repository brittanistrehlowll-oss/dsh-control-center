import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const JINGXI_ASSET_ROUTE = '/plugins/dsh-jingxi/assets'
const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const CONTENT_TYPES = Object.freeze({
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
})

function isWithin(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${candidate.includes('\\') ? '\\' : '/'}`))
}

function safeAssetPath(pathname, assetRoot) {
  if (!pathname.startsWith(`${JINGXI_ASSET_ROUTE}/`)) return undefined
  let encoded
  try {
    encoded = pathname.slice(JINGXI_ASSET_ROUTE.length + 1).split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    return undefined
  }
  if (encoded.length === 0 || encoded.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) return undefined
  if (encoded[0].toLowerCase() !== 'icons') return undefined
  const extension = extname(encoded[encoded.length - 1]).toLowerCase()
  if (CONTENT_TYPES[extension] === undefined) return undefined
  const absolute = resolve(assetRoot, ...encoded)
  return isWithin(assetRoot, absolute) ? absolute : undefined
}

/**
 * Serve only the package's transparent icon library and its manifest.
 * Static assets are non-sensitive; lifecycle endpoints keep the stricter
 * loopback + same-origin trust fence in dsh-update.js.
 */
export function createAssetRouteHandler({ assetRoot = ASSET_ROOT } = {}) {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
    const absolute = safeAssetPath(pathname, assetRoot)
    if (absolute === undefined || !isWithin(resolve(assetRoot, 'icons'), absolute)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }
    try {
      const info = await stat(absolute)
      if (!info.isFile()) throw new Error('not a file')
      const type = CONTENT_TYPES[extname(absolute).toLowerCase()]
      const headers = {
        'content-type': type,
        'content-length': String(info.size),
        'cache-control': 'no-cache',
      }
      const body = req.method === 'HEAD' ? undefined : await readFile(absolute)
      res.writeHead(200, headers)
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  }
}
