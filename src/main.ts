import { app, BrowserWindow, ipcMain, dialog, autoUpdater } from 'electron';
import { updateElectronApp } from 'update-electron-app';
// @ts-ignore
import started from 'electron-squirrel-startup';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createSecurityAlertWindow, MainWindowTabs, createTray, registerUIHandlers, showMainWindow, getMainWindow, getOnboardingWindow, updateDockVisibility, showOnboardingWindow, showSettingsWindow } from './ipc-handlers/ui-manager';

// import {
//   shouldShowOnboarding,
//   registerOnboardingHandlers,
//   setInitializeMainAppFn
// } from './ipc-handlers/onboarding-manager';
import { createLogger } from './utils/logger';
// Import services from the services index
import { ServiceManager } from './services/service-manager';
import { ServiceEvent } from './services/base-service';
import { DefenderStatus } from './services/defender/types';
import { create } from 'node:domain';
import { ScanResult, SignatureVerification } from './services/scans/types';
import { v4 as uuidv4 } from 'uuid';

// Create a global logger for the main process
const logger = createLogger('Main');

// ============================================================================
// UPDATE HANDLING STRATEGY
// ============================================================================
// We use a timeout-based approach to handle app updates gracefully:
// 
// Normal quit scenario:
//   - User manually quits the app
//   - Shutdown sequence completes quickly (under 5 seconds)
//   - App exits gracefully after restoring unprotected MCP configurations
//
// Update scenario:
//   - update-electron-app triggers a quit to install update
//   - Update process interferes with our shutdown sequence
//   - Shutdown times out after 5 seconds → force quit to allow update
//
// This approach is more reliable than trying to detect update-specific
// environment variables or command line arguments, which aren't well documented.
// ============================================================================

// Track whether we're in the process of shutting down
let isShuttingDown = false;

// Store the initial URL if the app is launched by a URL (macOS)
let deeplinkingUrl: string | null = null;

// Store the path to the CLI in tmp directory
let tmpCliPath: string | null = null;

// Protocol handler registration - following Electron docs exactly
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mcp-defender', process.execPath, [path.resolve(process.argv[1])]);
    logger.info(`Registered protocol handler in development mode: ${path.resolve(process.argv[1])}`);
  }
} else {
  app.setAsDefaultProtocolClient('mcp-defender');
  logger.info('Registered protocol handler in production mode');
}

// Single Instance Lock: Ensures only one instance of the app runs at a time
// When a deep link tries to open a second instance, it gets redirected to the main instance
// This is essential for deep link handling to work properly
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  logger.info('Another instance is already running. Quitting this instance.');
  app.quit();
} else {
  // This is the main instance - handle deep links from second instance attempts
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logger.info('Second instance detected with command line:', commandLine);

    // Get the URL from the command line (last argument on Windows contains the URL)
    const deepLinkUrl = commandLine.pop();
    if (deepLinkUrl && deepLinkUrl.includes('mcp-defender://')) {
      logger.info(`Processing deep link from second instance: ${deepLinkUrl}`);
      processDeepLink(deepLinkUrl);
    }

    // Focus the appropriate window based on onboarding status
    if (ServiceManager.isOnboardingCompleted()) {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    } else {
      const onboardingWindow = getOnboardingWindow();
      if (onboardingWindow) {
        if (onboardingWindow.isMinimized()) onboardingWindow.restore();
        onboardingWindow.focus();
      }
    }
  });

  // macOS: register the open-url handler (must be before 'ready')
  app.on('open-url', (event, url) => {
    event.preventDefault();
    logger.info(`Received deep link via open-url event: ${url}`);

    // If app is not ready yet, store the URL for later processing
    if (!app.isReady()) {
      deeplinkingUrl = url;
      return;
    }

    // Otherwise, process the URL immediately
    processDeepLink(url);
  });

  // Start the app when ready
  app.whenReady().then(async () => {
    logger.info('App ready event fired');
    logger.info(`Process arguments: ${JSON.stringify(process.argv)}`);

    await startupApp();

    // Process any queued deep link from macOS
    if (deeplinkingUrl) {
      logger.info(`Processing queued deep link from app launch: ${deeplinkingUrl}`);
      processDeepLink(deeplinkingUrl);
      deeplinkingUrl = null;
    }

    // Windows: handle protocol launch from command line arguments
    if (process.platform === 'win32') {
      // Check if app was launched with protocol URL
      const args = process.argv.slice(1);
      logger.info(`Windows command line args: ${JSON.stringify(args)}`);

      const protocolUrl = args.find(arg => arg.startsWith('mcp-defender://'));

      if (protocolUrl) {
        logger.info('Application launched with protocol URL on Windows:', protocolUrl);
        processDeepLink(protocolUrl);
      }
    }

    // Show all windows when the app is activated
    app.on('activate', () => {
      const windows = BrowserWindow.getAllWindows();
      for (const window of windows) {
        window.show();
        window.focus();
      }
      updateDockVisibility();
    });
  });
}

