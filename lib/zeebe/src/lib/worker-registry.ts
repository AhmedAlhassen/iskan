import { MissingVariableError } from './errors';
import type {
  ParameterMetadata,
  VariableParameterMetadata,
  VariablesAsTypeParameterMetadata,
  ZeebeJob,
  ZeebeWorkerMetadata,
  ZeebeWorkerOptions,
} from './types';

type Constructor<T = unknown> = new (...args: never[]) => T;

type DefinitionMap = Map<string | symbol, WorkerDefinitionInternal>;

type WorkerDefinitionInternal = {
  propertyKey: string | symbol;
  options?: ZeebeWorkerOptions;
  parameterCount?: number;
  parameters: Map<number, ParameterMetadata>;
};

const workerDefinitions = new WeakMap<Constructor, DefinitionMap>();

function ensureDefinition(
  target: Constructor,
  propertyKey: string | symbol,
): WorkerDefinitionInternal {
  let definitionMap = workerDefinitions.get(target);
  if (!definitionMap) {
    definitionMap = new Map();
    workerDefinitions.set(target, definitionMap);
  }

  let definition = definitionMap.get(propertyKey);
  if (!definition) {
    definition = {
      propertyKey,
      parameters: new Map(),
    };
    definitionMap.set(propertyKey, definition);
  }

  return definition;
}

export function storeWorkerOptions(
  target: Constructor,
  propertyKey: string | symbol,
  options: ZeebeWorkerOptions,
  parameterCount: number,
): void {
  const definition = ensureDefinition(target, propertyKey);
  definition.options = options;
  definition.parameterCount = parameterCount;
}

export function storeWorkerParameter(
  target: Constructor,
  propertyKey: string | symbol,
  parameter: ParameterMetadata,
): void {
  const definition = ensureDefinition(target, propertyKey);
  definition.parameters.set(parameter.index, parameter);
}

export function getWorkerMetadata(instance: object): ZeebeWorkerMetadata[] {
  const collected: ZeebeWorkerMetadata[] = [];
  const seen = new Set<string | symbol>();

  let prototype: object | null = instance;
  while (prototype && prototype !== Object.prototype) {
    const constructor = (prototype as { constructor: Constructor }).constructor;
    const map = workerDefinitions.get(constructor);
    if (map) {
      for (const [propertyKey, definition] of map.entries()) {
        if (!definition.options) {
          continue;
        }
        if (seen.has(propertyKey)) {
          continue;
        }
        seen.add(propertyKey);
        const parameterCount = definition.parameterCount ?? 0;
        const parameters = Array.from(definition.parameters.values()).sort(
          (left, right) => left.index - right.index,
        );
        collected.push({
          propertyKey,
          options: definition.options,
          parameterCount,
          parameters,
        });
      }
    }
    prototype = Object.getPrototypeOf(prototype);
  }

  return collected;
}

export function resolveParameter(
  parameter: ParameterMetadata,
  job: ZeebeJob,
): unknown {
  if (parameter.kind === 'variablesAsType') {
    return instantiateVariables(parameter, job);
  }

  return resolveVariable(parameter, job);
}

function instantiateVariables(
  parameter: VariablesAsTypeParameterMetadata,
  job: ZeebeJob,
): unknown {
  const instance = new parameter.factory();
  if (job.variables) {
    Object.assign(instance as Record<string, unknown>, job.variables);
  }
  return instance;
}

function resolveVariable(
  parameter: VariableParameterMetadata,
  job: ZeebeJob,
): unknown {
  const { name, required, transform } = parameter;
  const source = job.variables ?? {};
  const value = name ? (source as Record<string, unknown>)[name] : source;

  if (required && value === undefined) {
    throw new MissingVariableError(name ?? '<anonymous>');
  }

  return transform ? transform(value, job) : value;
}
