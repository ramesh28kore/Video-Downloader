(() => {
  const reported = new WeakMap()
  const listeners = new WeakMap()
  const REPORT_INTERVAL_MS = 2_500
  const direct = /\.(mp4|webm|ogg|ogv)(?:$|[?#])/i
  const manifest = /\.(m3u8|mpd)(?:$|[?#])/i

  function classify(url, type) {
    if (!/^https?:/i.test(url)) return null
    if (manifest.test(url)) return manifest.exec(url)[1].toLowerCase() === 'm3u8' ? 'hls' : 'dash'

    const normalizedType = (type || '').toLowerCase()
    if (/application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)/.test(normalizedType)) {
      return normalizedType.includes('dash') ? 'dash' : 'hls'
    }

    // URLs without a filename extension are common for CDN-backed progressive
    // videos. That is safe to accept only because this URL came directly from
    // a currently playing HTMLVideoElement, never from a general page request.
    return direct.test(url) || !normalizedType || normalizedType.startsWith('video/') ? 'direct' : null
  }

  function source(video) {
    const sourceNode = video.querySelector('source[src]')
    const declaredType = video.getAttribute('type') || sourceNode?.getAttribute('type') || ''
    const candidates = [
      { url: video.currentSrc, type: declaredType },
      { url: video.src, type: declaredType },
      { url: sourceNode?.src || '', type: sourceNode?.getAttribute('type') || '' }
    ]
    return candidates.find(({ url }) => /^https?:/i.test(url || '')) || { url: '', type: '' }
  }

  function filenameFrom(url) {
    const value = url.split('/').pop()?.split(/[?#]/)[0] || ''
    try {
      return decodeURIComponent(value) || null
    } catch {
      return value || null
    }
  }

  function emit(video) {
    // Never offer encrypted/DRM media. Blob and MediaSource URLs are excluded
    // by source(), because they are not directly downloadable resources.
    if (video.mediaKeys) return
    const now = Date.now()
    // Playback events are noisy. Re-send after a short interval only so a
    // restarted desktop bridge can receive an already-playing video.
    if (now - (reported.get(video) || 0) < REPORT_INTERVAL_MS) return
    reported.set(video, now)

    const { url, type } = source(video)
    const kind = classify(url, type)

    const rect = video.getBoundingClientRect()
    const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth
    const height = video.videoHeight || undefined
    const width = video.videoWidth || undefined
    const quality = height ? `${height}p` : null
    const media = {
      id: '', pageUrl: location.href, title: document.title || null,
      filename: filenameFrom(url), quality, width, height,
      playing: !video.paused && !video.ended, visible
    }
    if (kind) {
      chrome.runtime.sendMessage({
        type: 'turbo-media-detected',
        media: { ...media, url, kind, mimeType: type || null, qualities: quality ? [{ label: quality, url, width, height }] : [] }
      })
      return
    }
    // For a blob: MediaSource player, ask the service worker to use the
    // direct response it just observed in this browser tab.
    chrome.runtime.sendMessage({ type: 'turbo-video-playing', media })
  }

  function watch(video) {
    if (listeners.has(video)) return
    const events = ['loadedmetadata', 'loadeddata', 'durationchange', 'play', 'playing', 'pause', 'ended']
    const onEvent = () => {
      if (!video.paused && !video.ended) emit(video)
    }
    events.forEach((event) => video.addEventListener(event, onEvent, { passive: true }))
    listeners.set(video, onEvent)
  }

  function scan() {
    document.querySelectorAll('video').forEach(watch)
    document.querySelectorAll('video').forEach((video) => {
      if (!video.paused && !video.ended) emit(video)
    })
  }

  setInterval(scan, 2_000)
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true })
  scan()
})()
