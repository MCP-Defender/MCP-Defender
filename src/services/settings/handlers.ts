import { ipcMain, shell, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SettingsService } from './service';
import { BrowserWindow } from 'electron';
import { ServiceEvent, ServiceEventBus } from '../base-service';
import { ServiceManager } from '../service-manager';
import { showMainWindow, createTray, showSettingsWindow } from '../../ipc-handlers/ui-manager';
import { toast } from '../../utils/toast';
import { createTestSecurityAlert } from '../../utils/security-alert-handler';

// The settings service instance
let settingsService: SettingsService;

// API base URL
const API_BASE_URL = 'https://api.mcpdefender.com';

/**
 * Shared function to make login API request
 */
async function makeLoginRequest(email: string) {
    try {
        // Get app version and platform from Electron
        const appVersion = app.getVersion();
        const appPlatform = process.platform;

        // Call the login API endpoint with app version and platform
        const response = await fetch(
            `${API_BASE_URL}/login?email=${encodeURIComponent(email)}&app_version=${appVersion}&app_platform=${appPlatform}`,
            { method: 'POST' }
        );

        // Check if the request was successful
        if (response.ok) {
            const loginRequestId = await response.text();

            // Store the email and login token in settings
            settingsService.setUserEmail(email);
            settingsService.setLoginToken(loginRequestId);

            return {
                success: true,
                loginRequestId
            };
        } else {
            throw new Error(`Request failed with status: ${response.status}`);
        }
    } catch (error) {
        console.error('Error making login request:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}

/**
 * Register all settings related IPC handlers
 * @param service The settings service instance
 */
export function registerSettingsHandlers(service: SettingsService): void {
    settingsService = service;

    // Get all settings
    ipcMain.handle('settingsAPI:getAll', async () => {
        return settingsService.getSettings();
    });

    // Update settings
    ipcMain.handle('settingsAPI:update', async (_, settings) => {
        // Check if we're updating LLM settings with an API key
        if (settings.llm && settings.llm.apiKey !== undefined) {
            console.log('Settings update contains API key, handling encryption');

            // Get the current API key for comparison
            const currentApiKey = settingsService.getDecryptedApiKey();

            // Only encrypt if the key has changed
            if (settings.llm.apiKey !== currentApiKey) {
                console.log('API key has changed, handling with encryption');

                // Use the special method that handles encryption
                settingsService.encryptApiKey(settings.llm.apiKey);

                // Remove API key from settings to prevent double-handling
                const updatedSettings = { ...settings };
                if (updatedSettings.llm) {
                    delete updatedSettings.llm.apiKey;
                }

                // If there are other settings to update, do it now
                if (Object.keys(updatedSettings).length > 0 &&
                    (Object.keys(updatedSettings).length > 1 ||
                        (updatedSettings.llm && Object.keys(updatedSettings.llm).length > 0))) {
                    return settingsService.updateSettings(updatedSettings);
                }

                // Otherwise we're done
                return true;
            }
        }

        // Standard settings update with no API key change
        return settingsService.updateSettings(settings);
    });


    // Open signatures directory
    ipcMain.handle('settingsAPI:openSignaturesDirectory', async () => {
        try {
            // Get the signatures directory path
            const signaturesPath = path.join(app.getPath('userData'), 'signatures');

            // Ensure the directory exists
            await fs.mkdir(signaturesPath, { recursive: true });

            // Open the directory in the system's file explorer
            await shell.openPath(signaturesPath);
            return true;
        } catch (error) {
            console.error('[Settings] Failed to open signatures directory', error);
            throw error;
        }
    });

    // Open signatures directory
    ipcMain.handle('settingsAPI:openLogsDirectory', async () => {
        try {
            // Get the signatures directory path
            const logsPath = path.join(app.getPath('userData'), 'logs');

            // Open the directory in the system's file explorer
            await shell.openPath(logsPath);
            return true;
        } catch (error) {
            console.error('[Settings] Failed to open signatures directory', error);
            throw error;
        }
    });

    // Open external URL in default browser
    ipcMain.handle('settingsAPI:openExternalUrl', async (_, url: string) => {
        try {
            // Open the URL in the default browser
            await shell.openExternal(url);
            return true;
        } catch (error) {
            console.error('[Settings] Failed to open external URL', error);
            throw error;
        }
    });

    // Save disabled signatures
    ipcMain.handle('settingsAPI:saveDisabledSignatures', async (_event, signatureIds: string[]) => {
        try {
            // Update the disabled signatures in settings
            const success = await settingsService.updateSettings({
                disabledSignatures: new Set(signatureIds)
            });

            if (success) {
                // Emit event to the service event bus which all services listen to
                ServiceEventBus.emit(ServiceEvent.SETTINGS_UPDATED, {
                    disabledSignatures: new Set(signatureIds)
                });

                toast.success("Signature selection saved");
            }

            return success;
        } catch (error) {
            console.error('[Settings] Failed to save disabled signatures', error);
            throw error;
        }
    });

    // ============== Account-related handlers ==============

    // Send login email
    ipcMain.handle('accountAPI:login', async (_event, email: string) => {
        return await makeLoginRequest(email);
    });

    // Verify login
    async function verifyLogin() {
        try {
            const settings = settingsService.getSettings();
            const loginToken = settings.user.loginToken;

            if (!loginToken) {
                return {
                    success: false,
                    error: 'No login token found'
                };
            }

            // Get app version and platform from Electron
            const appVersion = app.getVersion();
            const appPlatform = process.platform;

            // Call the verify_login API endpoint
            const response = await fetch(
                `${API_BASE_URL}/verify_login?login_request_id=${encodeURIComponent(loginToken)}&app_version=${appVersion}&app_platform=${appPlatform}`,
                { method: 'POST' }
            );

            return {
                success: response.ok
            };
        } catch (error) {
            console.error('Error verifying login:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }

    // Verify login
    ipcMain.handle('accountAPI:verifyLogin', async () => {
        return await verifyLogin();
    });

    // Process deep link
    ipcMain.handle('accountAPI:processDeepLink', async (_event, url: string) => {
        try {
            const parsedUrl = new URL(url);
            const action = parsedUrl.searchParams.get('action');

            switch (action) {
                case 'logged_in':
                    // Call our verify login function directly
                    const loginResult = await verifyLogin();

                    // If login verification is successful, automatically set LLM to MCP Defender
                    if (loginResult.success) {
                        const currentSettings = settingsService.getSettings();
                        settingsService.updateSettings({
                            llm: {
                                ...currentSettings.llm,
                                model: 'mcp-defender',
                                provider: 'mcp-defender'
                            }
                        });
                        console.log('Successfully set LLM provider to MCP Defender after login');
                    }

                    return loginResult;

                case 'payment_success':
                    // Handle successful payment
                    toast.success("Payment processed successfully");
                    return {
                        success: true,
                        action: 'payment_success',
                        message: 'Payment was processed successfully'
                    };

                case 'payment_canceled':
                    // Handle canceled payment
                    toast.info("Payment was canceled");
                    return {
                        success: true,
                        action: 'payment_canceled',
                        message: 'Payment was canceled'
                    };

                default:
                    return {
                        success: false,
                        error: `Unknown action in deep link: ${action}`
                    };
            }
        } catch (error) {
            console.error('Error processing deep link:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    // Get account details
    ipcMain.handle('accountAPI:getDetails', async () => {
        try {
            const settings = settingsService.getSettings();
            const loginToken = settings.user.loginToken;

            if (!loginToken) {
                return {
                    success: false,
                    error: 'No login token found'
                };
            }

            // Call the get_account_details API endpoint
            const response = await fetch(
                `${API_BASE_URL}/get_account_details?login_request_id=${encodeURIComponent(loginToken)}`
            );

            if (response.ok) {
                const details = await response.json();
                return {
                    success: true,
                    details
                };
            } else {
                throw new Error(`Request failed with status: ${response.status}`);
            }
        } catch (error) {
            console.error('Error getting account details:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    // Logout
    ipcMain.handle('accountAPI:logout', async () => {
        try {
            const settings = settingsService.getSettings();
            const loginToken = settings.user.loginToken;

            if (loginToken) {
                // Call the logout API endpoint
                await fetch(
                    `${API_BASE_URL}/logout?login_request_id=${encodeURIComponent(loginToken)}`,
                    { method: 'POST' }
                );
            }

            // Clear the email and login token
            settingsService.updateSettings({
                user: {
                    email: '',
                    loginToken: ''
                }
            });

            return { success: true };
        } catch (error) {
            console.error('Error logging out:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    // Create checkout link
    ipcMain.handle('accountAPI:createCheckoutLink', async () => {
        try {
            const settings = settingsService.getSettings();
            const loginToken = settings.user.loginToken;

            if (!loginToken) {
                return {
                    success: false,
                    error: 'No login token found'
                };
            }

            // Call the create_checkout_link API endpoint
            const response = await fetch(
                `${API_BASE_URL}/create_checkout_link?login_request_id=${encodeURIComponent(loginToken)}`,
                { method: 'POST' }
            );

            if (response.ok) {
                const url = await response.text();
                return {
                    success: true,
                    url
                };
            } else if (response.status === 409) {
                return {
                    success: false,
                    error: 'User already has a subscription'
                };
            } else if (response.status === 403) {
                return {
                    success: false,
                    error: 'User is not logged in'
                };
            } else {
                throw new Error(`Unexpected response: ${response.status}`);
            }
        } catch (error) {
            console.error('Error creating checkout link:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });

    // ============== Onboarding-related handlers ==============

    // Send verification email
    ipcMain.handle('onboardingAPI:sendEmail', async (_event, email: string) => {
        return await makeLoginRequest(email);
    });

    // Verify token
    ipcMain.handle('onboardingAPI:verifyToken', async (_event, token: string) => {
        // This should use the same verification logic as accountAPI:verifyLogin
        return await verifyLogin();
    });

    // Skip email verification and complete onboarding directly
    ipcMain.handle('onboardingAPI:skipEmailOnboarding', async () => {
        const success = settingsService.completeOnboardingSkipEmail();

        if (success) {
            // Start the remaining services now that onboarding is complete
            const serviceManager = ServiceManager.getInstance();

            // Start services and wait for them to initialize
            await serviceManager.startRemainingServices();

            // Wait a brief moment to ensure all services are fully ready
            await new Promise(resolve => setTimeout(resolve, 500));

            // Close the onboarding window if it's open
            const windows = BrowserWindow.getAllWindows();
            for (const window of windows) {
                if (window.webContents.getURL().includes('onboarding')) {
                    window.close();
                }
            }

            // Show the settings window and create tray for first-time setup
            showMainWindow();
            showSettingsWindow();
            createTray();
        }

        return { success };
    });

    // Complete onboarding after email verification
    ipcMain.handle('onboardingAPI:completeLoginOnboarding', async () => {
        const success = settingsService.completeOnboardingLogin();

        if (success) {
            // Start the remaining services now that onboarding is complete
            const serviceManager = ServiceManager.getInstance();
            serviceManager.startRemainingServices();

            // Close the onboarding window if it's open
            const windows = BrowserWindow.getAllWindows();
            for (const window of windows) {
                if (window.webContents.getURL().includes('onboarding')) {
                    window.close();
                }
            }

            // Show the settings window and create tray for first-time setup
            showMainWindow()
            showSettingsWindow();
            createTray();
        }

        return { success };
    });

    // Set notification settings
    ipcMain.handle('settingsAPI:setNotificationSettings', async (_, settings: number) => {
        try {
            // Update notification settings
            const success = await settingsService.updateSettings({
                notificationSettings: settings
            });

            if (success) {
                toast.success("Notification settings saved");
            }

            return success;
        } catch (error) {
            console.error('[Settings] Failed to save notification settings', error);
            throw error;
        }
    });

    // Get login item settings from system
    ipcMain.handle('settingsAPI:getLoginItemSettings', async () => {
        try {
            return settingsService.getLoginItemSettings();
        } catch (error) {
            console.error('[Settings] Failed to get login item settings', error);
            throw error;
        }
    });

    // ============== Developer-related handlers ==============

    // Trigger test security alert
    ipcMain.handle('settingsAPI:triggerTestSecurityAlert', async () => {
        try {
            console.log('[Settings] Triggering test security alert...');
            const allowed = await createTestSecurityAlert();
            console.log(`[Settings] Test security alert decision: ${allowed ? 'ALLOWED' : 'BLOCKED'}`);
            return {
                success: true,
                allowed
            };
        } catch (error) {
            console.error('[Settings] Failed to trigger test security alert', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    });
} 