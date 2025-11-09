import { Camunda8, Operate, Tasklist, Zeebe } from '@camunda8/sdk';
import type {
  ICustomHeaders,
  IInputVariables,
  IOutputVariables,
  ZBWorkerTaskHandler,
} from '@camunda8/sdk/dist/zeebe/lib/interfaces-1.0';

import { ZeebeConnectionError } from './errors';
import {
  getWorkerMetadata,
  resolveParameter,
} from './worker-registry';
import type {
  ParameterMetadata,
  ZeebeClientManagerOptions,
  ZeebeClientRetryOptions,
  ZeebeJob,
  ZeebeWorkerMetadata,
  ZeebeWorkerOptions,
} from './types';

const DEFAULT_RETRY: Required<ZeebeClientRetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 5_000,
};

export class ZeebeClientManager {
  private readonly camunda: Camunda8;
  private readonly retry: Required<ZeebeClientRetryOptions>;
  private readonly trackedWorkers = new Set<{ close: () => Promise<unknown> }>();
  private zeebeClientPromise?: Promise<Zeebe.ZeebeGrpcClient>;
  private zeebeClient?: Zeebe.ZeebeGrpcClient;
  private operateClient?: Operate.OperateApiClient;
  private tasklistClient?: Tasklist.TasklistApiClient;
  private shutdownHandlers: Array<() => void> = [];

  constructor(private readonly options: ZeebeClientManagerOptions = {}) {
    this.camunda = new Camunda8(options.configuration, options.camundaOptions);
    this.retry = { ...DEFAULT_RETRY, ...(options.retry ?? {}) };
  }

  async getZeebeClient(): Promise<Zeebe.ZeebeGrpcClient> {
    if (this.zeebeClient) {
      return this.zeebeClient;
    }

    if (!this.zeebeClientPromise) {
      this.zeebeClientPromise = this.establishGrpcClient();
    }

    this.zeebeClient = await this.zeebeClientPromise;
    return this.zeebeClient;
  }

  getOperateClient(): Operate.OperateApiClient {
    if (!this.operateClient) {
      this.operateClient = this.camunda.getOperateApiClient(this.options.configuration);
    }
    return this.operateClient;
  }

  getTasklistClient(): Tasklist.TasklistApiClient {
    if (!this.tasklistClient) {
      this.tasklistClient = this.camunda.getTasklistApiClient(this.options.configuration);
    }
    return this.tasklistClient;
  }

  async deployResources(
    ...args: Parameters<Zeebe.ZeebeGrpcClient['deployResource']>
  ): Promise<Awaited<ReturnType<Zeebe.ZeebeGrpcClient['deployResource']>>> {
    const client = await this.getZeebeClient();
    return client.deployResource(...args);
  }

  async publishMessage(
    ...args: Parameters<Zeebe.ZeebeGrpcClient['publishMessage']>
  ): Promise<Awaited<ReturnType<Zeebe.ZeebeGrpcClient['publishMessage']>>> {
    const client = await this.getZeebeClient();
    return client.publishMessage(...args);
  }

  async completeJob(
    ...args: Parameters<Zeebe.ZeebeGrpcClient['completeJob']>
  ): Promise<Awaited<ReturnType<Zeebe.ZeebeGrpcClient['completeJob']>>> {
    const client = await this.getZeebeClient();
    return client.completeJob(...args);
  }

  async registerWorker<
    WorkerInputVariables = IInputVariables,
    CustomHeaderShape = ICustomHeaders,
    WorkerOutputVariables = IOutputVariables,
  >(
    options: ZeebeWorkerOptions<WorkerInputVariables, CustomHeaderShape, WorkerOutputVariables>,
    handler: ZBWorkerTaskHandler<
      WorkerInputVariables,
      CustomHeaderShape,
      WorkerOutputVariables
    >,
  ): Promise<Zeebe.ZBWorker<WorkerInputVariables, CustomHeaderShape, WorkerOutputVariables>> {
    const client = await this.getZeebeClient();
    const worker = client.createWorker({ ...options, taskHandler: handler });
    this.trackedWorkers.add(worker);
    return worker;
  }

  async registerDecoratedWorkers(
    instances: readonly object[] | object,
  ): Promise<void> {
    const zeebeClient = await this.getZeebeClient();
    const collection = Array.isArray(instances) ? instances : [instances];
    for (const instance of collection) {
      const metadata = getWorkerMetadata(instance);
      for (const definition of metadata) {
        const handler = this.createHandler(instance, definition);
        const worker = zeebeClient.createWorker({
          ...definition.options,
          taskHandler: handler,
        });
        this.trackedWorkers.add(worker);
      }
    }
  }

  enableGracefulShutdown(signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM']): void {
    if (typeof process === 'undefined') {
      return;
    }

    for (const signal of signals) {
      const listener = async () => {
        await this.shutdown();
        process.exit(0);
      };
      process.once(signal, listener);
      this.shutdownHandlers.push(() => process.off(signal, listener));
    }
  }

  disableGracefulShutdown(): void {
    for (const remove of this.shutdownHandlers.splice(0)) {
      remove();
    }
  }

  async shutdown(): Promise<void> {
    this.disableGracefulShutdown();

    for (const worker of Array.from(this.trackedWorkers)) {
      await worker.close();
      this.trackedWorkers.delete(worker);
    }

    if (this.zeebeClient) {
      await this.zeebeClient.close();
      this.zeebeClient = undefined;
    }
    this.zeebeClientPromise = undefined;

    await this.camunda.closeAllClients();
  }

  private createHandler(
    instance: object,
    definition: ZeebeWorkerMetadata,
  ): ZBWorkerTaskHandler {
    const method = (instance as Record<string | symbol, unknown>)[
      definition.propertyKey
    ];
    if (typeof method !== 'function') {
      throw new TypeError(`Worker method ${String(definition.propertyKey)} is not callable`);
    }

    return async (job) => {
      const args = this.buildArguments(job, definition.parameterCount, definition.parameters);
      return method.apply(instance, args);
    };
  }

  private buildArguments(
    job: ZeebeJob,
    parameterCount: number,
    metadata: readonly ParameterMetadata[],
  ): unknown[] {
    const args = new Array<unknown>(parameterCount).fill(undefined);
    for (const parameter of metadata) {
      args[parameter.index] = resolveParameter(parameter, job);
    }

    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === undefined) {
        args[index] = job;
      }
    }

    return args;
  }

  private async establishGrpcClient(): Promise<Zeebe.ZeebeGrpcClient> {
    let attempt = 0;
    let delay = this.retry.initialDelayMs;
    let lastError: unknown;

    while (attempt < this.retry.maxAttempts) {
      attempt += 1;
      try {
        const client = this.camunda.getZeebeGrpcApiClient(this.options.configuration);
        await client.topology();
        return client;
      } catch (error) {
        lastError = error;
        if (attempt >= this.retry.maxAttempts) {
          break;
        }
        await wait(delay);
        delay = Math.min(delay * 2, this.retry.maxDelayMs);
      }
    }

    throw new ZeebeConnectionError('Failed to connect to Zeebe gRPC API', lastError);
  }
}

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}
