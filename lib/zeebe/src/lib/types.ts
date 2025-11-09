import type { Camunda8 } from '@camunda8/sdk';
import type {
  ICustomHeaders,
  IInputVariables,
  IOutputVariables,
  ZeebeJob as SdkZeebeJob,
  ZBWorkerConfig,
} from '@camunda8/sdk/dist/zeebe/lib/interfaces-1.0';

type Camunda8Constructor = typeof Camunda8;

export type ZeebeJob<
  Variables = IInputVariables,
  CustomHeaders = ICustomHeaders,
  OutputVariables = IOutputVariables,
> = SdkZeebeJob<Variables, CustomHeaders, OutputVariables>;

export type ZeebeWorkerOptions<
  WorkerInputVariables = IInputVariables,
  CustomHeaderShape = ICustomHeaders,
  WorkerOutputVariables = IOutputVariables,
> = Omit<
  ZBWorkerConfig<WorkerInputVariables, CustomHeaderShape, WorkerOutputVariables>,
  'taskHandler'
>;

export interface VariableDecoratorOptions<T = unknown, Variables = IInputVariables> {
  readonly name?: keyof Variables & string;
  readonly required?: boolean;
  readonly transform?: (value: unknown, job: ZeebeJob<Variables>) => T;
}

export interface ZeebeWorkerMetadata<
  Variables = IInputVariables,
  CustomHeaders = ICustomHeaders,
  OutputVariables = IOutputVariables,
> {
  readonly propertyKey: string | symbol;
  readonly options: ZeebeWorkerOptions<Variables, CustomHeaders, OutputVariables>;
  readonly parameterCount: number;
  readonly parameters: readonly ParameterMetadata[];
}

export type ParameterMetadata =
  | VariableParameterMetadata
  | VariablesAsTypeParameterMetadata;

export interface VariableParameterMetadata {
  readonly kind: 'variable';
  readonly index: number;
  readonly name?: string;
  readonly required: boolean;
  readonly transform?: (value: unknown, job: ZeebeJob) => unknown;
}

export interface VariablesAsTypeParameterMetadata {
  readonly kind: 'variablesAsType';
  readonly index: number;
  readonly factory: new () => unknown;
}

export interface ZeebeClientRetryOptions {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface ZeebeClientManagerOptions {
  readonly configuration?: ConstructorParameters<Camunda8Constructor>[0];
  readonly camundaOptions?: ConstructorParameters<Camunda8Constructor>[1];
  readonly retry?: ZeebeClientRetryOptions;
}
