import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  component?: string;
}

export const createLogger = (options: LoggerOptions = {}) => {
  return pino({
    level: options.level || 'info',
    base: {
      component: options.component || 'unknown',
    },
    formatters: {
      level: (label) => {
        return { severity: label.toUpperCase() };
      },
    },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
  });
};