/**
 * Process a deep link URL (e.g., from email verification links)
 * Deep links are URLs like: mcp-defender://action?action=logged_in
 */
function processDeepLink(url: string) {
  try {
    // Parse the URL to get the action
    const parsedUrl = new URL(url);
    const action = parsedUrl.searchParams.get('action');
    logger.info(`Processing deep link with action: ${action}`);

    // Process the deep link with the settings service first to prepare data/state
    const success = ServiceManager.getInstance().settingsService.processDeepLink(url);

    if (!success) {
      logger.error('Deep link processing failed');
      return;
    }

    logger.info('Deep link processed successfully by settings service');

    // Check if onboarding is completed to determine which window to show
    const isOnboardingCompleted = ServiceManager.isOnboardingCompleted();

    if (isOnboardingCompleted) {
      // User has completed onboarding, show settings window for account-related actions
      logger.info('Onboarding completed, showing settings window');
      const settingsWindow = showSettingsWindow();
      settingsWindow.webContents.send('app:deep-link', url);
    } else {
      // User is in onboarding flow, show onboarding window
      logger.info('User in onboarding flow, focusing onboarding window');
      const onboardingWindow = getOnboardingWindow();
      onboardingWindow.webContents.send('app:deep-link', url);
      showOnboardingWindow();
    }
  } catch (error) {
    logger.error('Error processing deep link:', error);
  }
}

async function startupApp() {
  // Copy CLI to tmp directory first
  await copyCLIToTmpDirectory();

  // Need to start settings service first as it has onboarding info
  const serviceManager = ServiceManager.getInstance();
  serviceManager.startSettingsService();

  // Check if onboarding is completed
  if (ServiceManager.isOnboardingCompleted()) {
    // Start all services if onboarding is complete
    logger.info('Onboarding completed, starting all services');
    serviceManager.startRemainingServices();

    // Update CLI path in configurations service after it's started
    if (serviceManager.configurationsService) {
      serviceManager.configurationsService.updateCliPath();
    }
  } else {
    // Only start the settings service for onboarding
    logger.info('Onboarding not completed, starting only the settings service');
  }

  // Register UI handlers
  registerUIHandlers();

  initializeUI();
}

/**
 * Initialize the application UI based on onboarding status
 */
function initializeUI() {
  // Check if onboarding is completed
  if (ServiceManager.isOnboardingCompleted()) {
    // User has already completed onboarding
    logger.info('Onboarding is complete, showing main application');

    // Create and show main window
    showMainWindow();

    // Create tray icon
    createTray();
  } else {
    // User needs to complete onboarding
    logger.info('Onboarding required, showing onboarding window');

    // Show onboarding window
    showOnboardingWindow();
  }
}

// App continue running in background even when all windows are closed
app.on('window-all-closed', () => {
  // On macOS it's common for applications to stay running
  // until the user explicitly quits, so we won't quit here
  if (process.platform !== 'darwin') {
    app.quit();
  } else {
    // On macOS, when all windows are closed, update dock visibility
    updateDockVisibility();
  }
});

// Track if quit is coming from autoUpdater.quitAndInstall()
let isUpdateQuit = false;

// Listen for update events to detect when quit will come from updater
updateElectronApp({
  updateInterval: '5 minutes',
  notifyUser: true,
  logger: {
    info: (message) => logger.info(`[Updater] ${message}`),
    warn: (message) => logger.warn(`[Updater] ${message}`),
    error: (message) => logger.error(`[Updater] ${message}`),
    log: (message) => logger.info(`[Updater] ${message}`)
  },
  onNotifyUser: (info) => {
    logger.info('[Updater] Custom update notification handler - user will choose to restart or not');

    const dialogOpts = {
      type: 'info' as const,
      buttons: ['Restart', 'Later'],
      title: 'Application Update',
      message: process.platform === 'win32' ? info.releaseNotes : info.releaseName,
      detail: 'A new version has been downloaded. Restart the application to apply the updates.',
    };

    dialog.showMessageBox(dialogOpts).then(({ response }: { response: number }) => {
      if (response === 0) {
        logger.info('[Updater] User chose to restart - setting update quit flag and stopping services');
        isUpdateQuit = true; // Mark that this quit is from an update

        // Immediately set app.isQuitting to signal to all services that we're shutting down
        app.isQuitting = true;

        // Stop all services immediately before calling quitAndInstall
        // This prevents them from doing work during the quit process
        const serviceManager = ServiceManager.getInstance();

        // Set a timeout to ensure we don't hang on service stopping during updates
        const serviceStopTimeout = setTimeout(() => {
          logger.warn('[Updater] Service stopping timed out after 2 seconds, proceeding with update anyway');
          autoUpdater.quitAndInstall();
        }, 2000); // 2 second timeout for updates

        serviceManager.stopServices().then(() => {
          clearTimeout(serviceStopTimeout);
          logger.info('[Updater] Services stopped, proceeding with quit and install');
          autoUpdater.quitAndInstall();
        }).catch((error) => {
          clearTimeout(serviceStopTimeout);
          logger.error('[Updater] Error stopping services, proceeding with quit anyway:', error);

          // Even if service stopping fails, proceed with update
          autoUpdater.quitAndInstall();
        });
      } else {
        logger.info('[Updater] User chose to restart later');
      }
    });
  }
});

