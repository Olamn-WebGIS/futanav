import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import sharp from 'sharp'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const projectRoot = import.meta.dirname
const base = process.env.GITHUB_ACTIONS ? '/futanav/' : '/'
const buildingGeoJsonPath = resolve(projectRoot, 'public/data/Futa Buildings.geojson')
const photoSourceDirectory = resolve(projectRoot, 'ground thruthing')
const photoRoutePrefix = '/building-photos/'

async function getBuildingPhotoNames(): Promise<string[]> {
  const geoJson = JSON.parse(await readFile(buildingGeoJsonPath, 'utf8')) as {
    features?: Array<{ properties?: { Photo?: unknown } }>
  }

  return [...new Set((geoJson.features ?? [])
    .map((feature) => feature.properties?.Photo)
    .filter((photo): photo is string => typeof photo === 'string' && Boolean(photo.trim()))
    .map((photo) => basename(photo.trim()))) ]
}

function buildingPhotoPlugin(): Plugin {
  const optimizedImages = new Map<string, Promise<Buffer>>()
  const getOptimizedPhoto = (filename: string) => {
    const photo = basename(filename)
    let image = optimizedImages.get(photo)
    if (!image) {
      image = sharp(join(photoSourceDirectory, photo))
        .rotate()
        .resize({ width: 1200, height: 900, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer()
      optimizedImages.set(photo, image)
    }
    return image
  }

  return {
    name: 'futa-building-photos',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (!pathname.startsWith(photoRoutePrefix)) return next()
        try {
          const encodedFilename = pathname.slice(photoRoutePrefix.length).replace(/\.webp$/, '')
          const filename = basename(decodeURIComponent(encodedFilename))
          if (!extname(filename) || !(await getBuildingPhotoNames()).includes(filename)) {
            response.statusCode = 404
            response.end('Building photo not found')
            return
          }
          const image = await getOptimizedPhoto(filename)
          response.setHeader('Content-Type', 'image/webp')
          response.setHeader('Cache-Control', 'public, max-age=86400')
          response.end(image)
        } catch {
          response.statusCode = 404
          response.end('Building photo not found')
        }
      })
    },
    async generateBundle() {
      for (const filename of await getBuildingPhotoNames()) {
        const fileName = `building-photos/${filename}.webp`
        this.emitFile({ type: 'asset', fileName, source: await getOptimizedPhoto(filename) })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    buildingPhotoPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-icon.svg'],
      manifest: {
        name: 'FUTA NAV — Campus Wayfinding',
        short_name: 'FUTA NAV',
        description: 'Find campus buildings and walking routes at the Federal University of Technology, Akure.',
        theme_color: '#f5f7f1',
        background_color: '#f5f7f1',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}pwa-icon.svg`, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: `${base}pwa-icon.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: `${base}pwa-icon.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,json,geojson}'],
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.geojson$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'futa-campus-data',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/building-photos\/.*\.webp$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'futa-building-photos',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
