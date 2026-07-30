export const PROVIDER_ERROR_CODES = Object.freeze({
  NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  CONTRACT_MISSING: 'PROVIDER_CONTRACT_MISSING',
  NOT_SUPPORTED: 'PROVIDER_NOT_SUPPORTED',
  FETCH_FAILED: 'PROVIDER_FETCH_FAILED',
});

export class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.provider = options.provider || null;
    this.retryable = options.retryable ?? false;
  }
}

export function serializeProviderError(error) {
  return {
    code: error?.code || PROVIDER_ERROR_CODES.FETCH_FAILED,
    message: error?.message || 'Provider fetch failed',
    provider: error?.provider || null,
    retryable: error?.retryable ?? false,
  };
}
