import { BrowserWindow, Tray, Menu, ipcMain, nativeImage, app, dialog, NativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { DefenderState, DefenderStatus, DefenderServiceEvent } from '../services/defender/types';
import { ServiceManager } from '../services/service-manager';
import { createLogger } from '../utils/logger';
import { notification } from '../utils/notification';

const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 500;

// Create a logger for the UI manager
const logger = createLogger('UIManager');

// References to UI elements
let mainWindowRef: BrowserWindow | null = null;
let onboardingWindowRef: BrowserWindow | null = null;
// Map to store scan detail windows by scan ID
let scanDetailWindows: Map<string, BrowserWindow> = new Map();
let settingsWindowRef: BrowserWindow | null = null;
let trayRef: Tray | null = null;

export enum MainWindowTabs {
    Threats = 'threats',
    Apps = 'apps',
    Signatures = 'signatures'
}

// Add isQuitting property to app
declare global {
    namespace Electron {
        interface App {
            isQuitting?: boolean;
        }
    }
}

// Initialize the property
app.isQuitting = false;

/**
 * Manage dock visibility on macOS - show icon only when a window is visible
 */
export function updateDockVisibility(): void {
    if (process.platform !== 'darwin' || !app.dock) return;

    // Check if any windows are visible
    const windows = BrowserWindow.getAllWindows();
    const anyWindowVisible = windows.some(window => window.isVisible());

    if (anyWindowVisible) {
        // Show dock icon if any window is visible
        if (app.dock.isVisible && !app.dock.isVisible()) {
            logger.info('Showing dock icon because windows are visible');
            app.dock.show();
        }
    } else {
        // Hide dock icon if no windows are visible and we're not quitting
        if ((!app.dock.isVisible || app.dock.isVisible()) && !app.isQuitting) {
            logger.info('Hiding dock icon because no windows are visible');
            app.dock.hide();
        }
    }
}

/**
 * Create the main window of the application
 * @param shouldShow Whether to show the window immediately
 * @returns The created or existing main window
 */
function createMainWindow(): BrowserWindow {
    // Return existing window if already created
    if (mainWindowRef) {
        return mainWindowRef;
    }

    // Create the browser window
    mainWindowRef = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,

        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        center: true,
        trafficLightPosition: {
            x: 14,
            y: 18
        },
        frame: false,
        titleBarStyle: 'hiddenInset', // Shows traffic lights always
        titleBarOverlay: false,
        show: true, // Only show if requested
    });

    // mainWindowRef.webContents.openDevTools();

    // Register the window close event handlers
    mainWindowRef.on('close', (event) => {
        // If we're not in the quit process and on macOS, hide window instead of closing
        if (process.platform === 'darwin' && !app.isQuitting) {
            event.preventDefault();
            mainWindowRef.hide();
            return;
        }
        // Otherwise, allow the close to proceed
    });

    // Register show/hide events to update dock visibility
    mainWindowRef.on('show', () => updateDockVisibility());
    mainWindowRef.on('hide', () => updateDockVisibility());

    // Clean up reference when window is closed
    mainWindowRef.on('closed', () => {
        mainWindowRef = null;
        updateDockVisibility();
    });

    // Switch to the apps tab initially
    mainWindowRef.webContents.on('did-finish-load', () => {
        notifyMainWindowToSwitchToTab(MainWindowTabs.Threats);
    });

    // Log environment variables for debugging
    logger.info(`MAIN_WINDOW_VITE_DEV_SERVER_URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
    logger.info(`MAIN_WINDOW_VITE_NAME: ${MAIN_WINDOW_VITE_NAME}`);

    // Load the app - with fallbacks to handle different environments
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        logger.info(`Loading URL: ${MAIN_WINDOW_VITE_DEV_SERVER_URL}`);
        mainWindowRef.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
        // Production build
        const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        logger.info(`Loading production file: ${rendererPath}`);

        try {
            mainWindowRef.loadFile(rendererPath);
        } catch (error) {
            logger.error(`Failed to load renderer: ${error}`);
            // Fallback to localhost if we're in development
            if (process.env.NODE_ENV === 'development') {
                logger.info('Falling back to localhost:5173');
                mainWindowRef.loadURL('http://localhost:5173');
            }
        }
    }
    return mainWindowRef;
}

/**
 * Create and display the onboarding window
 * @returns The created or existing onboarding window
 */
function createOnboardingWindow(): BrowserWindow {
    if (onboardingWindowRef) {
        onboardingWindowRef.focus();
        return onboardingWindowRef;
    }

    onboardingWindowRef = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        frame: true,
        titleBarStyle: 'hidden',
        show: false,
        resizable: false, // TODO: remove testing
        center: true,
        fullscreenable: false,
    });

    // Register show/hide events to update dock visibility
    onboardingWindowRef.on('show', () => updateDockVisibility());
    onboardingWindowRef.on('hide', () => updateDockVisibility());

    // Handle close event to warn user
    onboardingWindowRef.on('close', (event) => {
        // Only show warning if onboarding hasn't been completed
        if (!ServiceManager.isOnboardingCompleted()) {
            event.preventDefault();
            dialog.showMessageBox(onboardingWindowRef, {
                type: 'warning',
                title: 'Exit Setup',
                message: 'Quitting setup will exit the application.',
                buttons: ['Continue Setup', 'Quit Application'],
                defaultId: 0,
                cancelId: 0,
            }).then(({ response }) => {
                if (response === 1) {
                    // User chose to quit
                    onboardingWindowRef = null;
                    app.exit(0);
                }
            });
        } else {
            // Normal close, update dock visibility
            updateDockVisibility();
        }
    });

    // Load the onboarding UI
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        onboardingWindowRef.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/#/onboarding`);
    } else {
        // Production build
        const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        logger.info(`Loading production onboarding: ${rendererPath}#/onboarding`);

        try {
            // Use '/onboarding' with leading slash to match the dev URL format
            onboardingWindowRef.loadFile(rendererPath, { hash: '/onboarding' });
        } catch (error) {
            logger.error(`Failed to load onboarding renderer: ${error}`);
            // Fallback to localhost if we're in development
            if (process.env.NODE_ENV === 'development') {
                logger.info('Falling back to localhost:5173 for onboarding');
                onboardingWindowRef.loadURL('http://localhost:5173/#/onboarding');
            }
        }
    }

    onboardingWindowRef.once('ready-to-show', () => {
        onboardingWindowRef?.show();
        updateDockVisibility();
    });

    return onboardingWindowRef;
}

