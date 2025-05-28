/**
 * Toast utility for the main process to show notifications to the user.
 * Since this is used in the main process, it sends IPC messages to renderer processes.
 */

import { BrowserWindow } from 'electron';
import { createLogger } from './logger';

const logger = createLogger('ToastUtil');

export const toast = {
    /**
     * Show a success toast notification
     */
    success: (message: string): void => {
        logger.info(`Success toast: ${message}`);
        sendToastToAllWindows('success', message);
    },

    /**
     * Show an error toast notification
     */
    error: (message: string): void => {
        logger.error(`Error toast: ${message}`);
        sendToastToAllWindows('error', message);
    },

    /**
     * Show an info toast notification
     */
    info: (message: string): void => {
        logger.info(`Info toast: ${message}`);
        sendToastToAllWindows('info', message);
    },

    /**
     * Show a warning toast notification
     */
    warning: (message: string): void => {
        logger.warn(`Warning toast: ${message}`);
        sendToastToAllWindows('warning', message);
    }
};

/**
 * Send a toast notification to all renderer windows
 */
function sendToastToAllWindows(type: 'success' | 'error' | 'info' | 'warning', message: string): void {
    const windows = BrowserWindow.getAllWindows();

    windows.forEach(window => {
        if (!window.isDestroyed()) {
            window.webContents.send('app:toast', { type, message });
        }
    });
} 