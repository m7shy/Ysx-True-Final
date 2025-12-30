
export class MailError extends Error {
  constructor(public code: 'AUTH' | 'DENIED' | 'TIMEOUT' | 'TRANSIENT' | 'UNKNOWN', message: string) {
    super(message);
    this.name = 'MailError';
  }
}

export function toHttp(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof MailError) {
    switch (err.code) {
      case 'AUTH':
        return { status: 401, code: 'AUTH', message: 'Authentication failed' };
      case 'DENIED':
        return { status: 403, code: 'DENIED', message: 'Access denied' };
      case 'TIMEOUT':
        return { status: 504, code: 'TIMEOUT', message: 'Operation timed out' };
      case 'TRANSIENT':
        return { status: 503, code: 'TRANSIENT', message: 'Service temporarily unavailable' };
      case 'UNKNOWN':
      default:
        return { status: 500, code: 'UNKNOWN', message: 'Internal server error' };
    }
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    return { status: 504, code: 'TIMEOUT', message: 'Request timed out' };
  }

  return { status: 500, code: 'UNKNOWN', message: 'Internal Server Error' };
}