// Clean up resources before quitting
app.on('before-quit', async (event) => {
  // If this quit is from an update, skip graceful shutdown and quit immediately
  if (isUpdateQuit) {
    logger.info('[Updater] Update quit detected - skipping graceful shutdown for immediate restart');
    return; // Allow quit to proceed immediately
  }

  // Use timeout-based approach to handle normal quits:
  // - Normal quit: Shutdown completes quickly (under 5 seconds) and exits gracefully
  // - Hanging processes: Timeout after 5 seconds and force quit

  // If we're not already shutting down, start graceful shutdown
  if (!isShuttingDown) {
    // Prevent the app from quitting until we've completed shutdown sequence
    event.preventDefault();

    // Set the shutdown flag to prevent further shutdown attempts
    isShuttingDown = true;

    // Set the app.isQuitting flag to allow windows to close
    app.isQuitting = true;

    // Start the graceful shutdown process with timeout
    logger.info('Beginning application shutdown sequence...');
    const startTime = Date.now();

    // Set a timeout to handle hung shutdowns
    // This allows updates to proceed if shutdown gets stuck
    const shutdownTimeout = setTimeout(() => {
      const elapsed = Date.now() - startTime;
      logger.warn(`Shutdown sequence timed out after ${elapsed}ms (5000ms limit), allowing quit to proceed (likely due to update or hung process)`);
      // Use app.quit() instead of app.exit(0) to be more update-friendly
      // If this doesn't work, the OS/update installer will handle it
      setImmediate(() => app.quit());
    }, 5000); // 5 second timeout - sufficient for normal shutdown, handles interference

    try {
      // Stop all services in the correct order
      const serviceManager = ServiceManager.getInstance();
      await serviceManager.stopServices();

      // Clean up tmp CLI file
      await cleanupTmpCli();

      const elapsed = Date.now() - startTime;
      logger.info(`Shutdown sequence complete in ${elapsed}ms, quitting application.`);

      // Clear the timeout since we completed successfully
      clearTimeout(shutdownTimeout);

      // Allow quit to proceed naturally - don't force it
      setImmediate(() => app.quit());
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error(`Error during shutdown sequence after ${elapsed}ms:`, error);
      clearTimeout(shutdownTimeout);

      // Even on error, allow quit to proceed naturally
      setImmediate(() => app.quit());
    }
  }
});

/**
 * Copy the CLI executable to the tmp directory
 * This ensures the CLI is accessible and executable from a writable location
 */
async function copyCLIToTmpDirectory(): Promise<void> {
  try {
    // Get the source CLI path based on environment
    let sourcePath: string;

    if (app.isPackaged) {
      // In production builds, the CLI is stored in the Resources directory
      if (process.platform === 'darwin') {
        // On macOS, the path is in Contents/Resources
        sourcePath = path.join(process.resourcesPath, 'cli.js');
      } else {
        // On Windows/Linux, just use resourcesPath directly
        sourcePath = path.join(process.resourcesPath, 'cli.js');
      }
    } else {
      // In development, use the path in the dist directory
      sourcePath = path.join(app.getAppPath(), 'dist', 'bin', 'cli.js');
    }

    // Check if source file exists
    if (!fs.existsSync(sourcePath)) {
      logger.error(`CLI source file not found at: ${sourcePath}`);
      return;
    }

    // Create tmp directory path for MCP Defender
    const tmpDir = path.join(os.tmpdir(), 'mcp-defender');

    // Ensure tmp directory exists
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Set destination path
    const destPath = path.join(tmpDir, 'cli.js');

    // Copy the file
    fs.copyFileSync(sourcePath, destPath);

    // Make it executable (important for Unix-like systems)
    if (process.platform !== 'win32') {
      fs.chmodSync(destPath, '755');
    }

    // Store the tmp CLI path globally
    tmpCliPath = destPath;

    logger.info(`CLI copied successfully from ${sourcePath} to ${destPath}`);
  } catch (error) {
    logger.error('Failed to copy CLI to tmp directory:', error);
    throw error;
  }
}

/**
 * Get the path to the CLI executable in the tmp directory
 * @returns The path to the CLI or null if not copied yet
 */
export function getTmpCliPath(): string | null {
  return tmpCliPath;
}



/**
 * Clean up the CLI file from the tmp directory
 */
async function cleanupTmpCli(): Promise<void> {
  if (tmpCliPath && fs.existsSync(tmpCliPath)) {
    try {
      fs.unlinkSync(tmpCliPath);
      logger.info(`Cleaned up tmp CLI file: ${tmpCliPath}`);
    } catch (error) {
      logger.error('Failed to clean up tmp CLI file:', error);
    }
  }
}
