import { probeUrl } from './Metadata'
import { createLogger } from '../util/logger'
import type { DownloadRecord } from '@shared/types'

const log = createLogger('recovery')

export interface RecoveryDecision {
  action: 'resume' | 'restart'
  reason: string
}

/**
 * Decide whether a persisted partial download can safely resume:
 *  - the server must still support ranges;
 *  - Content-Length must be unchanged (a changed size means the remote file
 *    was replaced — appending old bytes would corrupt the result);
 *  - if we stored an ETag or Last-Modified, they must still match.
 * Anything uncertain → restart from zero. We NEVER keep suspect partial data.
 */
export async function validateResume(
  record: DownloadRecord,
  partExists: boolean,
  partSize: number,
  userAgent: string,
  headers: Record<string, string> | null
): Promise<RecoveryDecision> {
  if (!partExists) return { action: 'restart', reason: 'partial file missing' }
  if (!record.supportsResume) return { action: 'restart', reason: 'server never supported resume' }
  if (record.totalBytes >= 0 && partSize > record.totalBytes) {
    return { action: 'restart', reason: 'partial file larger than declared size' }
  }
  try {
    const probe = await probeUrl(record.url, { headers: headers ?? undefined, userAgent })
    if (!probe.ok) {
      // Server unreachable right now — keep the data, retry later; resume is
      // still valid because nothing on disk changed. Do not wipe progress.
      return { action: 'resume', reason: 'server unreachable during validation; keeping partial data' }
    }
    if (record.totalBytes >= 0 && probe.totalBytes >= 0 && probe.totalBytes !== record.totalBytes) {
      return { action: 'restart', reason: `remote size changed (${record.totalBytes} → ${probe.totalBytes})` }
    }
    if (!probe.supportsResume) {
      return { action: 'restart', reason: 'server no longer advertises range support' }
    }
    if (record.validatorEtag && probe.etag && record.validatorEtag !== probe.etag) {
      return { action: 'restart', reason: 'ETag changed — remote file replaced' }
    }
    if (record.validatorLastModified && probe.lastModified && record.validatorLastModified !== probe.lastModified) {
      return { action: 'restart', reason: 'Last-Modified changed — remote file replaced' }
    }
    return { action: 'resume', reason: 'validators match' }
  } catch (err) {
    log.warn('validation probe failed', err)
    return { action: 'resume', reason: 'validation error; keeping partial data' }
  }
}
