/**
 * Simple Logger Utility
 */

type LogLevel = "info" | "debug" | "error" | "warn";

const LOG_COLORS = {
    info: "\x1b[36m", // Cyan
    debug: "\x1b[35m", // Magenta
    error: "\x1b[31m", // Red
    warn: "\x1b[33m", // Yellow
    reset: "\x1b[0m",
};

export class Logger {
    private context: string;

    constructor(context: string) {
        this.context = context;
    }

    private formatMessage(level: LogLevel, message: string): string {
        const timestamp = new Date().toISOString();
        const color = LOG_COLORS[level];
        return `${color}[${timestamp}] [${level.toUpperCase()}] [${this.context}] ${message}${LOG_COLORS.reset}`;
    }

    info(message: string, data?: any): void {
        console.log(this.formatMessage("info", message), data || "");
    }

    debug(message: string, data?: any): void {
        console.log(this.formatMessage("debug", message), data || "");
    }

    warn(message: string, data?: any): void {
        console.warn(this.formatMessage("warn", message), data || "");
    }

    error(message: string, error?: any): void {
        console.error(this.formatMessage("error", message));
        if (error) {
            console.error(error);
        }
    }
}

export const createLogger = (context: string) => new Logger(context);
