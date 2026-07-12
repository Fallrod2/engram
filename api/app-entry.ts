/**
 * esbuild bundle entry: `vercel.json`'s buildCommand bundles this file (and the
 * whole server app it re-exports) into `api/app.bundle.mjs`, a single
 * self-contained ESM file. Bundling sidesteps Vercel's per-file Node ESM
 * transform, which cannot resolve the repo's extensionless TS imports.
 */
export { app } from '../apps/server/src/app'
