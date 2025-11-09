export class ZeebeConnectionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ZeebeConnectionError';
  }
}

export class MissingVariableError extends Error {
  constructor(readonly variableName: string) {
    super(`Missing required Zeebe variable: ${variableName}`);
    this.name = 'MissingVariableError';
  }
}
