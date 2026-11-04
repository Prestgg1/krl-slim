export class KrlError extends Error {
  constructor(message, line, hint) {
    super(message);
    this.name = 'KrlError';
    this.line = line;
    this.hint = hint;
  }
}
