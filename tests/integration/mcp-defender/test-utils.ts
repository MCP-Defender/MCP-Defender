import { ChildProcess } from 'child_process';
import { strict as assert } from 'node:assert';
import { exec } from 'child_process';
import * as os from 'os';

/**
 * Wait for a process to be ready by watching for specific output in stdout
 * @param process The child process to monitor
 * @param readyPatterns Array of string patterns that indicate the process is ready
 * @param successMessage Message to log when the process is ready
 * @param errorMessage Message to log if the process times out
 * @param timeout Timeout in milliseconds
 * @param additionalDelay Additional delay after ready pattern is detected
 */
export function waitForProcessReady(
    process: ChildProcess,
    readyPatterns: string[],
    successMessage: string,
    errorMessage: string,
    timeout = 10000,
    additionalDelay = 1000
): Promise<boolean> {
    return new Promise((resolve) => {
        let isReady = false;

        const timeoutId = setTimeout(() => {
            if (!isReady) {
                console.error(errorMessage);
                resolve(false);
            }
        }, timeout);

        // Listen for ready message in stdout
        process.stdout?.on('data', (data) => {
            const output = data.toString();

            // Check if any pattern matches
            const isMatched = readyPatterns.some(pattern => output.includes(pattern));

            if (isMatched && !isReady) {
                // Give it a moment to initialize fully
                setTimeout(() => {
                    isReady = true;
                    clearTimeout(timeoutId);
                    console.log(successMessage);
                    resolve(true);
                }, additionalDelay);
            }
        });
    });
}

/**
 * Kill a specific process and ensure it's terminated, with special handling for Electron
 * @param process The process to kill
 * @param isElectron Whether this is an Electron process (needs special handling)
 */
export function killProcess(process: ChildProcess | null, isElectron = false) {
    if (!process) {
        console.log('No process to kill');
        return;
    }

    const pid = process.pid;
    if (!pid) {
        console.log('Process has no PID, already terminated');
        return;
    }

    console.log(`Attempting to kill process with PID: ${pid}`);

    try {
        // First try the normal kill
        process.kill();

        // For Electron processes, we need to be more aggressive
        if (isElectron) {
            // Force kill any related electron processes by PID
            const platform = os.platform();
            if (platform === 'win32') {
                exec(`taskkill /F /PID ${pid} /T`);
            } else {
                // macOS or Linux - find and kill all child processes
                exec(`pkill -P ${pid} || true`);
                exec(`kill -9 ${pid} || true`);
            }

            // Also search for any lingering Electron processes
            if (platform === 'win32') {
                exec('taskkill /F /IM electron.exe /T');
            } else if (platform === 'darwin') {
                exec('pkill -9 Electron || true');
            } else {
                exec('pkill -9 electron || true');
            }
        }

        console.log(`Process killed successfully PID: ${pid}`);
    } catch (err) {
        console.error(`Error killing process PID: ${pid}`, err);

        // Try force kill if regular kill failed
        try {
            if (os.platform() === 'win32') {
                exec(`taskkill /F /PID ${pid} /T`);
            } else {
                exec(`kill -9 ${pid} || true`);
            }
        } catch (forceErr) {
            console.error(`Failed to force kill process PID: ${pid}`, forceErr);
        }
    }
}

/**
 * Find and kill any lingering Electron processes
 */
export function cleanupElectronProcesses(): Promise<void> {
    return new Promise((resolve) => {
        const platform = os.platform();
        console.log(`Cleaning up any lingering Electron processes on ${platform}`);

        try {
            if (platform === 'win32') {
                exec('taskkill /F /IM electron.exe /T', () => resolve());
            } else if (platform === 'darwin') {
                exec('pkill -9 Electron || true', () => resolve());
                exec('pkill -9 -f "Electron Helper" || true', () => resolve());
            } else {
                exec('pkill -9 electron || true', () => resolve());
            }
        } catch (err) {
            console.error('Error cleaning up Electron processes:', err);
            resolve(); // Resolve anyway to continue execution
        }
    });
}

/**
 * Helper function to check if a tool result indicates it was blocked by security policy
 * @param result The result returned from tool call
 * @returns True if the tool was allowed, false if blocked
 */
export function isToolCallAllowed(result: any): boolean {
    // If result is null or undefined, it wasn't allowed
    if (!result) return false;

    // Check for error content that indicates security policy block
    if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
            if (item.type === 'text' && typeof item.text === 'string') {
                const text = item.text.toLowerCase();
                if (text.includes('security policy') ||
                    text.includes('tool call not allowed') ||
                    text.includes('blocked by mcp defender')) {
                    return false;
                }
            }
        }
    }

    // If there's an error property with security policy message
    if (result.error && typeof result.error === 'string') {
        const error = result.error.toLowerCase();
        if (error.includes('security policy') ||
            error.includes('tool call not allowed')) {
            return false;
        }
    }

    // Otherwise assume it's allowed
    return true;
}

/**
 * Helper function to check if an error indicates a security policy block
 * @param error The error thrown during tool call
 * @returns True if error indicates security policy block, false otherwise
 */
export function isSecurityPolicyError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.toString().toLowerCase();
    return errorMessage.includes('security policy violation') ||
        errorMessage.includes('security policy') ||
        errorMessage.includes('tool call not allowed');
} 