/**
 * Get the main window reference
 * @returns The main window reference or null
 */
export function getMainWindow(): BrowserWindow | null {
    if (!mainWindowRef) {
        mainWindowRef = createMainWindow();
    }
    return mainWindowRef;
}

/**
 * Get the onboarding window reference
 * @returns The onboarding window reference or null
 */
export function getOnboardingWindow(): BrowserWindow | null {
    if (!onboardingWindowRef) {
        onboardingWindowRef = createOnboardingWindow();
    }
    return onboardingWindowRef;
}

/**
 * Switch to a specific tab in the main window
 * @param tabName The name of the tab to switch to
 */
export function notifyMainWindowToSwitchToTab(tabName: MainWindowTabs): void {
    if (mainWindowRef && mainWindowRef.webContents) {
        logger.info(`Switching to tab: ${tabName}`);
        mainWindowRef.webContents.send('switch-tab', tabName);
    } else {
        logger.warn(`Cannot switch to tab ${tabName}: main window not available`);
    }
}

/**
 * Creates the tray icon and menu
 * Also manages dock icon visibility on macOS based on window visibility
 */
export function createTray() {
    // Update dock visibility based on window state
    updateDockVisibility();

    if (trayRef) return trayRef;

    let icon;
    let iconPath;

    // In development, use the path directly from source
    if (process.env.NODE_ENV === 'development') {
        iconPath = path.join(__dirname, './assets/IconTemplate.png');
    }
    // For production builds, there are two cases:
    else {
        // 1. During packaging with Electron Forge, the extra resources are copied to the resources directory
        if (process.resourcesPath) {
            iconPath = path.join(process.resourcesPath, 'IconTemplate.png');
        }
        // 2. During Vite builds, the files are in .vite/build/assets
        else {
            iconPath = path.join(__dirname, '../assets/IconTemplate.png');
        }
    }

    // Log the path we're trying to use
    logger.info('Using icon path:', iconPath);

    try {
        icon = nativeImage.createFromPath(iconPath);

        // If the icon is empty, try the platform-specific icon
        if (icon.isEmpty()) {
            // Try with @2x for retina displays on macOS
            if (process.platform === 'darwin') {
                const retinaPath = iconPath.replace('.png', '@2x.png');
                icon = nativeImage.createFromPath(retinaPath);
            }
        }

        // Set as template image for macOS
        if (process.platform === 'darwin') {
            icon.setTemplateImage(true);
        }
    } catch (error) {
        logger.error('Error loading tray icon:', error);
        // Fallback to a simple empty icon if needed
        icon = nativeImage.createEmpty();
    }

    const tray = new Tray(icon);
    tray.setToolTip('MCP Defender');

    // Set the tray reference
    trayRef = tray;

    // Update the tray menu
    const serviceManager = ServiceManager.getInstance();
    updateTrayContextMenu(serviceManager.defenderService.getState());

    return tray;
}

