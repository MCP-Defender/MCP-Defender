import path from 'node:path';
import { app, ipcMain, safeStorage } from 'electron';
import fs from 'node:fs';
import crypto from 'crypto';
import { BaseService, ServiceEvent, ServiceEventBus } from '../base-service';
import { Settings, ScanMode, NotificationSettings } from './types';
import { registerSettingsHandlers } from './handlers';
import { DefenderServiceEvent } from '../defender/types';
import { ServiceManager } from '../service-manager';

// Constants
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

/**
 * Service for managing application settings
 */
export class SettingsService extends BaseService {
    private settings: Settings;

    constructor() {
        super('Settings');
        this.settings = this.getDefaultSettings();

        // Listen for defender ready event
        const serviceManager = ServiceManager.getInstance();
        serviceManager.defenderService.on(DefenderServiceEvent.READY, () => {
            this.logger.info('Defender service is ready, sending settings');
            this.updateSettings({});
        });
    }

    /**
     * Start the settings service
     */
    start(): boolean {

        // Load settings immediately
        this.loadSettings();

        if (!super.start()) return false;

        // Initialize login item settings to match our stored preference
        this.initializeLoginItemSettings();

        this.logger.info(`Starting settings service from ${SETTINGS_FILE}`);
        return true;
    }

    /**
     * Stop the settings service
     */
    stop(): boolean {
        if (!super.stop()) return false;

        this.logger.info('Stopping settings service');
        this.saveSettings();
        return true;
    }

    /**
     * Get the current settings
     */
    getSettings(): Settings {
        // Create a copy of settings with disabledSignatures as Array for IPC serialization
        const settingsCopy = { ...this.settings };

        // Convert Set to Array for JSON serialization
        if (settingsCopy.disabledSignatures instanceof Set) {
            settingsCopy.disabledSignatures = Array.from(settingsCopy.disabledSignatures) as any;
        } else {
            settingsCopy.disabledSignatures = [] as any; // Ensure it's always an array
        }

        return settingsCopy;
    }

    /**
     * Update settings with new values
     */
    updateSettings(newSettings: Partial<Settings>): boolean {
        try {
            // Special handling for disabledSignatures to ensure it's a Set
            if (newSettings.disabledSignatures !== undefined) {
                // Convert array to Set if needed
                if (Array.isArray(newSettings.disabledSignatures)) {
                    newSettings = {
                        ...newSettings,
                        disabledSignatures: new Set(newSettings.disabledSignatures)
                    };
                }
            }

            // Special handling for startOnLogin to update system login items
            if (newSettings.startOnLogin !== undefined) {
                this.setLoginItemSettings(newSettings.startOnLogin);
            }

            // Merge new settings with existing settings
            this.settings = this.mergeSettings(this.settings, newSettings);

            // Save changes to disk
            this.saveSettings();

            // Create a copy of settings for sending to other services
            const settingsCopy = { ...this.settings };

            // Always provide decrypted API key when notifying other services
            // This ensures defender service always gets usable key regardless of encryption
            if (settingsCopy.llm && settingsCopy.llm.apiKey) {
                settingsCopy.llm = {
                    ...settingsCopy.llm,
                    apiKey: this.getDecryptedApiKey() // Always gets decrypted value
                };
                this.logger.debug('Sending decrypted API key to services');
            }

            // Always include the login token if available
            if (this.settings.user && this.settings.user.loginToken) {
                settingsCopy.user = {
                    ...settingsCopy.user,
                    loginToken: this.settings.user.loginToken
                };
                this.logger.debug('Sending login token to services');
            }

            // Convert Set to Array for JSON serialization when sending to services
            if (settingsCopy.disabledSignatures instanceof Set) {
                settingsCopy.disabledSignatures = Array.from(settingsCopy.disabledSignatures) as any;
            } else {
                settingsCopy.disabledSignatures = [] as any; // Ensure it's always an array
            }

            // Notify other services about the update
            this.publishEvent(ServiceEvent.SETTINGS_UPDATED, settingsCopy);

            return true;
        } catch (error) {
            this.logger.error('Failed to update settings', error);
            return false;
        }
    }

    /**
     * Get user email
     * Returns the email value (no encryption for email)
     */
    getUserEmail(): string {
        if (!this.settings.user.email) {
            return '';
        }

        return this.settings.user.email;
    }

