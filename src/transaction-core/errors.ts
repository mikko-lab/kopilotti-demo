export class TransactionDomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'TransactionDomainError'; this.code = code; }
}

export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new TransactionDomainError(code, message);
}
