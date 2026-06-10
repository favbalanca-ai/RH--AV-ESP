// Service Worker — FAV Pgto
// Necessário para Web Share Target API

const CACHE = 'fav-pgto-v1'
const ASSETS = ['/RH--AV-ESP/pagar.html', '/RH--AV-ESP/manifest.json']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim())
})

// Web Share Target — recebe o arquivo compartilhado
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Intercepta POST do share target
  if (e.request.method === 'POST' && url.pathname.includes('pagar.html')) {
    e.respondWith((async () => {
      const formData = await e.request.formData()
      const file     = formData.get('comprovante')
      const token    = url.searchParams.get('t') || ''

      // Guarda o arquivo no cache temporário para o pagar.html ler
      if (file) {
        const cache = await caches.open('share-target-temp')
        await cache.put('shared-file', new Response(file, {
          headers: { 'Content-Type': file.type, 'X-File-Name': file.name }
        }))
      }

      // Redireciona para pagar.html com token preservado
      const redirect = token
        ? `/RH--AV-ESP/pagar.html?t=${token}&shared=1`
        : `/RH--AV-ESP/pagar.html?shared=1`

      return Response.redirect(redirect, 303)
    })())
    return
  }

  // Fetch normal
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request)).catch(() => fetch(e.request))
  )
})