/**
 * Notify the main window to open settings
 */
export function notifyMainWindowToOpenSettings(): void {
    if (mainWindowRef && mainWindowRef.webContents) {
        logger.info('Opening settings view');
        mainWindowRef.webContents.send('open-settings');
    } else {
        logger.warn('Cannot open settings: main window not available');
    }
}

function getFullMenuStatusImage(icon_filename: string): NativeImage {
    let iconPath;
    // In development, use the path directly from source
    if (process.env.NODE_ENV === 'development') {
        iconPath = path.join(__dirname, './assets/menu_status_icons/', icon_filename);
    }
    // For production builds, there are two cases:
    else {
        // 1. During packaging with Electron Forge, the extra resources are copied to the resources directory
        if (process.resourcesPath) {
            iconPath = path.join(process.resourcesPath, 'menu_status_icons/', icon_filename);
        }
        // 2. During Vite builds, the files are in .vite/build/assets
        else {
            iconPath = path.join(__dirname, '../assets/menu_status_icons/', icon_filename);
        }
    }
    return nativeImage.createFromPath(iconPath);
}

/**
 * Update the tray context menu to reflect current app state
 */
export async function updateTrayContextMenu(state: DefenderState) {
    if (!trayRef) return;

    try {
        // Determine status text and icon
        let statusLabel = '';
        let statusIcon = getFullMenuStatusImage('Stopped.png');
        if (state.status === DefenderStatus.running) {
            statusLabel = 'Enabled';
            statusIcon = getFullMenuStatusImage('Running.png');
        } else if (state.status === DefenderStatus.starting) {
            statusLabel = 'Starting...';
            statusIcon = getFullMenuStatusImage('Starting.png');
        } else if (state.status === DefenderStatus.error) {
            statusLabel = 'Error';
            statusIcon = getFullMenuStatusImage('Stopped.png');
        } else {
            statusLabel = 'Not Protected';
            statusIcon = getFullMenuStatusImage('Stopped.png');
        }

        // Build the context menu
        const contextMenu = Menu.buildFromTemplate([
            { label: statusLabel, icon: statusIcon, enabled: false },
            { type: 'separator' },
            {
                label: 'Threats',
                click: () => {
                    showMainWindow(MainWindowTabs.Threats);
                }
            },
            {
                label: 'Applications',
                click: () => {
                    showMainWindow(MainWindowTabs.Apps);
                }
            },
            {
                label: 'Signatures',
                click: () => {
                    showMainWindow(MainWindowTabs.Signatures);
                }
            },
            { type: 'separator' },
            {
                label: 'Settings',
                click: () => {
                    showSettingsWindow();
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    // Don't use app.exit(0) as it bypasses the before-quit handler
                    // Instead, use app.quit() which triggers the before-quit event handler
                    app.quit();
                }
            }
        ]);

        // Set the updated context menu
        trayRef.setContextMenu(contextMenu);

    } catch (error) {
        logger.error('Error updating tray menu:', error);
    }
}

