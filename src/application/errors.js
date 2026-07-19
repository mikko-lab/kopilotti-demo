'use strict';

class ApplicationError extends Error {
  constructor(code, message, statusCode = 400, details) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

module.exports = { ApplicationError };
