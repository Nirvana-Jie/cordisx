import { execFileSync } from 'node:child_process'

export interface ProcessIdentity {
  readonly pid: number
  readonly parentPid: number
  readonly startedAt: string
}

export type RecordedProcessStatus = 'alive' | 'dead' | 'unknown'

/** Snapshot of every visible process with its parent and start time; empty where `ps` is unavailable. */
export function processTable(): readonly ProcessIdentity[] {
  if (process.platform === 'win32') return []
  return execFileSync('ps', ['-axo', 'pid=,ppid=,lstart='], { encoding: 'utf8' })
    .split('\n')
    .flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line)
      if (match === null) return []
      const pid = Number(match[1])
      const parentPid = Number(match[2])
      const startedAt = match[3] ?? ''
      return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid) && parentPid >= 0
        ? [{ pid, parentPid, startedAt }]
        : []
    })
}

/** Start time of one live process, or undefined once it is gone. */
export function liveProcessStartedAt(pid: number): string | undefined {
  if (process.platform === 'win32') {
    try {
      process.kill(pid, 0)
      return 'live'
    } catch {
      return undefined
    }
  }
  return processTable().find(item => item.pid === pid)?.startedAt
}

/**
 * Pair a recorded PID with its recorded start time so a reused PID never
 * passes as the recorded process. `unknown` means the table could not be read
 * and must be treated as unsafe by callers that would otherwise act on `dead`.
 */
export function recordedProcessStatus(pid: number, startedAt: string): RecordedProcessStatus {
  if (process.platform === 'win32') {
    try {
      process.kill(pid, 0)
      return 'alive'
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown'
    }
  }
  let table: readonly ProcessIdentity[]
  try {
    table = processTable()
  } catch {
    return 'unknown'
  }
  const current = table.find(item => item.pid === pid)
  if (current === undefined) return 'dead'
  return current.startedAt === startedAt ? 'alive' : 'dead'
}

function commandUsesUserDataDir(command: string, argument: string): boolean {
  for (let index = command.indexOf(argument); index !== -1; index = command.indexOf(argument, index + 1)) {
    const next = command[index + argument.length]
    if (next === undefined || /\s/u.test(next)) return true
  }
  return false
}

/**
 * Live processes launched with one of the given `--user-data-dir` values, such
 * as a Host tree that outlived a killed launcher. `undefined` means the
 * platform cannot enumerate command lines, which callers must treat as unsafe.
 */
export function processesUsingUserDataDir(userDataDirs: readonly string[]): readonly number[] | undefined {
  if (process.platform === 'win32') return undefined
  let output: string
  try {
    output = execFileSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return undefined
  }
  const arguments_ = [...new Set(userDataDirs)].map(directory => `--user-data-dir=${directory}`)
  return output.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line)
    if (match === null) return []
    const pid = Number(match[1])
    const command = match[2] ?? ''
    return pid !== process.pid && arguments_.some(argument => commandUsesUserDataDir(command, argument)) ? [pid] : []
  })
}