/**
 * Create and display the settings window or focus it if already open
 * @returns The settings window
 */
export function showSettingsWindow(): BrowserWindow {
    // If settings window already exists and isn't destroyed, focus it
    if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
        if (settingsWindowRef.isMinimized()) {
            settingsWindowRef.restore();
        }
        settingsWindowRef.focus();
        return settingsWindowRef;
    }

    // Create a new settings window
    settingsWindowRef = new BrowserWindow({
        width: 850,
        height: 750,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        center: true,
        trafficLightPosition: {
            x: 14,
            y: 18
        },
        frame: false,
        titleBarStyle: 'hiddenInset', // Shows traffic lights always
        titleBarOverlay: false,
        show: true, // Only show if requested
    });

    // Register show/hide events for dock visibility
    settingsWindowRef.on('show', () => updateDockVisibility());
    settingsWindowRef.on('hide', () => updateDockVisibility());

    // Clean up reference when window is closed
    settingsWindowRef.on('closed', () => {
        settingsWindowRef = null;
        updateDockVisibility();
    });

    // Load the settings page
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        settingsWindowRef.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/#/settings`);
    } else {
        // Production build
        const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        try {
            settingsWindowRef.loadFile(rendererPath, { hash: `/settings` });
        } catch (error) {
            logger.error(`Failed to load settings renderer: ${error}`);
            if (process.env.NODE_ENV === 'development') {
                settingsWindowRef.loadURL(`http://localhost:5173/#/settings`);
            }
        }
    }

    // Show window when ready
    settingsWindowRef.once('ready-to-show', () => {
        settingsWindowRef?.show();
        updateDockVisibility();
    });

    settingsWindowRef.focus();

    return settingsWindowRef;
}

/**
 * Close the settings window if it exists
 */
export function closeSettingsWindow(): void {
    if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
        settingsWindowRef.close();
    }
    settingsWindowRef = null;
    updateDockVisibility();
}

/**
 * Shows the main window and optionally switches to a tab
 * @param tabName Optional tab to switch to
 */
export function showMainWindow(tabName: MainWindowTabs = MainWindowTabs.Threats) {
    let mainWindow = getMainWindow();

    if (tabName) {
        mainWindow.webContents.once('did-finish-load', () => {
            notifyMainWindowToSwitchToTab(tabName);
        });

        notifyMainWindowToSwitchToTab(tabName);
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

/**
 * Shows the main window and optionally switches to a tab
 * @param tabName Optional tab to switch to
 */
export function showOnboardingWindow() {
    let onboardingWindow = getOnboardingWindow();

    if (onboardingWindow.isMinimized()) {
        onboardingWindow.restore();
    }
    onboardingWindow.show();
    onboardingWindow.focus();
}

/**
 * Create and display a scan detail window
 * @param scanId The ID of the scan to display
 * @returns The created scan detail window
 */
export function createScanDetailWindow(scanId: string): BrowserWindow {
    // Check if a window for this scan ID already exists
    if (scanDetailWindows.has(scanId)) {
        const existingWindow = scanDetailWindows.get(scanId);
        if (existingWindow && !existingWindow.isDestroyed()) {
            existingWindow.focus();
            return existingWindow;
        }
    }

    // Create a new scan detail window
    const scanDetailWindow = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        center: true,
        trafficLightPosition: {
            x: 14,
            y: 18
        },
        frame: false,
        titleBarStyle: 'hiddenInset', // Shows traffic lights always
        titleBarOverlay: false,
        show: true, // Only show if requested
    });

    // Store the window reference in our map
    scanDetailWindows.set(scanId, scanDetailWindow);

    // Register show/hide events for dock visibility
    scanDetailWindow.on('show', () => updateDockVisibility());
    scanDetailWindow.on('hide', () => updateDockVisibility());

    // Clean up reference when window is closed
    scanDetailWindow.on('closed', () => {
        scanDetailWindows.delete(scanId);
        updateDockVisibility();
    });

    // Load the scan detail page
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        scanDetailWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/#/scan-detail/${scanId}`);
    } else {
        // Production build
        const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        try {
            scanDetailWindow.loadFile(rendererPath, { hash: `/scan-detail/${scanId}` });
        } catch (error) {
            logger.error(`Failed to load scan detail renderer: ${error}`);
            if (process.env.NODE_ENV === 'development') {
                scanDetailWindow.loadURL(`http://localhost:5173/#/scan-detail/${scanId}`);
            }
        }
    }

    // Show window when ready
    scanDetailWindow.once('ready-to-show', () => {
        scanDetailWindow?.show();
        updateDockVisibility();
    });

    scanDetailWindow.focus();

    return scanDetailWindow;
}

