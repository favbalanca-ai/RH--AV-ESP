// Service Worker — FAV Pgto
// Necessário para Web Share Target API

const CACHE = 'fav-pgto-v2'
const ASSETS = ['/RH--AV-ESP/pagar.html', '/RH--AV-ESP/manifest.json']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  // Cache velho com nome velho fica servindo página velha para sempre.
  e.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(
        nomes.filter(n => n !== CACHE && n !== 'share-target-temp')
             .map(n => caches.delete(n))))
      .then(() => clients.claim())
  )
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

  // Só GET passa pelo cache. POST/PUT nunca são cacheáveis.
  if (e.request.method !== 'GET') return

  // Cache primeiro guarda a página velha para sempre: o app corrigido nunca
  // chega ao usuário e ele fica olhando um defeito já consertado. Rede
  // primeiro, cache só quando a rede falha — aí o cache vira o que devia
  // ser desde o começo: o modo offline, não a fonte da verdade.
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copia = resp.clone()
          caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {})
        }
        return resp
      })
      .catch(() => caches.match(e.request).then(r => r || Promise.reject(new Error('offline'))))
  )
})
