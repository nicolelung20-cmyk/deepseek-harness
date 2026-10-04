export type Side = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'
export type ExecutionMode = 'paper' | 'live'
export type OrderStatus = 'rejected' | 'submitted' | 'filled' | 'cancelled' | 'uncertain'

export interface OrderIntent {
  idempotencyKey: string
  symbol: string
  side: Side
  type: OrderType
  quantity: number
  referencePrice: number
  limitPrice?: number
  metadata?: Record<string, string>
}

export interface ExecutionResult {
  orderId: string
  provider: string
  status: OrderStatus
  executedQuantity: number
  averagePrice?: number
  error?: { code: string; message: string }
}

export type LedgerEventType =
  | 'intent'
  | 'risk_rejected'
  | 'submitted'
  | 'fill'
  | 'terminal'
  | 'error'

export interface LedgerEvent {
  type: LedgerEventType
  at: number
  data: Record<string, unknown>
}

export interface LedgerOrder {
  orderId: string
  idempotencyKey: string
  events: LedgerEvent[]
}

export class InMemoryOrderLedger {
  private readonly orders = new Map<string, LedgerOrder>()

  create(intent: OrderIntent): LedgerOrder {
    const existing = this.orders.get(intent.idempotencyKey)
    if (existing) return existing
    const order: LedgerOrder = {
      orderId: `elevat-${cryptoRandomId()}`,
      idempotencyKey: intent.idempotencyKey,
      events: [{ type: 'intent', at: Date.now(), data: safeIntent(intent) }],
    }
    this.orders.set(intent.idempotencyKey, order)
    return order
  }

  append(orderId: string, type: LedgerEventType, data: Record<string, unknown>): void {
    const order = [...this.orders.values()].find(value => value.orderId === orderId)
    if (!order) throw new Error(`unknown order: ${orderId}`)
    order.events.push({ type, at: Date.now(), data })
  }

  getByIdempotency(key: string): LedgerOrder | undefined {
    return this.orders.get(key)
  }
}

export interface ExecutionAdapter {
  readonly provider: string
  submit(intent: OrderIntent): Promise<ExecutionResult>
  cancel(orderId: string): Promise<ExecutionResult>
}

export interface PaperExecutionOptions {
  ledger?: InMemoryOrderLedger
  feeRate?: number
  slippageBps?: number
}

export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly provider = 'paper'
  readonly ledger: InMemoryOrderLedger
  private readonly feeRate: number
  private readonly slippageBps: number

  constructor(options: PaperExecutionOptions = {}) {
    this.ledger = options.ledger ?? new InMemoryOrderLedger()
    this.feeRate = options.feeRate ?? 0
    this.slippageBps = options.slippageBps ?? 0
  }

  async submit(intent: OrderIntent): Promise<ExecutionResult> {
    validateIntent(intent)
    const order = this.ledger.create(intent)
    const existingTerminal = [...order.events].reverse().find(event => event.type === 'terminal')
    if (existingTerminal) {
      return existingTerminal.data.result as ExecutionResult
    }

    const slippage = this.slippageBps / 10_000
    const direction = intent.side === 'buy' ? 1 : -1
    const price = intent.referencePrice * (1 + direction * slippage)
    const fee = price * intent.quantity * this.feeRate
    const result: ExecutionResult = {
      orderId: order.orderId,
      provider: this.provider,
      status: 'filled',
      executedQuantity: intent.quantity,
      averagePrice: round(price),
    }
    this.ledger.append(order.orderId, 'submitted', { provider: this.provider })
    this.ledger.append(order.orderId, 'fill', {
      quantity: result.executedQuantity,
      averagePrice: result.averagePrice,
      fee,
    })
    this.ledger.append(order.orderId, 'terminal', { result })
    return result
  }

  async cancel(orderId: string): Promise<ExecutionResult> {
    return {
      orderId,
      provider: this.provider,
      status: 'cancelled',
      executedQuantity: 0,
    }
  }
}

export interface RiskConfig {
  maxOrderNotional: number
  dailyLossLimit: number
  mode?: ExecutionMode
  spotOnly?: boolean
}

export interface RiskDecision {
  allowed: boolean
  reason?: 'order_notional_limit' | 'daily_loss_limit' | 'kill_switch' | 'live_disabled' | 'invalid_order'
}

export class RiskEngine {
  private realizedPnl = 0
  private killed = false
  private readonly config: Required<RiskConfig>

  constructor(config: RiskConfig) {
    this.config = {
      mode: 'paper',
      spotOnly: true,
      ...config,
    }
    if (this.config.maxOrderNotional <= 0 || this.config.dailyLossLimit <= 0) {
      throw new Error('risk limits must be positive')
    }
  }

  evaluate(intent: OrderIntent): RiskDecision {
    try {
      validateIntent(intent)
    } catch {
      return { allowed: false, reason: 'invalid_order' }
    }
    if (this.killed) return { allowed: false, reason: 'kill_switch' }
    if (this.config.mode === 'live') return { allowed: false, reason: 'live_disabled' }
    if (intent.referencePrice * intent.quantity > this.config.maxOrderNotional) {
      return { allowed: false, reason: 'order_notional_limit' }
    }
    if (this.realizedPnl <= -this.config.dailyLossLimit) {
      this.killed = true
      return { allowed: false, reason: 'daily_loss_limit' }
    }
    return { allowed: true }
  }

  recordRealizedPnl(delta: number): void {
    this.realizedPnl += delta
    if (this.realizedPnl <= -this.config.dailyLossLimit) this.killed = true
  }

  activateKillSwitch(): void {
    this.killed = true
  }

  resetKillSwitch(): void {
    this.killed = false
  }
}

export class FailClosedLiveAdapter implements ExecutionAdapter {
  constructor(readonly provider: 'kraken' | 'coinbase') {}
  async submit(intent: OrderIntent): Promise<ExecutionResult> {
    validateIntent(intent)
    return {
      orderId: `blocked-${cryptoRandomId()}`,
      provider: this.provider,
      status: 'rejected',
      executedQuantity: 0,
      error: {
        code: 'LIVE_DISABLED',
        message: 'Live execution is disabled until a verified server-side provider transport is configured.',
      },
    }
  }

  async cancel(orderId: string): Promise<ExecutionResult> {
    return {
      orderId,
      provider: this.provider,
      status: 'rejected',
      executedQuantity: 0,
      error: { code: 'LIVE_DISABLED', message: 'Live execution is disabled.' },
    }
  }
}

export class KrakenExecutionAdapter extends FailClosedLiveAdapter {
  constructor() { super('kraken') }
}

export class CoinbaseExecutionAdapter extends FailClosedLiveAdapter {
  constructor() { super('coinbase') }
}

function validateIntent(intent: OrderIntent): void {
  if (!intent.idempotencyKey || !intent.symbol || intent.quantity <= 0 || intent.referencePrice <= 0) {
    throw new Error('invalid order intent')
  }
  if (intent.type === 'limit' && (!intent.limitPrice || intent.limitPrice <= 0)) {
    throw new Error('limit orders require a positive limitPrice')
  }
}

function safeIntent(intent: OrderIntent): Record<string, unknown> {
  return {
    idempotencyKey: intent.idempotencyKey,
    symbol: intent.symbol,
    side: intent.side,
    type: intent.type,
    quantity: intent.quantity,
    referencePrice: intent.referencePrice,
    limitPrice: intent.limitPrice,
    metadata: intent.metadata,
  }
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10)
}
