/* Velvet Ledger offline fallback.
   Deliberately NEVER caches authenticated API, private messages, proofs,
   contracts, dynamic dashboard HTML or user-generated story content. */
const CACHE="vl-public-offline-v1"
const ALLOWED=["/offline","/icons/icon.svg","/manifest.webmanifest"]
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ALLOWED)))
  self.skipWaiting()
})
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith("vl-public-offline-")&&key!==CACHE).map(key=>caches.delete(key))
  )))
  self.clients.claim()
})
self.addEventListener("fetch",event=>{
  const request=event.request
  if(request.method!=="GET"||request.mode!=="navigate")return
  event.respondWith(fetch(request).catch(async()=>{
    const cache=await caches.open(CACHE)
    return (await cache.match("/offline"))||Response.error()
  }))
})