    /**
     * Set user email
     * Stores the email (no encryption for email)
     */
    setUserEmail(email: string): boolean {
        try {
            return this.updateSettings({
                user: {
                    ...this.settings.user,
                    email: email
                }
            });
        } catch (error) {
            this.logger.error('Failed to store email:', error);
            return false;
        }
    }

    /**
     * Set user login token
     * Stores the token (no encryption for login token)
     */
    setLoginToken(token: string): boolean {
        try {
            return this.updateSettings({
                user: {
                    ...this.settings.user,
                    loginToken: token
                }
            });
        } catch (error) {
            this.logger.error('Failed to store token:', error);
            return false;
        }
    }

    /**
     * Check if onboarding has been completed
     * Criteria: User has email or auth token, or LLM settings are configured
     */
    isOnboardingCompleted(): boolean {
        return this.settings.onboardingCompleted;
    }

    /**
     * Complete onboarding
     */
    completeOnboardingSkipEmail(): boolean {
        // Update status
        this.updateSettings({
            onboardingCompleted: true
        });

        return true;
    }

    completeOnboardingLogin(): boolean {
        // Update status to mark onboarding as completed
        this.updateSettings({
            onboardingCompleted: true
        });

        return true;
    }

    /**
     * Process a deep link
     */
    processDeepLink(url: string): boolean {
        try {
            const parsedUrl = new URL(url);
            const action = parsedUrl.searchParams.get('action');

            this.logger.info(`Processing deep link with action: ${action}`);

            if (!action) {
                this.logger.warn('No action parameter in deep link');
                return false;
            }

            // Handle different action types
            switch (action) {
                case 'logged_in':
                    // Login verification action
                    this.publishEvent('app:deep-link', url);
                    return true;

                case 'payment_success':
                    // Payment success action
                    this.logger.info('Payment success deep link received');
                    this.publishEvent('app:deep-link', url);
                    return true;

                case 'payment_canceled':
                    // Payment canceled action
                    this.logger.info('Payment canceled deep link received');
                    this.publishEvent('app:deep-link', url);
                    return true;

                default:
                    this.logger.warn(`Unknown action in deep link: ${action}`);
                    return false;
            }
        } catch (error) {
            this.logger.error('Error processing deep link:', error);
            return false;
        }
    }

    /**
     * Get default settings
     */
    private getDefaultSettings(): Settings {
        return {
            user: {
                email: '',
                loginToken: ''
            },
            llm: {
                model: "gpt-5",
                apiKey: "",
                provider: "OpenAI"
            },
            scanMode: ScanMode.REQUEST_ONLY,
            notificationSettings: NotificationSettings.CONFIG_UPDATES, // Enable config update notifications by default
            onboardingCompleted: false,
            disabledSignatures: new Set<string>(),
            startOnLogin: true, // Enable start on login by default for security app
            enableSSEProxying: false, // SSE transport is unstable, disabled by default
            useMCPDefenderSecureTools: false // MCP Defender Secure Tools enabled by default
        };
    }

    /**
     * Load settings from disk
     */
    private loadSettings(): void {
        try {
            // Check if the file exists
            if (!fs.existsSync(SETTINGS_FILE)) {
                this.logger.info('Settings file not found, creating with defaults');
                this.saveSettings();
                return;
            }

            // Read the file
            const fileContents = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const loadedSettings = JSON.parse(fileContents);

            // Convert disabledSignatures from array to Set
            if (loadedSettings.disabledSignatures && Array.isArray(loadedSettings.disabledSignatures)) {
                loadedSettings.disabledSignatures = new Set(loadedSettings.disabledSignatures);
            } else {
                loadedSettings.disabledSignatures = new Set<string>();
            }

            // Migration: Change mcp-defender model to gpt-5
            if (loadedSettings.llm && loadedSettings.llm.model === 'mcp-defender') {
                this.logger.info('Migrating from mcp-defender to gpt-5 model');
                loadedSettings.llm.model = 'gpt-5';
                loadedSettings.llm.provider = 'OpenAI';
            }

            // Merge with default settings to ensure we have all fields
            this.settings = this.mergeSettings(this.getDefaultSettings(), loadedSettings);
            this.logger.info('Settings loaded successfully');
        } catch (error) {
            this.logger.error('Failed to load settings', error);
            // Fall back to default settings
            this.settings = this.getDefaultSettings();
        }
    }

