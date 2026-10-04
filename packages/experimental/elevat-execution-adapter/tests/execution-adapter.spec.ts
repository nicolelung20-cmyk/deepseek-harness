import { describe, expect, it } from 'vitest'
import {
  InMemoryOrderLedger,
  PaperExecutionAdapter,
  RiskEngine,
  FailClosedLiveAdapter,
  type OrderIntent,
} from '../src/index.ts'

const buy: OrderIntent = {
  idempotencyKey: 'paper-1',
  symbol: 'BTC/USD',
  side: 'buy',
  type: 'market',
  quantity: 0.01,
  referencePrice: 100_000,
}

describe('Elevat execution boundary', () => {
  it('simulates a paper order with fee and slippage and records a fill', async () => {
    const ledger = new InMemoryOrderLedger()
    const adapter = new PaperExecutionAdapter({ feeRate: 0.001, slippageBps: 10, ledger })
    const result = await adapter.submit(buy)

    expect(result.status).toBe('filled')
    expect(result.executedQuantity).toBe(0.01)
    expect(result.averagePrice).toBe(100_100)
    expect(ledger.getByIdempotency('paper-1')?.events.map(e => e.type)).toEqual([
      'intent',
      'submitted',
      'fill',
      'terminal',
    ])
  })

  it('rejects duplicate idempotency keys without creating a second fill', async () => {
    const ledger = new InMemoryOrderLedger()
    const adapter = new PaperExecutionAdapter({ ledger })
    const first = await adapter.submit(buy)
    const second = await adapter.submit(buy)

    expect(first.orderId).toBe(second.orderId)
    expect(ledger.getByIdempotency('paper-1')?.events.filter(e => e.type === 'fill')).toHaveLength(1)
  })

  it('blocks orders over the configured notional cap', () => {
    const risk = new RiskEngine({ maxOrderNotional: 500, dailyLossLimit: 100 })
    expect(risk.evaluate(buy)).toMatchObject({ allowed: false, reason: 'order_notional_limit' })
  })

  it('opens the kill switch when realized loss reaches the daily limit', () => {
    const risk = new RiskEngine({ maxOrderNotional: 2_000, dailyLossLimit: 100 })
    risk.recordRealizedPnl(-100)
    expect(risk.evaluate(buy)).toMatchObject({ allowed: false, reason: 'kill_switch' })
  })

  it('fails closed for live execution', async () => {
    const adapter = new FailClosedLiveAdapter('kraken')
    const result = await adapter.submit(buy)
    expect(result.status).toBe('rejected')
    expect(result.error?.code).toBe('LIVE_DISABLED')
  })
})
