import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.pass',
      'req.body.auth',
      'password',
      'pass',
      'auth',
      'authorization'
    ],
    remove: true,
  },
  transport: config.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  } : undefined,
});