import { ipcMain, BrowserWindow } from 'electron';
import { DefenderService } from './service';
import { DefenderServiceEvent } from './types';

// Keep track of the service instance
let service: DefenderService;

/**
 * Register IPC handlers for defender functionality
 * @param defenderServiceInstance The DefenderService instance to use
 */
export function registerDefenderHandlers(defenderServiceInstance: DefenderService): void {
    // Store the service instance
    service = defenderServiceInstance;

    // Register IPC handlers
    ipcMain.handle('defenderAPI:getState', async () => {
        return service.getState();
    });
}
