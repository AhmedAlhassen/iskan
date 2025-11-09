import { Zeebe } from '@camunda8/sdk';
import { JOB_ACTION_ACKNOWLEDGEMENT } from '@camunda8/sdk/dist/zeebe/lib/interfaces-1.0';

import {
  Variable,
  VariablesAsType,
  ZeebeClientManager,
  ZeebeWorker,
} from '../index';
import { MissingVariableError } from './errors';
import type { ZeebeJob } from './types';

describe('Zeebe decorators', () => {
  class OrderInput {
    orderId!: string;
    amount = 0;
  }

  class ExampleWorker {
    public readonly calls: Array<{
      orderId: string;
      payload: OrderInput;
    }> = [];

    @ZeebeWorker({ taskType: 'order-created' })
    async handleOrder(
      job: ZeebeJob,
      @Variable('orderId') orderId: string,
      @VariablesAsType(OrderInput) payload: OrderInput,
    ): Promise<typeof JOB_ACTION_ACKNOWLEDGEMENT> {
      this.calls.push({ orderId, payload });
      return job.complete({ processed: true });
    }

    @ZeebeWorker({ taskType: 'missing-variable' })
    async handleMissing(
      @Variable({ name: 'required', required: true }) _value: string,
    ): Promise<typeof JOB_ACTION_ACKNOWLEDGEMENT> {
      return JOB_ACTION_ACKNOWLEDGEMENT;
    }
  }

  it('registers decorated workers and injects variables', async () => {
    type WorkerConfig = Parameters<Zeebe.ZeebeGrpcClient['createWorker']>[0];
    type WorkerHandler = WorkerConfig['taskHandler'];
    type WorkerInstance = ReturnType<Zeebe.ZeebeGrpcClient['createWorker']>;

    const handlers: WorkerHandler[] = [];
    const createWorker = jest.fn((config: WorkerConfig) => {
      handlers.push(config.taskHandler);
      return { close: jest.fn().mockResolvedValue(undefined) } as unknown as WorkerInstance;
    }) as jest.MockedFunction<Zeebe.ZeebeGrpcClient['createWorker']>;

    class TestManager extends ZeebeClientManager {
      override async getZeebeClient(): Promise<Zeebe.ZeebeGrpcClient> {
        return { createWorker } as unknown as Zeebe.ZeebeGrpcClient;
      }
    }

    const manager = new TestManager();
    const workerInstance = new ExampleWorker();

    await manager.registerDecoratedWorkers([workerInstance]);

    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(createWorker).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'order-created' }),
    );

    const job = createJob({ orderId: 'A-123', amount: 42 });

    await handlers[0](job, {} as never);

    expect(workerInstance.calls).toHaveLength(1);
    const [call] = workerInstance.calls;
    expect(call.orderId).toBe('A-123');
    expect(call.payload).toBeInstanceOf(OrderInput);
    expect(call.payload).toMatchObject({ orderId: 'A-123', amount: 42 });
    expect(job.complete).toHaveBeenCalledWith({ processed: true });
  });

  it('throws a MissingVariableError when a required variable is absent', async () => {
    type WorkerConfig = Parameters<Zeebe.ZeebeGrpcClient['createWorker']>[0];
    type WorkerHandler = WorkerConfig['taskHandler'];
    type WorkerInstance = ReturnType<Zeebe.ZeebeGrpcClient['createWorker']>;

    const handlers: WorkerHandler[] = [];
    const createWorker = jest.fn((config: WorkerConfig) => {
      handlers.push(config.taskHandler);
      return { close: jest.fn().mockResolvedValue(undefined) } as unknown as WorkerInstance;
    }) as jest.MockedFunction<Zeebe.ZeebeGrpcClient['createWorker']>;

    class TestManager extends ZeebeClientManager {
      override async getZeebeClient(): Promise<Zeebe.ZeebeGrpcClient> {
        return { createWorker } as unknown as Zeebe.ZeebeGrpcClient;
      }
    }

    const manager = new TestManager();
    const workerInstance = new ExampleWorker();
    await manager.registerDecoratedWorkers([workerInstance]);

    const job = createJob({});

    await expect(handlers[1](job, {} as never)).rejects.toBeInstanceOf(MissingVariableError);
  });
});

function createJob(variables: Record<string, unknown>): ZeebeJob & {
  complete: jest.Mock;
} {
  const base = {
    key: '1',
    type: 'test',
    processInstanceKey: '1',
    bpmnProcessId: 'process',
    processDefinitionVersion: 1,
    elementId: 'element',
    elementInstanceKey: '2',
    customHeaders: {},
    worker: 'tester',
    retries: 3,
    deadline: '0',
    variables,
    tenantId: 'tenant',
    cancelWorkflow: jest.fn().mockResolvedValue(JOB_ACTION_ACKNOWLEDGEMENT),
    complete: jest.fn().mockResolvedValue(JOB_ACTION_ACKNOWLEDGEMENT),
    fail: jest.fn().mockResolvedValue(JOB_ACTION_ACKNOWLEDGEMENT),
    forward: jest.fn().mockReturnValue(JOB_ACTION_ACKNOWLEDGEMENT),
    error: jest.fn().mockResolvedValue(JOB_ACTION_ACKNOWLEDGEMENT),
  };

  return base as unknown as ZeebeJob & { complete: jest.Mock };
}
