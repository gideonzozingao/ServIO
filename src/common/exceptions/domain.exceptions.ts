/** Business-rule violation → 422 (or the given status) via AllExceptionsFilter. */
export class DomainException extends Error {
  constructor(
    message: string,
    readonly code: string = 'DOMAIN_RULE',
    readonly status: number = 422,
    readonly errors: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class InvalidStateException extends DomainException {
  constructor(message: string) {
    super(message, 'INVALID_STATE', 422);
  }
}

export class DomainConflictException extends DomainException {
  constructor(message: string, code = 'CONFLICT') {
    super(message, code, 409);
  }
}

export class EntityNotFoundException extends DomainException {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} ${id} not found` : `${entity} not found`, 'NOT_FOUND', 404);
  }
}