/**
 * Find all scan detail windows and bring them to front
 */
export function focusAllScanDetailWindows(): void {
    for (const window of scanDetailWindows.values()) {
        if (!window.isDestroyed()) {
            window.show();
            window.focus();
        }
    }
}

/**
 * Close all scan detail windows
 */
export function closeAllScanDetailWindows(): void {
    for (const window of scanDetailWindows.values()) {
        if (!window.isDestroyed()) {
            window.close();
        }
    }
    scanDetailWindows.clear();
    updateDockVisibility();
}

/**
 * Get the number of open scan detail windows
 */
export function getScanDetailWindowCount(): number {
    // Count only non-destroyed windows
    let count = 0;
    for (const window of scanDetailWindows.values()) {
        if (!window.isDestroyed()) {
            count++;
        }
    }
    return count;
}

/**
 * Initialize all UI-related IPC listeners
 */
export function registerUIHandlers() {
    // Make sure notification IPC handlers are registered
    if (typeof notification === 'object' && 'show' in notification) {
        // Simply importing the notification module will register the handlers
        logger.info('Notification handlers are set up');
    }

    // Listen for defender state changes to update tray menu
    const serviceManager = ServiceManager.getInstance();
    serviceManager.defenderService.on(DefenderServiceEvent.STATUS, (state: DefenderState) => {
        (async () => {
            await updateTrayContextMenu(state);
        })();
    });

    // Register handlers for tab switching
    ipcMain.on('switch-tab', (event, tabName) => {
        notifyMainWindowToSwitchToTab(tabName);
    });

    // Handle tab switching requests from the renderer process
    ipcMain.handle('trayAPI:switchTab', async (event, tabName) => {
        notifyMainWindowToSwitchToTab(tabName);
    });

    // Register handler for opening scan detail window
    ipcMain.handle('scanAPI:openScanDetailWindow', async (event, scanId) => {
        return createScanDetailWindow(scanId);
    });

    // Register handlers for managing scan detail windows
    ipcMain.handle('scanAPI:getScanDetailWindowCount', async () => {
        return getScanDetailWindowCount();
    });

    ipcMain.handle('scanAPI:focusAllScanDetailWindows', async () => {
        focusAllScanDetailWindows();
        return true;
    });

    ipcMain.handle('scanAPI:closeAllScanDetailWindows', async () => {
        closeAllScanDetailWindows();
        return true;
    });

    // Register handler for opening settings
    ipcMain.handle('trayAPI:openSettings', async () => {
        notifyMainWindowToOpenSettings();
        return true;
    });

    // Register handler for opening settings window
    ipcMain.handle('settingsAPI:openSettingsWindow', async () => {
        showSettingsWindow();
        return true;
    });

    // Register handler for closing settings window
    ipcMain.handle('settingsAPI:closeSettingsWindow', async () => {
        closeSettingsWindow();
        return true;
    });

    // Register handler for getting resource paths
    ipcMain.handle('utilityAPI:getResourcePath', async (event, resourcePath: string) => {
        // Determine the correct path based on the environment
        if (app.isPackaged) {
            // In production, resources are in the app bundle's Resources directory
            return path.join(process.resourcesPath, resourcePath);
        } else {
            // In development, use the source path
            return path.join(app.getAppPath(), 'src', 'assets', resourcePath);
        }
    });
}

