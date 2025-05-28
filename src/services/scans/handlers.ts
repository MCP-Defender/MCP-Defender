import { ipcMain, BrowserWindow } from 'electron';
import { ScanService } from './service';
import { ScanEventType } from './types';
import { ServiceManager } from '../service-manager';

/**
 * Register IPC handlers for the scan service
 * @param service The scan service instance
 */
export function registerScanHandlers(service: ScanService): void {
    // Get scan results
    ipcMain.handle('scanAPI:getScanResults', async () => {
        return service.getScanResults();
    });

    // Get scan by ID
    ipcMain.handle('scanAPI:getScanById', async (event, scanId: string) => {
        return service.getScanById(scanId);
    });

    // Register handler for getting a temporary scan by ID
    ipcMain.handle('scanAPI:getTemporaryScanById', async (event, scanId: string) => {
        // Get the scan service from the service manager
        const scanService = ServiceManager.getInstance().scanService;
        return scanService.getTemporaryScanById(scanId);
    });

    // Set up event listeners to forward scan events to renderer
    service.on(ScanEventType.SCAN_RESULT_ADDED, (scanResult) => {
        // Get all windows and send the updated results
        const windows = BrowserWindow.getAllWindows();
        const allResults = service.getScanResults();

        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send('scan:results-update', allResults);
            }
        }
    });

    // Handle scan result updates the same way as new scans
    service.on(ScanEventType.SCAN_RESULT_UPDATED, (scanResult) => {
        // Get all windows and send the updated results
        const windows = BrowserWindow.getAllWindows();
        const allResults = service.getScanResults();

        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send('scan:results-update', allResults);
            }
        }
    });
} 