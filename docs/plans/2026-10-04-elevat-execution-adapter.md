# Elevat Execution Adapter Implementation Plan

## Goal
Implement the approved provider-neutral crypto execution boundary in DeepSeek Harness/Elevat with paper execution as the only enabled path.

## Tasks
1. Add a standalone workspace package under `packages/experimental/elevat-execution-adapter`.
2. Define normalized order intents, lifecycle states, adapter contracts, and safe error types.
3. Implement an in-memory order ledger with idempotency.
4. Implement the risk engine: paper/live mode gate, spot-only, per-order notional cap, daily loss ceiling, and kill switch.
5. Implement deterministic paper execution with configurable fee/slippage.
6. Implement fail-closed Kraken/Coinbase adapter shells behind an injected transport boundary; no credentials or network calls in tests.
7. Add contract, risk, paper, idempotency, kill-switch, and failure-path tests.
8. Add a CI workflow that runs the package test suite.
9. Verify package tests and repository type/build gates in CI before any merge.
10. Keep LIVE disabled by default; this implementation does not place real-money orders.

## Verification
- Focused Vitest suite passes.
- Root typecheck passes or reports an unrelated pre-existing failure with evidence.
- Root build passes or reports an unrelated pre-existing failure with evidence.
- CI status for the implementation commit is green.
- No secrets are present in source or tests.