/**
 * Shows a critical error dialog with customizable options
 * @param title The title of the error dialog
 * @param message The main error message
 * @param detail Detailed error message or technical details
 * @param options Optional configuration options
 * @returns Promise that resolves when the user makes a choice
 */
export function showCriticalErrorDialog(
    title: string,
    message: string,
    detail: string,
    options?: {
        buttons?: string[],
        defaultId?: number,
        cancelId?: number,
        actions?: ((responseIndex: number) => void)[]
    }
): Promise<void> {
    const dialogOptions = {
        type: 'error' as const,
        title,
        message,
        detail,
        buttons: options?.buttons || ['Restart', 'Quit'],
        defaultId: options?.defaultId ?? 0,
        cancelId: options?.cancelId ?? 1
    };

    // Try using our main window reference if available
    const window = getMainWindow();

    return new Promise((resolve) => {
        const callback = ({ response }: { response: number }) => {
            // If custom actions are provided, execute them
            if (options?.actions && options.actions[response]) {
                options.actions[response](response);
                resolve();
                return;
            }

            // Default actions if no custom actions provided
            if (response === 0) {
                // First button was clicked (default: Restart)
                logger.info('User chose to restart the application');
                app.relaunch();
                app.exit(0);
            } else {
                // Any other button (default: Quit)
                logger.info('User chose to quit the application');
                app.quit();
            }
            resolve();
        };

        if (window) {
            dialog.showMessageBox(window, dialogOptions).then(callback);
        } else {
            dialog.showMessageBox(dialogOptions).then(callback);
        }
    });
}

/**
 * Get the tray reference
 * @returns The tray reference or null
 */
export function getTrayRef(): Tray | null {
    return trayRef;
}

/**
 * Create and display a security alert window for policy violations
 * @param scanId The scan result containing violation details
 * @returns Promise that resolves to the user's decision (allow/block)
 */
export function createSecurityAlertWindow(scanId: string): BrowserWindow {
    // Create a new security alert window
    const securityAlertWindow = new BrowserWindow({
        width: 500,
        height: 770,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false,
        // title: `Security Alert - MCP Defender`,
        center: true,
        alwaysOnTop: true,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        resizable: false,
        modal: true,
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        transparent: true,
        hasShadow: true,
        roundedCorners: true,
        closable: false,
        vibrancy: 'under-window',
        movable: true,
        // backgroundColor: 'rgba(0, 0, 0, 0.0)',
    });

    // Make dock bounce on macOS to alert the user
    if (process.platform === 'darwin' && app.dock) {
        // Bounce the dock icon until user responds (critical bounce)
        const bounceId = app.dock.bounce('critical');

        // Stop the bouncing when the window is closed
        securityAlertWindow.once('closed', () => {
            if (app.dock) {
                app.dock.cancelBounce(bounceId);
            }
        });
    }

    // Register show/hide events for dock visibility
    securityAlertWindow.on('show', () => updateDockVisibility());
    securityAlertWindow.on('hide', () => updateDockVisibility());

    // Clean up reference when window is closed
    securityAlertWindow.on('closed', () => {
        updateDockVisibility();
    });

    // Load the security alert page
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        securityAlertWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/#/security-alert/${scanId}`);
    } else {
        // Production build
        const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
        try {
            securityAlertWindow.loadFile(rendererPath, { hash: `/security-alert/${scanId}` });
        } catch (error) {
            logger.error(`Failed to load security alert renderer: ${error}`);
            if (process.env.NODE_ENV === 'development') {
                securityAlertWindow.loadURL(`http://localhost:5173/#/security-alert/${scanId}`);
            }
        }
    }

    // Show window when ready
    securityAlertWindow.once('ready-to-show', () => {
        securityAlertWindow?.show();
        securityAlertWindow?.focus();
        updateDockVisibility();
    });

    return securityAlertWindow;
} 