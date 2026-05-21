import { describe, expect, it } from 'vitest'
import { LogConflictError, inMemoryRunStore } from '../src'

describe('event log CAS', () => {
  it('rejects appendEvent when expectedNextIndex doesn`t match log length', async () => {
    const store = inMemoryRunStore()
    await store.appendEvent('run-1', 0, {
      type: 'CUSTOM',
      ts: 1,
      name: 'a',
      value: {},
    })

    await expect(
      store.appendEvent('run-1', 0, {
        type: 'CUSTOM',
        ts: 2,
        name: 'b',
        value: {},
      }),
    ).rejects.toBeInstanceOf(LogConflictError)
  })

  it('LogConflictError carries the existing event at the conflicting index', async () => {
    const store = inMemoryRunStore()
    const winner = {
      type: 'CUSTOM' as const,
      ts: 1,
      name: 'winner',
      value: {},
    }
    await store.appendEvent('run-1', 0, winner)

    try {
      await store.appendEvent('run-1', 0, {
        type: 'CUSTOM',
        ts: 2,
        name: 'loser',
        value: {},
      })
      expect.unreachable('appendEvent should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(LogConflictError)
      const conflict = err as LogConflictError
      expect(conflict.runId).toBe('run-1')
      expect(conflict.attemptedIndex).toBe(0)
      expect(conflict.existing).toMatchObject({ name: 'winner' })
    }
  })

  it('rejects appends that skip ahead of the next index', async () => {
    const store = inMemoryRunStore()
    await expect(
      store.appendEvent('run-1', 1, {
        type: 'CUSTOM',
        ts: 0,
        name: 'x',
        value: {},
      }),
    ).rejects.toBeInstanceOf(LogConflictError)
  })
})
