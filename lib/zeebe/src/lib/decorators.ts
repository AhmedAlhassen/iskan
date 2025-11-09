import type { Job } from '@camunda8/sdk/dist/zeebe/lib/interfaces-1.0';

import { storeWorkerOptions, storeWorkerParameter } from './worker-registry';
import type { ParameterMetadata, VariableDecoratorOptions, ZeebeWorkerOptions } from './types';

export function ZeebeWorker(options: ZeebeWorkerOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    if (!descriptor || typeof descriptor.value !== 'function') {
      throw new TypeError('@ZeebeWorker can only be used on methods');
    }
    if (propertyKey === undefined) {
      throw new TypeError('@ZeebeWorker cannot decorate a constructor');
    }

    const parameterCount = descriptor.value.length;
    storeWorkerOptions(target.constructor as new () => unknown, propertyKey, options, parameterCount);
  };
}

export function Variable<T = unknown>(
  options?: string | VariableDecoratorOptions<T>,
): ParameterDecorator {
  const normalized = normalizeVariableOptions(options);
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new TypeError('@Variable cannot decorate a constructor parameter');
    }
    const metadata: ParameterMetadata = {
      kind: 'variable',
      index: parameterIndex,
      name: normalized.name,
      required: normalized.required ?? false,
      transform: normalized.transform as ((value: unknown, job: Job) => unknown) | undefined,
    };

    storeWorkerParameter(target.constructor as new () => unknown, propertyKey, metadata);
  };
}

export function VariablesAsType<T>(factory: new () => T): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new TypeError('@VariablesAsType cannot decorate a constructor parameter');
    }
    const metadata: ParameterMetadata = {
      kind: 'variablesAsType',
      index: parameterIndex,
      factory,
    };

    storeWorkerParameter(target.constructor as new () => unknown, propertyKey, metadata);
  };
}

function normalizeVariableOptions<T>(
  options?: string | VariableDecoratorOptions<T>,
): VariableDecoratorOptions<T> {
  if (typeof options === 'string') {
    return { name: options };
  }

  return options ?? {};
}
