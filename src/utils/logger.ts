import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

// Log levels
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

// Log configuration constants
const MAX_LOG_MESSAGE_LENGTH = 500;

// Log file path
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, `mcp-defender-${new Date().toISOString().split('T')[0]}.log`);

/**
 * Simple logger utility for MCP Defender
 * Logs to console and file without external dependencies
 */
export class Logger {
    private serviceName: string;
    private minLevel: LogLevel;

    constructor(serviceName: string, minLevel: LogLevel = LogLevel.INFO) {
        this.serviceName = serviceName;
        this.minLevel = minLevel;

        // Ensure log directory exists
        this.ensureLogDirectory();
    }

    /**
     * Set minimum log level
     */
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }

    /**
     * Log debug message
     */
    debug(message: string, ...args: any[]): void {
        this.log(LogLevel.DEBUG, message, ...args);
    }

    /**
     * Log info message
     */
    info(message: string, ...args: any[]): void {
        this.log(LogLevel.INFO, message, ...args);
    }

    /**
     * Log warning message
     */
    warn(message: string, ...args: any[]): void {
        this.log(LogLevel.WARN, message, ...args);
    }

    /**
     * Log error message
     */
    error(message: string, ...args: any[]): void {
        this.log(LogLevel.ERROR, message, ...args);
    }

    /**
     * Internal log method
     */
    private log(level: LogLevel, message: string, ...args: any[]): void {
        // Skip if below minimum level
        if (level < this.minLevel) return;

        const prefix = `[${this.serviceName}]`;
        const timestamp = new Date().toISOString();
        const levelStr = LogLevel[level];

        // Format log message
        const formattedMessage = `${timestamp} ${levelStr} ${prefix} ${message}`;

        // Log to console
        switch (level) {
            case LogLevel.DEBUG:
                console.debug(prefix, message, ...args);
                break;
            case LogLevel.INFO:
                console.info(prefix, message, ...args);
                break;
            case LogLevel.WARN:
                console.warn(prefix, message, ...args);
                break;
            case LogLevel.ERROR:
                console.error(prefix, message, ...args);
                break;
        }

        // Log to file (async, fire and forget)
        this.writeToFile(formattedMessage, args);
    }

    /**
     * Write log message to file
     */
    private async writeToFile(message: string, args: any[]): Promise<void> {
        try {
            // Format arguments if needed
            let fullMessage = message;
            if (args.length > 0) {
                try {
                    fullMessage += ' ' + args.map(arg =>
                        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
                    ).join(' ');
                } catch (e) {
                    fullMessage += ' [Error serializing arguments]';
                }
            }

            // Truncate message if it exceeds the maximum length
            if (fullMessage.length > MAX_LOG_MESSAGE_LENGTH) {
                fullMessage = fullMessage.substring(0, MAX_LOG_MESSAGE_LENGTH - 15) + '... (truncated)';
            }

            // Add newline and write to file
            await fs.appendFile(LOG_FILE, fullMessage + '\n', 'utf8');
        } catch (error) {
            // If file logging fails, just log to console
            console.error('[Logger] Failed to write to log file:', error);
        }
    }

    /**
     * Ensure log directory exists
     */
    private async ensureLogDirectory(): Promise<void> {
        try {
            await fs.mkdir(LOG_DIR, { recursive: true });
        } catch (error) {
            console.error('[Logger] Failed to create log directory:', error);
        }
    }
}

// Export factory function for creating loggers
export function createLogger(serviceName: string, minLevel?: LogLevel): Logger {
    return new Logger(serviceName, minLevel);
} 