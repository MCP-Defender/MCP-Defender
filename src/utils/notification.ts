import { Notification, app, ipcMain } from 'electron';
import path from 'path';
import { createLogger } from './logger';
import { showMainWindow, MainWindowTabs } from '../ipc-handlers/ui-manager';

const logger = createLogger('Notification');

// Register an IPC handler for notification clicks
let isHandlerRegistered = false;
function registerNotificationClickHandler() {
    if (!isHandlerRegistered) {
        ipcMain.on('notification:clicked', (event, data) => {
            logger.info(`Notification click handled via IPC: ${data?.type || 'unknown'}`);

            // Handle based on notification type
            if (data?.type === 'config_update' ||
                data?.type === 'tool_discovery' ||
                data?.type === 'tool_discovery_complete') {
                showMainWindow(MainWindowTabs.Apps);
            }
        });
        isHandlerRegistered = true;
    }
}

// Ensure we register the handler immediately when this module is imported
registerNotificationClickHandler();

/**
 * Utility for sending system notifications
 */
export const notification = {
    /**
     * Show a system notification
     * @param title The notification title
     * @param body The notification body text
     * @param notificationType Type of notification for routing click events
     * @param icon Optional icon path (relative to app resources)
     */
    show(title: string, body: string, notificationType?: string, icon?: string): void {
        try {
            // Ensure app is ready before creating notification
            if (!app.isReady()) {
                logger.warn('Cannot show notification, app not ready');
                return;
            }

            // Make sure our click handler is registered
            registerNotificationClickHandler();

            // Determine icon path
            let iconPath: string | undefined = undefined;
            if (icon) {
                // Use provided icon or default to app icon
                iconPath = app.isPackaged
                    ? path.join(process.resourcesPath, icon)
                    : path.join(app.getAppPath(), 'assets', icon);
            }

            // Create and show notification
            const notification = new Notification({
                title,
                body,
                icon: iconPath,
                silent: false
            });

            // Add click handler
            if (notificationType) {
                notification.on('click', () => {
                    logger.debug(`Notification clicked, emitting IPC event for type: ${notificationType}`);

                    // We need to use the main process event emitter since the notification
                    // click handler might run in a different context
                    ipcMain.emit('notification:clicked', null, { type: notificationType });
                });
            }

            notification.show();
            logger.debug(`Showing notification: ${title} - ${body}`);
        } catch (error) {
            logger.error(`Error showing notification: ${error}`);
        }
    },

    /**
     * Show a configuration update notification for a single app
     * @param appName The application name
     * @param serverCount Number of servers protected
     * @param requiresRestart Whether the app requires restart for changes to take effect
     */
    configUpdated(appName: string, serverCount: number, requiresRestart: boolean = false): void {
        const title = `${appName} Configuration Updated`;
        let body = `${serverCount} server${serverCount !== 1 ? 's' : ''} protected.`;

        if (requiresRestart) {
            body += ` ${appName} may require a restart for changes to take effect.`;
        }

        this.show(title, body, 'config_update');
    },

    /**
     * Show a consolidated notification for multiple app configurations
     * @param updates Array of app configuration updates
     */
    consolidatedConfigUpdates(updates: Array<{
        appName: string;
        serverCount: number;
        requiresRestart: boolean;
    }>): void {
        if (updates.length === 0) return;

        if (updates.length === 1) {
            // If only one update, use the regular notification
            const update = updates[0];
            this.configUpdated(update.appName, update.serverCount, update.requiresRestart);
            return;
        }

        // For multiple updates, create a consolidated notification
        const title = `Configuration Updates`;

        // Create a list of updated apps
        const totalProtectedServers = updates.reduce((sum, update) => sum + update.serverCount, 0);
        let body = `Updated ${updates.length} applications with ${totalProtectedServers} protected servers.`;

        // If any app requires restart, add that information
        const appsRequiringRestart = updates
            .filter(update => update.requiresRestart)
            .map(update => update.appName);

        if (appsRequiringRestart.length > 0) {
            if (appsRequiringRestart.length === 1) {
                body += `\n${appsRequiringRestart[0]} may require a restart.`;
            } else if (appsRequiringRestart.length === updates.length) {
                body += `\nAll applications may require a restart for changes to take effect.`;
            } else {
                body += `\nSome applications may require a restart for changes to take effect.`;
            }
        }

        this.show(title, body, 'config_update');
    }
}; 