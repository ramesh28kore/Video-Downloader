// Small logging helper: timestamped, level-filtered, never throws.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let threshold = LEVELS[(process.env.TD_LOG as LogLevel) ?? 'info'] ?? LEVELS.info

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level] ?? threshold
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVELS[level]! < threshold) return
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}]`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  child(scope: string): Logger
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => emit('debug', scope, a),
    info: (...a) => emit('info', scope, a),
    warn: (...a) => emit('warn', scope, a),
    error: (...a) => emit('error', scope, a),
    child: (sub) => createLogger(`${scope}:${sub}`)
  }
}

export const logger = createLogger('app')
