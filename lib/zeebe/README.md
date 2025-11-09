# @iskan/zeebe

A shared Camunda 8 SDK wrapper that powers Zeebe job workers across the
microservice landscape. The library provides decorator-driven worker
registration, typed variable injection, resilient client lifecycle
management, and convenience helpers for working with Operate and Tasklist.

## Features

- `@ZeebeWorker()` decorator for registering handlers with zero boilerplate
- `@Variable()` and `@VariablesAsType()` parameter decorators for extracting
  variables
- Automatic worker discovery and registration through `ZeebeClientManager`
- Built-in retry strategy, OAuth/TLS support (via the SDK configuration), and
  graceful shutdown helpers
- Direct access to Operate and Tasklist API clients via `ZeebeClientManager`

## Usage

```ts
import { ZeebeClientManager, ZeebeWorker, Variable } from '@iskan/zeebe';

class PaymentWorker {
  @ZeebeWorker({ taskType: 'charge-payment' })
  async charge(job: ZeebeJob, @Variable('paymentId') paymentId: string) {
    // ...
    return job.complete();
  }
}

const manager = new ZeebeClientManager();
await manager.registerDecoratedWorkers([new PaymentWorker()]);
```

## Development

- `nx test zeebe` — run the unit test suite.
- `nx build zeebe` — produce the distributable package under `dist/`.
