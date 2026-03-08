import { createConsola, LogLevels } from 'consola';

export const logger = createConsola({
    level: LogLevels.info,
    formatOptions: {
        colors: true,
        date: false,
    },
});

export function setLogLevel(level: string | undefined) {
    const l = (level ?? 'info').toLowerCase().trim();
    switch (l) {
        case 'silent': logger.level = -999; break;
        case 'error': logger.level = LogLevels.error; break;
        case 'warn': logger.level = LogLevels.warn; break;
        case 'debug': logger.level = LogLevels.debug; break;
        case 'trace': logger.level = LogLevels.trace; break;
        default: logger.level = LogLevels.info;
    }
}