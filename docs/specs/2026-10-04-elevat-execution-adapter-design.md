# Elevat Execution Adapter Design

## Goal
Add a provider-neutral crypto execution boundary to DeepSeek Harness/Elevat so strategies can paper-trade now and support Kraken/Coinbase live execution later without exposing exchange credentials or bypassing risk controls.

## Architecture
Strategy bots emit normalized order intents. A risk engine validates each intent before routing it to an execution adapter. Paper execution is the default adapter; Kraken and Coinbase adapters implement the same interface but remain unavailable unless explicitly enabled with server-side credentials. Every accepted, rejected, simulated, submitted, and filled order is recorded in an order ledger.

## Global Constraints
- Paper mode is the default.
- Live mode requires an explicit runtime switch.
- Spot only initially; leverage is disabled.
- Enforce a per-order maximum and daily loss ceiling.
- Prevent duplicate orders through idempotency keys.
- Record exchange rejection, partial-fill, timeout, and retry states.
- Kill switch blocks new orders immediately.
- Exchange API secrets remain server-side and must never be committed or sent to iOS/web clients.
- No real-money order may be submitted by tests.
- A live adapter must require explicit configuration and must fail closed when configuration is absent.

## Components

### ExecutionAdapter
Provider-neutral contract for normalized order submission, cancellation, and status lookup.

Inputs include an idempotency key, symbol, side, order type, quantity, optional limit price, and client metadata. Outputs include provider, provider order ID when available, lifecycle status, executed quantity, average price when available, timestamps, and normalized error information.

### PaperExecutionAdapter
Deterministic simulated adapter used by default. It models configurable fees and slippage and produces ledger events without contacting an exchange.

### KrakenExecutionAdapter
Server-side adapter implementing the common contract and mapping normalized orders to Kraken's spot order API. It must reject execution when credentials, live enablement, or required risk configuration is absent.

### CoinbaseExecutionAdapter
Server-side adapter implementing the common contract and mapping normalized orders to Coinbase Advanced Trade's spot order API. It must fail closed under the same conditions.

### RiskEngine
Evaluates every order before execution. It enforces mode, spot-only restrictions, per-order notional limits, daily loss limits, kill switch state, and idempotency. Rejected orders are persisted with a reason.

### OrderLedger
Durable event-oriented record of order intent, risk decision, submission, provider response, fills, cancellation, and terminal state. Provider-specific payloads must be stored only where safe and must exclude credentials.

## Data Flow
1. Strategy creates an order intent.
2. RiskEngine normalizes and validates the intent.
3. If rejected, record rejection and stop.
4. If accepted, create an idempotency record.
5. Route to the selected adapter.
6. Persist submission/result.
7. Poll or consume provider status where required.
8. Persist fills and terminal status.
9. Update daily risk accounting.
10. Trigger kill switch when configured loss limits are breached.

## Failure Behavior
- Missing credentials: fail closed; no provider call.
- Live mode disabled: route only to paper execution.
- Unknown provider: reject before adapter invocation.
- Duplicate idempotency key: return the existing lifecycle record without a second submission.
- Provider timeout: mark submission state as uncertain; do not blindly retry an order-creating request.
- Provider rejection: persist normalized rejection and do not retry automatically unless a future provider-specific policy explicitly permits it.
- Partial fill: persist each fill and keep the order lifecycle open until terminal.
- Kill switch: reject new orders while allowing status reconciliation for existing orders.

## Testing
- Contract tests shared by every adapter.
- Paper fee/slippage tests.
- Risk-limit boundary tests.
- Duplicate-order tests.
- Kill-switch tests.
- Provider rejection and timeout tests using mocks.
- No test may contact a real-money exchange endpoint.
- Integration tests verify strategy → risk → adapter → ledger behavior with paper execution.

## Operational Gate
The system is considered paper-ready when the complete paper path passes verification. Live execution is considered configuration-ready only when provider credentials are present server-side, live mode is explicitly enabled, risk limits are configured, and adapter contract/integration tests pass. This design does not authorize live trading by itself.

## Out of Scope
- Leverage/futures.
- Automatic strategy selection.
- Profit guarantees.
- Mobile custody of exchange secrets.
- Automatic transfer/withdrawal of funds.
