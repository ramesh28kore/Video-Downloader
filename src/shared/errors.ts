import type { FailureReason } from './types'

/**
 * Map an HTTP status (or a Node error code) to a friendly reason + message,
 * exactly as required by the spec's error-handling section.
 */
export function reasonForHttpStatus(status: number): FailureReason {
  switch (status) {
    case 400:
      return 'invalid_url'
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 408:
      return 'timeout'
    case 409:
      return 'unsupported_resume'
    case 416:
      return 'unsupported_resume'
    case 429:
      return 'rate_limited'
    default:
      if (status >= 500) return 'server_error'
      return 'unknown'
  }
}

export function friendlyMessageForStatus(status: number, url: string): string {
  const host = safeHost(url)
  switch (status) {
    case 400:
      return 'The server rejected the request (HTTP 400). The URL may be malformed or expired.'
    case 401:
      return `The server at ${host} requires authentication (HTTP 401). Add a Cookie or Authorization header if you own this resource.`
    case 403:
      return `Access denied by ${host} (HTTP 403). The server refuses this download — it may require a browser session, referer, or may forbid direct downloads.`
    case 404:
      return `The file was not found at ${host} (HTTP 404). The link may be broken or expired.`
    case 408:
      return `The server at ${host} took too long to respond (HTTP 408).`
    case 409:
      return `The server reported a conflict for this range request (HTTP 409).`
    case 416:
      return 'The requested byte range is not satisfiable (HTTP 416) — the file may have changed size on the server.'
    case 429:
      return `${host} is rate-limiting requests (HTTP 429). TurboDownload will back off and retry automatically.`
    case 500:
      return `${host} returned a server error (HTTP 500). Retrying shortly.`
    case 502:
      return `${host} is temporarily unreachable — the upstream server responded with an error (HTTP 502).`
    case 503:
      return `${host} is currently unavailable (HTTP 503 Service Unavailable). Retrying shortly.`
    case 504:
      return `The gateway in front of ${host} timed out (HTTP 504). Retrying shortly.`
    default:
      return `The server responded with HTTP ${status}.`
  }
}

export function reasonForNodeError(code: string): FailureReason {
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'network'
    case 'ECONNREFUSED':
      return 'network'
    case 'ECONNRESET':
    case 'EPIPE':
      return 'connection_dropped'
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return 'timeout'
    case 'ENOSPC':
      return 'disk_full'
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return 'permission_denied'
    case 'ERR_TOO_MANY_REDIRECTS':
      return 'too_many_redirects'
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'network'
    default:
      return 'unknown'
  }
}

export function friendlyMessageForNodeError(code: string): string {
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Could not reach the server — check your internet connection or the hostname.'
    case 'ECONNREFUSED':
      return 'The server refused the connection. It may be offline or blocking downloads.'
    case 'ECONNRESET':
    case 'EPIPE':
      return 'The connection was dropped by the server mid-download. TurboDownload will retry and resume.'
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return 'The server took too long to respond. TurboDownload will retry.'
    case 'ENOSPC':
      return 'Not enough disk space to continue this download. Free up space and press Retry.'
    case 'EACCES':
    case 'EPERM':
      return 'Windows denied writing to the destination folder. Choose another location or check permissions.'
    case 'EBUSY':
      return 'The file is locked by another program (it may be open elsewhere). Close it and press Retry.'
    case 'ERR_TOO_MANY_REDIRECTS':
      return 'The server kept redirecting in a loop. The link is probably expired or invalid.'
    case 'CERT_HAS_EXPIRED':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return 'The server presented an invalid or expired TLS certificate. The download was refused for safety.'
    default:
      return `Network error: ${code}`
  }
}

export function friendlyMessageForReason(reason: FailureReason, detail?: string | null): string {
  if (detail) return detail
  switch (reason) {
    case 'disk_full':
      return 'Not enough disk space to continue this download.'
    case 'unsupported_resume':
      return 'The server does not support resuming this download, and the connection was lost.'
    case 'permission_denied':
      return 'Windows denied access to the destination path.'
    case 'invalid_url':
      return 'That address is not a valid http(s) URL.'
    case 'unsupported_scheme':
      return 'Only http:// and https:// links can be downloaded.'
    case 'cancelled':
      return 'The download was cancelled.'
    default:
      return 'The download failed.'
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'the server'
  }
}