    /**
     * Save settings to disk
     */
    private saveSettings(): void {
        try {
            // Ensure the directory exists
            const dir = path.dirname(SETTINGS_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Create a copy for serialization
            const settingsToSave = { ...this.settings };

            // Convert Set to Array for JSON serialization - always use an array even if empty
            if (settingsToSave.disabledSignatures instanceof Set) {
                settingsToSave.disabledSignatures = Array.from(settingsToSave.disabledSignatures) as any;
            } else {
                settingsToSave.disabledSignatures = [] as any; // Ensure it's always an array
            }

            // Write the file
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsToSave, null, 2));
            this.logger.info('Settings saved successfully');
        } catch (error) {
            this.logger.error('Failed to save settings', error);
        }
    }

    /**
     * Deep merge settings objects
     */
    private mergeSettings(target: any, source: any): any {
        const result = { ...target };

        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                // Special handling for disabledSignatures Set
                if (key === 'disabledSignatures') {
                    // Just use the source set directly
                    result[key] = source[key];
                }
                else if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    // If property exists in target and is an object, merge recursively
                    if (key in target && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                        result[key] = this.mergeSettings(target[key], source[key]);
                    } else {
                        // Otherwise just copy
                        result[key] = source[key];
                    }
                } else {
                    // For non-objects, just override
                    result[key] = source[key];
                }
            }
        }

        return result;
    }

    /**
     * Get OpenAI API key
     * Returns decrypted API key if available
     */
    getDecryptedApiKey(): string {
        if (!this.settings.llm.apiKey) {
            return '';
        }

        try {
            // If safe storage is available, attempt to decrypt
            // If this fails, it was probably not encrypted
            if (safeStorage.isEncryptionAvailable()) {
                try {
                    const buffer = Buffer.from(this.settings.llm.apiKey, 'base64');
                    return safeStorage.decryptString(buffer);
                } catch (e) {
                    // If decryption fails, return as-is (wasn't encrypted)
                    this.logger.debug('API key not encrypted or invalid format');
                    return this.settings.llm.apiKey;
                }
            }

            // No encryption available, return as-is
            return this.settings.llm.apiKey;
        } catch (error) {
            this.logger.error('Failed to handle OpenAI API key:', error);
            return '';
        }
    }

    /**
     * Set OpenAI API key
     * Encrypts and stores the API key if possible
     */
    encryptApiKey(apiKey: string): boolean {
        try {
            let storedValue = apiKey;

            // Only encrypt if safe storage is available and we have a key
            if (safeStorage.isEncryptionAvailable() && apiKey) {
                this.logger.debug('Encrypting API key');
                const encrypted = safeStorage.encryptString(apiKey);
                storedValue = encrypted.toString('base64');
            } else {
                this.logger.debug('Storing API key without encryption');
            }

            // Update settings with the key (encrypted or not)
            return this.updateSettings({
                llm: {
                    ...this.settings.llm,
                    apiKey: storedValue
                }
            });
        } catch (error) {
            this.logger.error('Failed to handle and store OpenAI API key:', error);
            return false;
        }
    }

    /**
     * Set login item settings using Electron's API
     * This controls whether the app starts when the user logs into their computer
     */
    private setLoginItemSettings(enabled: boolean): void {
        try {
            this.logger.info(`Setting login item to: ${enabled}`);

            app.setLoginItemSettings({
                openAtLogin: enabled,
                openAsHidden: true, // Start minimized to tray
                name: 'MCP Defender',
                path: process.execPath
            });

            this.logger.info(`Login item settings updated successfully`);
        } catch (error) {
            this.logger.error('Failed to update login item settings:', error);
        }
    }

    /**
     * Get current login item settings from the system
     * This checks the actual system state, not just our stored setting
     */
    getLoginItemSettings(): { openAtLogin: boolean; openAsHidden: boolean } {
        try {
            return app.getLoginItemSettings();
        } catch (error) {
            this.logger.error('Failed to get login item settings:', error);
            return { openAtLogin: false, openAsHidden: false };
        }
    }

    /**
     * Initialize login item settings on app start
     * This ensures the system state matches our stored setting
     */
    initializeLoginItemSettings(): void {
        try {
            // Get current system state
            const systemSettings = this.getLoginItemSettings();
            const ourSetting = this.settings.startOnLogin;

            this.logger.info(`System login item: ${systemSettings.openAtLogin}, Our setting: ${ourSetting}`);

            // If they don't match, update the system to match our setting
            if (systemSettings.openAtLogin !== ourSetting) {
                this.logger.info(`Syncing login item setting: ${ourSetting}`);
                this.setLoginItemSettings(ourSetting);
            }
        } catch (error) {
            this.logger.error('Failed to initialize login item settings:', error);
        }
    }
}