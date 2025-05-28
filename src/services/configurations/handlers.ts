import { ipcMain, BrowserWindow } from 'electron';
import { ConfigurationsService } from './service';

let configurationsService: ConfigurationsService;
let discoveryInProgress = false;

/**
 * Register IPC handlers for MCP configurations management
 * These handlers connect the renderer process (UI) to the configurations service
 */
export function registerConfigurationsHandlers(service: ConfigurationsService): void {
    configurationsService = service;

    // Get all applications
    ipcMain.handle('configurationAPI:getApplications', () => {
        return configurationsService.getApplications();
    });

    // Discover tools for all servers without tools
    ipcMain.handle('configuration:discover-all-tools', async () => {
        // Prevent multiple simultaneous discovery requests
        if (discoveryInProgress) {
            console.log('Tool discovery already in progress, skipping request');
            return { success: true, message: 'Discovery already in progress' };
        }

        try {
            discoveryInProgress = true;
            await configurationsService.discoverToolsForAllServers();
            return { success: true };
        } catch (error) {
            console.error(`Error discovering all tools: ${error}`);
            return { success: false, error: String(error) };
        } finally {
            discoveryInProgress = false;
        }
    });
} 