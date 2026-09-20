// A content script can see that an HTMLVideoElement is playing, but modern
// players often expose only a blob: URL there. Observe response headers as
// well, then associate the most recent direct media response with that tab's
// active video. No cookies, credentials, DRM keys, or protected streams are
// inspected or forwarded.
const recentDirectByTab = new Map()
const MAX_CANDIDATE_AGE_MS = 30_000
const directExtension = /\.(mp4|webm|ogg|ogv)(?:$|[?#])/i
const segmentedExtension = /\.(?:m4s|cmfv|cmfa|ts)(?:$|[?#])/i

function header(headers, name) {
  return headers?.find((item) => item.name.toLowerCase() === name)?.value || ''
}

function isDirectResponse(url, contentType) {
  const type = contentType.toLowerCase().split(';', 1)[0]
  if (segmentedExtension.test(url) || type === 'video/mp2t') return false
  return directExtension.test(url) || type === 'video/mp4' || type === 'video/webm' || type === 'video/ogg'
}

function filenameFrom(url) {
  const value = url.split('/').pop()?.split(/[?#]/)[0] || ''
  try {
    return decodeURIComponent(value) || null
  } catch {
    return value || null
  }
}

function forward(media, sendResponse) {
  chrome.storage.local.get(['endpoint', 'token'], async (config) => {
    if (!config.endpoint || !config.token) {
      sendResponse?.({ ok: false, error: 'Configure TurboDownload bridge endpoint and token.' })
      return
    }
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(media)
      })
      sendResponse?.({ ok: response.ok })
    } catch {
      sendResponse?.({ ok: false, error: 'TurboDownload is not reachable.' })
    }
  })
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !/^https?:/i.test(details.url)) return
    const contentType = header(details.responseHeaders, 'content-type')
    if (!isDirectResponse(details.url, contentType)) return
    recentDirectByTab.set(details.tabId, {
      url: details.url,
      mimeType: contentType || null,
      filename: filenameFrom(details.url),
      observedAt: Date.now()
    })
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
  ['responseHeaders']
)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'turbo-media-detected') {
    forward(message.media, sendResponse)
    return true
  }

  if (message?.type === 'turbo-video-playing') {
    const candidate = recentDirectByTab.get(sender.tab?.id)
    if (!candidate || Date.now() - candidate.observedAt > MAX_CANDIDATE_AGE_MS) {
      sendResponse({ ok: false, error: 'No direct media response was observed for this player.' })
      return false
    }
    forward({
      ...message.media,
      id: '',
      url: candidate.url,
      filename: candidate.filename || message.media.filename || null,
      mimeType: candidate.mimeType,
      kind: 'direct',
      qualities: message.media.quality ? [{ label: message.media.quality, url: candidate.url, width: message.media.width, height: message.media.height }] : []
    }, sendResponse)
    return true
  }

  if (message?.type === 'turbo-configure') {
    chrome.storage.local.set({ endpoint: message.endpoint, token: message.token }, () => sendResponse({ ok: true }))
    return true
  }
})
