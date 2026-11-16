// Typed errors shared by the library, the stores and the tool handlers. Codes are the spec's
// "Error codes" table; `countsAsError` says whether a code counts toward KC-2 (connector error rate).
// INTERNAL_ERROR (an unexpected exception) is a connector bug, so it counts too.
export const COUNTED_CODES = ['NUMBER_COLLISION', 'WRITE_FAILED', 'BACKEND_UNAVAILABLE', 'RATE_LIMITED', 'INTERNAL_ERROR'];
const COUNTS = new Set(COUNTED_CODES);

export class ConnectorError extends Error {
  constructor(code, message, { details, hint } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code;
    this.details = details ?? null;
    this.hint = hint ?? null;
  }
  get countsAsError() {
    return COUNTS.has(this.code);
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

export const fail = (code, message, extra) => new ConnectorError(code, message, extra);
