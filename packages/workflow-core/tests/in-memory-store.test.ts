import { describe, expect, it } from 'vitest'
import { inMemoryRunStore } from '../src'
import type { RunState, WorkflowEvent } from '../src/types'

const baseRunState: RunState = {
  runId: 'run-1',
  status: 'running',
  workflowId: 'test',
  input: { msg: 'hi' },
  createdAt: 1,
  updatedAt: 1,
}

const customEvent = (name: string): WorkflowEvent => ({
  type: 'CUSTOM',
  ts: Date.now(),
  name,
  value: {},
})

describe('inMemoryRunStore — state', () => {
  it('round-trips run state', async () => {
    const store = inMemoryRunStore()
    expect(await store.getRunState('run-1')).toBeUndefined()

    await store.setRunState('run-1', baseRunState)
    expect(await store.getRunState('run-1')).toEqual(baseRunState)
  })

  it('clears state and log on deleteRun', async () => {
    const store = inMemoryRunStore()
    await store.setRunState('run-1', baseRunState)
    await store.appendEvent('run-1', 0, customEvent('a'))

    await store.deleteRun('run-1', 'finished')

    expect(await store.getRunState('run-1')).toBeUndefined()
    expect(await store.getEvents('run-1')).toEqual([])
  })
})

describe('inMemoryRunStore — event log', () => {
  it('returns an empty array for an unknown run', async () => {
    const store = inMemoryRunStore()
    expect(await store.getEvents('never-ran')).toEqual([])
  })

  it('appends events in order and getEvents returns them ordered', async () => {
    const store = inMemoryRunStore()
    await store.appendEvent('run-1', 0, customEvent('a'))
    await store.appendEvent('run-1', 1, customEvent('b'))
    await store.appendEvent('run-1', 2, customEvent('c'))

    const log = await store.getEvents('run-1')
    expect(
      log.map((e) =>
        e.type === 'CUSTOM'
          ? (e as Extract<WorkflowEvent, { type: 'CUSTOM' }>).name
          : null,
      ),
    ).toEqual(['a', 'b', 'c'])
  })

  it('returns a snapshot — mutating it does not mutate the store', async () => {
    const store = inMemoryRunStore()
    await store.appendEvent('run-1', 0, customEvent('a'))

    const snap = await store.getEvents('run-1')
    ;(snap as Array<WorkflowEvent>).push(customEvent('forged'))

    const fresh = await store.getEvents('run-1')
    expect(fresh).toHaveLength(1)
  })

  it('isolates the log between runs', async () => {
    const store = inMemoryRunStore()
    await store.appendEvent('run-a', 0, customEvent('a0'))
    await store.appendEvent('run-b', 0, customEvent('b0'))
    await store.appendEvent('run-a', 1, customEvent('a1'))

    expect(await store.getEvents('run-a')).toHaveLength(2)
    expect(await store.getEvents('run-b')).toHaveLength(1)
  })
})

describe('inMemoryRunStore — subscribe', () => {
  it('replays already-persisted events to a fresh subscriber', async () => {
    const store = inMemoryRunStore()
    await store.appendEvent('run-1', 0, customEvent('a'))
    await store.appendEvent('run-1', 1, customEvent('b'))

    const seen: Array<string> = []
    const unsub = store.subscribe!('run-1', 0, (event) => {
      if (event.type === 'CUSTOM') seen.push(event.name)
    })

    expect(seen).toEqual(['a', 'b'])
    unsub()
  })

  it('delivers events appended after subscription', async () => {
    const store = inMemoryRunStore()
    const seen: Array<string> = []
    const unsub = store.subscribe!('run-1', 0, (event) => {
      if (event.type === 'CUSTOM') seen.push(event.name)
    })

    await store.appendEvent('run-1', 0, customEvent('a'))
    await store.appendEvent('run-1', 1, customEvent('b'))

    expect(seen).toEqual(['a', 'b'])
    unsub()

    await store.appendEvent('run-1', 2, customEvent('c'))
    expect(seen).toEqual(['a', 'b'])
  })

  it('honors `fromIndex` and only replays from that point', async () => {
    const store = inMemoryRunStore()
    await store.appendEvent('run-1', 0, customEvent('a'))
    await store.appendEvent('run-1', 1, customEvent('b'))
    await store.appendEvent('run-1', 2, customEvent('c'))

    const seen: Array<string> = []
    store.subscribe!('run-1', 2, (event) => {
      if (event.type === 'CUSTOM') seen.push(event.name)
    })
    expect(seen).toEqual(['c'])
  })
})
