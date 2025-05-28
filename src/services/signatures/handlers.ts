import { ipcMain } from 'electron';
import { SignaturesService } from './service';

// Keep track of service instance
let signaturesService: SignaturesService;

/**
 * Register IPC handlers for signature-related functionality
 * @param service The SignaturesService instance to use
 */
export function registerSignatureHandlers(service: SignaturesService): void {
    // Store the service instance
    signaturesService = service;

    // Get all signatures
    ipcMain.handle('signaturesAPI:getSignatures', () => {
        return signaturesService.getSignatures();
    });

    // Open signatures directory
    ipcMain.handle('signaturesAPI:openSignaturesDirectory', async () => {
        return await signaturesService.openSignaturesDirectory();
    });
} 