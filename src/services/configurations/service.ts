import * as path from 'path';
import * as fs from 'fs';
import { app, BrowserWindow } from 'electron';
import { BaseService, ServiceEvent, ServiceEventBus } from '../base-service';
import { BaseMCPConfiguration } from '../configurations/base-configuration';
import { createLogger } from '../../utils/logger';
import { spawn } from 'node:child_process';
import http from 'node:http';
import {
    ConfigOperationResult,
    ProtectedServerConfig,
    ProtectionStatus,
    StatusChangeCallback,
    MCPApplication,
    MCPDefenderEnvVar,
} from './types';
import { notification } from '../../utils/notification';
import { NotificationSettings } from '../settings/types';
import { getTmpCliPath } from '../../main';

// Create a logger for the configurations service
const logger = createLogger('ConfigurationsService');

// Global set to track files we've recently modified ourselves
// This helps prevent infinite loops with file watchers
export const recentlyModifiedByUs = new Set<string>();

// Import the configuration factory
import { createConfiguration, detectApplicationFromConfigPath } from './adapters/configuration-factory';
import { registerConfigurationsHandlers } from './handlers';
import { DefenderServiceEvent } from '../defender/types';
import { ServiceManager } from '../service-manager';

/**
 * Service for managing MCP configurations across applications
 * 
 * This service manages the MCP configuration files for various applications,
 * handling protection, restoration, and real-time monitoring of these files.
 */
export class ConfigurationsService extends BaseService {
    // Map of application name to application data
    private applications: Map<string, MCPApplication> = new Map();

    // Map of application name to configuration handler
    private configurations: Map<string, BaseMCPConfiguration> = new Map();

    // Path to CLI executable
    private cliPath: string;

    // File watchers for configuration files
    private fileWatchers: Map<string, fs.FSWatcher> = new Map();

    // Track which applications are currently being processed to prevent loops
    private processingApplications: Set<string> = new Set();

    // Track debounce timers for file watchers
    private watcherDebounceTimers: Map<string, NodeJS.Timeout> = new Map();

    // Track servers with active tool discovery to prevent duplicate requests
    private discoveringTools: Set<string> = new Set();

    // Track configuration updates for consolidated notifications
    private pendingConfigUpdates: Array<{
        appName: string;
        serverCount: number;
        requiresRestart: boolean;
    }> = [];

    // Debounce timer for consolidated notifications
    private notificationDebounceTimer: NodeJS.Timeout | null = null;

    /**
     * Create a new ConfigurationsService instance
     */
    constructor() {
        super('Configurations');

        // Get path to CLI executable from tmp directory
        const tmpCliPath = getTmpCliPath();
        if (tmpCliPath) {
            this.cliPath = tmpCliPath;
            this.logger.info(`Using tmp CLI path: ${this.cliPath}`);
        } else {
            // Fallback to original logic if tmp path not available yet
            if (app.isPackaged) {
                // In production builds, the CLI is stored in the Resources directory
                // as specified by extraResource in forge.config.ts
                if (process.platform === 'darwin') {
                    // On macOS, the path is in Contents/Resources
                    this.cliPath = path.join(process.resourcesPath, 'cli.js');
                } else {
                    // On Windows/Linux, just use resourcesPath directly
                    this.cliPath = path.join(process.resourcesPath, 'cli.js');
                }
                this.logger.info(`Using fallback production CLI path: ${this.cliPath}`);
            } else {
                // In development, use the path in the dist directory
                this.cliPath = path.join(app.getAppPath(), 'dist', 'bin', 'cli.js');
                this.logger.info(`Using fallback development CLI path: ${this.cliPath}`);
            }
        }

        // Listen for defender ready event
        const serviceManager = ServiceManager.getInstance();
        serviceManager.defenderService.on(DefenderServiceEvent.READY, () => {
            this.logger.info('Defender service is ready, sending configurations');
            this.notifyDefenderAndWebContents();
        });

        // Listen for settings updates to handle secure tools server changes
        ServiceEventBus.on(ServiceEvent.SETTINGS_UPDATED, (settings) => {
            this.logger.info('Received settings update, checking for secure tools changes');
            this.handleSecureToolsSettingChange(settings);
        });

        // Listen directly to the DefenderService for tool updates
        serviceManager.defenderService.on(DefenderServiceEvent.TOOLS_UPDATE, (toolsData) => {
            this.logger.info(`Received tools update for ${toolsData.appName}/${toolsData.serverName}`);
            this.handleToolsUpdate(toolsData);

            // Clear discovering flag for this server
            const key = `${toolsData.appName}:${toolsData.serverName}`;
            this.discoveringTools.delete(key);
        });

        // Listen for tool discovery completion events
        serviceManager.defenderService.on(DefenderServiceEvent.TOOLS_DISCOVERY_COMPLETE, (data) => {
            const { appName, serverName, success } = data;
            this.logger.info(`Tool discovery complete for ${appName}/${serverName}: ${success ? 'success' : 'failed'}`);

            // Get the application
            const app = this.getApplication(appName);
            if (!app) {
                this.logger.warn(`Application not found: ${appName}`);
                return;
            }

            // Update status based on discovery result
            if (success) {
                this.updateApplicationStatus(app, ProtectionStatus.Protected,
                    `Tools discovered for ${serverName}`);
            }

            // Clear discovering flag for this server
            const key = `${appName}:${serverName}`;
            this.discoveringTools.delete(key);
        });

        // No need to register IPC handlers here as they're handled in handlers.ts
    }

    /**
     * Update the CLI path to use the tmp directory version
     * This should be called after the CLI has been copied to tmp
     */
    updateCliPath(): void {
        const tmpCliPath = getTmpCliPath();
        if (tmpCliPath && tmpCliPath !== this.cliPath) {
            this.logger.info(`Updating CLI path from ${this.cliPath} to ${tmpCliPath}`);
            this.cliPath = tmpCliPath;
        }
    }

    /**
     * Get an application by name
     * @param name The name of the application
     * @returns The application or undefined if not found
     */
    getApplication(name: string): MCPApplication | undefined {
        return this.applications.get(name);
    }

    /**
     * Actively discovers tools for a STDIO server by creating a temporary process
     * that runs the CLI in discovery mode
     * 
     * @param appName The application name containing the server
     * @param serverName The server name to discover tools for
     * @param forceDiscovery If true, discover even if tools already exist
     * @returns A promise that resolves when discovery completes
     */
    async discoverSTDIOServerTools(appName: string, serverName: string, forceDiscovery = false): Promise<boolean> {
        logger.info(`Checking if tools discovery needed for ${appName}/${serverName}`);

        // Create a key for this server
        const serverKey = `${appName}:${serverName}`;

        // Check if already discovering tools for this server
        if (this.discoveringTools.has(serverKey)) {
            logger.info(`Tool discovery already in progress for ${appName}/${serverName}`);
            return false;
        }

        // Get the application
        const app = this.getApplication(appName);
        if (!app) {
            logger.error(`Application not found: ${appName}`);
            return false;
        }

        // Find the server
        const server = app.servers.find(s => s.serverName === serverName);
        if (!server) {
            logger.error(`Server not found: ${serverName} in app ${appName}. Available servers: ${app.servers.map(s => s.serverName).join(', ')}`);
            return false;
        }

        // Check if it's a STDIO server (doesn't have a URL property)
        const isStdioServer = !('url' in server.config) && 'command' in server.config;
        if (!isStdioServer) {
            logger.info(`Server ${serverName} is not a STDIO server, skipping tool discovery`);
            return false;
        }

        // Check if already has tools and force discovery not enabled
        if (!forceDiscovery && server.tools && server.tools.length > 0) {
            logger.info(`Server ${serverName} already has ${server.tools.length} tools, skipping discovery`);
            return false;
        }

        // Mark this server as being discovered BEFORE starting the process
        this.discoveringTools.add(serverKey);
        logger.info(`Added ${serverKey} to discovering tools set. Current discovering: ${Array.from(this.discoveringTools).join(', ')}`);

        // Update server state to show it's discovering (only if not already set)
        if (!server.isDiscovering) {
            server.isDiscovering = true;
            this.updateApplication(app);
            logger.info(`Marked server ${appName}/${serverName} as discovering in UI`);
        }

        try {
            logger.info(`Starting tool discovery for STDIO server: ${appName}/${serverName}`);

            // Since we know it's a STDIO server at this point, we can safely cast it
            const stdioConfig = server.config;

            // Use Node.js executable path instead of Electron to avoid dock icon issues on macOS
            // This gets the path to the Node.js executable used to run the Electron app
            const nodePath = process.platform === 'darwin' ? '/usr/local/bin/node' : 'node';

            // Create a new process to run the CLI in discovery mode
            // Using the Node.js executable directly prevents system-specific UI artifacts
            const discoveryProcess = spawn(nodePath, [
                this.cliPath,
                stdioConfig.command,
                ...stdioConfig.args
            ], {
                env: {
                    ...process.env,
                    ...server.config.env,
                    [MCPDefenderEnvVar.AppName]: appName,
                    [MCPDefenderEnvVar.ServerName]: serverName,
                    [MCPDefenderEnvVar.DiscoveryMode]: 'true',
                    PATH: process.env.PATH
                },
                stdio: 'pipe',
                // These options help prevent UI artifacts on all platforms
                detached: true,
                windowsHide: true
            });

            logger.info(`Started discovery process for ${appName}/${serverName} with PID: ${discoveryProcess.pid}`);

            // Unref the process to let it run independently of the parent
            if (discoveryProcess.unref) {
                discoveryProcess.unref();
            }

            // Set a timeout to kill the process if it takes too long
            const timeout = setTimeout(() => {
                try {
                    logger.warn(`Discovery timed out for ${appName}/${serverName}, killing process`);
                    discoveryProcess.kill();
                    this.discoveringTools.delete(serverKey);

                    // Update server state to clear discovering status
                    server.isDiscovering = false;
                    this.updateApplication(app);
                } catch (e) {
                    // Ignore errors when killing process
                }
            }, 10000); // 10 second timeout

            // Send tools/list request
            const toolsListRequest = JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list"
            }) + "\n";

            discoveryProcess.stdin.write(toolsListRequest);

            // Handle process exit
            discoveryProcess.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    logger.info(`Tool discovery process completed successfully for ${appName}/${serverName}`);
                } else {
                    logger.warn(`Tool discovery process exited with code ${code} for ${appName}/${serverName}`);
                    this.discoveringTools.delete(serverKey);

                    // Update server state to clear discovering status
                    server.isDiscovering = false;
                    this.updateApplication(app);
                }
            });

            // Handle errors
            discoveryProcess.on('error', (error) => {
                clearTimeout(timeout);
                logger.error(`Tool discovery error for ${appName}/${serverName}: ${error.message}`);
                this.discoveringTools.delete(serverKey);

                // Update server state to clear discovering status
                server.isDiscovering = false;
                this.updateApplication(app);
            });

            return true;
        } catch (error) {
            logger.error(`Failed to discover tools for ${appName}/${serverName}: ${error}`);
            this.discoveringTools.delete(serverKey);

            // Update server state to clear discovering status
            server.isDiscovering = false;
            this.updateApplication(app);

            return false;
        }
    }

    /**
     * Debug method to log current discovery state
     */
    private logDiscoveryState(): void {
        this.logger.info(`=== DISCOVERY STATE DEBUG ===`);
        this.logger.info(`Currently discovering tools for: ${Array.from(this.discoveringTools).join(', ')}`);

        for (const [appName, app] of this.applications.entries()) {
            const discoveringServers = app.servers.filter(s => s.isDiscovering);
            if (discoveringServers.length > 0) {
                this.logger.info(`${appName}: ${discoveringServers.map(s => s.serverName).join(', ')} are discovering`);
            }
        }
        this.logger.info(`=== END DISCOVERY STATE ===`);
    }

    /**
     * Discover tools for all servers without tools
     */
    async discoverToolsForAllServers(): Promise<void> {
        logger.info('Discovering tools for all servers without tools');

        // Log current state before starting
        this.logDiscoveryState();

        // Collect all servers that need discovery
        const serversToDiscover: Array<{
            app: MCPApplication;
            server: ProtectedServerConfig;
        }> = [];

        for (const app of this.applications.values()) {
            if (app.status === ProtectionStatus.Protected) {
                for (const server of app.servers) {
                    if (!server.tools || server.tools.length === 0) {
                        serversToDiscover.push({ app, server });
                    }
                }
            }
        }

        if (serversToDiscover.length === 0) {
            logger.info('No servers need tool discovery');
            return; // Nothing to discover
        }

        logger.info(`Starting discovery for ${serversToDiscover.length} servers`);

        // Set discovering state for all relevant apps and servers in batch
        const appsToUpdate = new Set<MCPApplication>();
        for (const { app, server } of serversToDiscover) {
            app.isDiscovering = true;
            server.isDiscovering = true;
            appsToUpdate.add(app);
        }

        // Update UI once for all apps
        for (const app of appsToUpdate) {
            this.updateApplication(app);
        }

        // Log state after setting discovering flags
        this.logDiscoveryState();

        // Process discoveries with minimal UI updates
        for (const { app, server } of serversToDiscover) {
            try {
                logger.info(`Processing discovery for ${app.name}/${server.serverName}`);

                // Handle based on server type
                if ('url' in server.config) {
                    // For SSE servers
                    await this.discoverSSEServerTools(app.name, server.serverName);
                } else if ('command' in server.config) {
                    // For STDIO servers
                    await this.discoverSTDIOServerTools(app.name, server.serverName);
                }

                // Add delay between discoveries to prevent overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                logger.error(`Error during tool discovery for ${app.name}/${server.serverName}:`, error);
                // Clear discovering state on error
                server.isDiscovering = false;
                this.updateApplication(app);
            }
        }

        // Clear app-level discovering flags in batch
        for (const app of appsToUpdate) {
            app.isDiscovering = false;
            this.updateApplication(app);
        }

        // Log final state
        this.logDiscoveryState();

        logger.info('Tool discovery batch completed');
    }

    /**
     * Update application data and notify listeners
     */
    private updateApplication(app: MCPApplication): void {
        // Update the applications map
        this.applications.set(app.name, app);

        // Notify listeners about the updated application
        this.publishEvent(ServiceEvent.CONFIGURATIONS_UPDATED, this.getApplications());

        // Notify renderer process about the updated application
        const windows = BrowserWindow.getAllWindows();
        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send('configurations:application-update', app);
            }
        }
    }

    /**
     * Handle tool updates from the defender
     * @param toolsData The tools update data
     */
    private handleToolsUpdate(toolsData: any): void {
        const { appName, serverName, tools } = toolsData;

        this.logger.info(`Processing tools update for ${appName}/${serverName}: ${tools.length} tools`);

        // Create a key for this server
        const serverKey = `${appName}:${serverName}`;

        // Validate that we have the required data
        if (!appName || !serverName || !Array.isArray(tools)) {
            this.logger.error(`Invalid tools update data: appName=${appName}, serverName=${serverName}, tools=${Array.isArray(tools) ? tools.length : 'not array'}`);
            return;
        }

        // Clear the discovering flag for this server
        if (this.discoveringTools.has(serverKey)) {
            this.logger.info(`Marking tool discovery as complete for ${appName}/${serverName}`);
            this.discoveringTools.delete(serverKey);
        } else {
            this.logger.warn(`Received tools update for ${appName}/${serverName} but no discovery was in progress. This might indicate a race condition or cross-contamination.`);
        }

        // Update application if it exists
        const app = this.applications.get(appName);
        if (!app) {
            this.logger.error(`Application ${appName} not found for tools update. Available apps: ${Array.from(this.applications.keys()).join(', ')}`);
            return;
        }

        // Find the server in the application
        const server = app.servers.find(s => s.serverName === serverName);
        if (!server) {
            this.logger.error(`Server ${serverName} not found in application ${appName}. Available servers: ${app.servers.map(s => s.serverName).join(', ')}`);
            return;
        }

        // Additional validation: check if this server was actually supposed to be discovering tools
        if (!server.isDiscovering) {
            this.logger.warn(`Received tools update for ${appName}/${serverName} but server was not marked as discovering. This might indicate cross-contamination from another app's server with the same name.`);

            // Check if there are other apps with servers of the same name that are discovering
            const otherDiscoveringServers = [];
            for (const [otherAppName, otherApp] of this.applications.entries()) {
                if (otherAppName !== appName) {
                    const otherServer = otherApp.servers.find(s => s.serverName === serverName && s.isDiscovering);
                    if (otherServer) {
                        otherDiscoveringServers.push(otherAppName);
                    }
                }
            }

            if (otherDiscoveringServers.length > 0) {
                this.logger.error(`POTENTIAL CROSS-CONTAMINATION DETECTED: Tools for ${appName}/${serverName} received, but ${otherDiscoveringServers.join(', ')} also have servers named '${serverName}' that are discovering. Rejecting this update to prevent cross-contamination.`);
                return;
            }
        }

        this.logger.info(`Updating tools for existing server: ${appName}/${serverName} (${tools.length} tools)`);
        server.tools = tools;

        // Clear the discovering state now that we have tools
        server.isDiscovering = false;

        this.notifyDefenderAndWebContents();
    }

    /**
     * Start the configurations service
     * Initializes system applications and starts watching their configs
     */
    start(): boolean {
        if (!super.start()) return false;

        this.logger.info('Starting configurations service');

        // Initialize system applications
        this.initializeSystemApplications();

        // Start watching all application configurations
        this.startWatchingAll();

        return true;
    }

    /**
     * Notify the defender service about configuration updates
     */
    public notifyDefenderAndWebContents(): void {
        const applications = this.getApplications();
        this.logger.info(`Publishing ${applications.length} application configurations to event bus`);
        this.publishEvent(ServiceEvent.CONFIGURATIONS_UPDATED, applications);

        // Forward all applications updated event to renderer
        const windows = BrowserWindow.getAllWindows();
        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send('configurations:all-applications-update', applications);
            }
        }
    }

    /**
     * Stop the configurations service
     * Clean up watchers and resources
     */
    async stop(): Promise<boolean> {
        if (!super.stop()) return false;

        this.logger.info('Stopping configurations service');

        // Stop all watchers
        this.stopWatchingAll();

        // Clear any remaining debounce timers
        for (const [appName, timer] of this.watcherDebounceTimers.entries()) {
            clearTimeout(timer);
        }
        this.watcherDebounceTimers.clear();
        this.processingApplications.clear();

        // Clear notification queue
        if (this.notificationDebounceTimer) {
            clearTimeout(this.notificationDebounceTimer);
            this.notificationDebounceTimer = null;
        }
        this.pendingConfigUpdates = [];

        // Remove all listeners
        this.removeAllListeners();

        // Restore all unprotected configs - run in parallel and continue even if some fail
        const restorePromises = Array.from(this.applications.values()).map(async (app) => {
            try {
                this.logger.info(`Restoring unprotected config for ${app.name}...`);
                const result = await this.restoreUnprotectedConfig(app.name);
                this.logger.info(`Restore result for ${app.name}: ${result.success ? 'Success' : 'Failed'} - ${result.message}`);
                return { appName: app.name, result };
            } catch (error) {
                this.logger.error(`Error restoring unprotected config for ${app.name}:`, error);
                return { appName: app.name, error };
            }
        });

        // Wait for all restorations to complete but don't fail if any fail
        const results = await Promise.allSettled(restorePromises);

        // Log summary
        const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as any).result?.success).length;
        const failed = results.length - succeeded;
        this.logger.info(`Restoration complete: ${succeeded} succeeded, ${failed} failed`);

        return true;
    }

    /**
     * Initialize built-in system applications
     * These are applications that we know support MCP and want to monitor by default
     */
    private initializeSystemApplications(): void {
        this.logger.info('Initializing system applications');

        // Initialize Cursor
        this.registerApplication({
            name: 'Cursor',
            status: ProtectionStatus.Loading,
            servers: [],
            isSystem: true,
            configurationPath: this.getStandardMCPConfigPath('Cursor'),
            isDiscovering: false,
        });

        // Initialize Claude
        this.registerApplication({
            name: 'Claude Desktop',
            status: ProtectionStatus.Loading,
            servers: [],
            isSystem: true,
            configurationPath: this.getStandardMCPConfigPath('Claude Desktop'),
            isDiscovering: false
        });

        // Initialize Windsurf
        this.registerApplication({
            name: 'Windsurf',
            status: ProtectionStatus.Loading,
            servers: [],
            isSystem: true,
            configurationPath: this.getStandardMCPConfigPath('Windsurf'),
            isDiscovering: false
        });

        // Initialize VS Code global settings
        this.registerApplication({
            name: 'Visual Studio Code',
            status: ProtectionStatus.Loading,
            servers: [],
            isSystem: true,
            configurationPath: this.getVSCodeConfigPath(),
            isDiscovering: false,
        });

        this.logger.info(`Initialized ${this.applications.size} system applications`);
    }

    /**
     * Get standard MCP config path for an application
     */
    private getStandardMCPConfigPath(appName: string): string {
        const config = createConfiguration(appName, this.cliPath);
        return config.getConfigPath();
    }

    /**
     * Get VSCode settings.json path
     */
    private getVSCodeConfigPath(): string {
        const config = createConfiguration('vscode', this.cliPath);
        return config.getConfigPath();
    }

    /**
     * Register a new application
     */
    registerApplication(app: MCPApplication): void {
        this.logger.info(`Registering application: ${app.name}`);

        this.applications.set(app.name, app);

        // Create configuration handler based on app type
        const config = createConfiguration(app.name, this.cliPath);

        // Set custom config path if provided in the app
        if (app.configurationPath) {
            // Check if the config has a setConfigPath method
            if ('setConfigPath' in config) {
                (config as any).setConfigPath(app.configurationPath);
            }
        }

        this.configurations.set(app.name, config);
        this.updateApplicationStatus(app, ProtectionStatus.Loading, "Processing configuration...");
    }

    /**
     * Get all registered applications
     */
    getApplications(): MCPApplication[] {
        return Array.from(this.applications.values());
    }

    /**
     * Process configuration for an application
     */
    async processConfig(appName: string): Promise<ConfigOperationResult> {
        const app = this.applications.get(appName);
        const config = this.configurations.get(appName);

        if (!app || !config) {
            return {
                success: false,
                message: `Application ${appName} not found`
            };
        }

        // Check if we're already processing this app
        if (this.processingApplications.has(appName)) {
            return {
                success: false,
                message: `Processing already in progress for ${appName}`
            };
        }

        try {
            // Mark as processing
            this.processingApplications.add(appName);

            this.logger.info(`Processing config for application: ${appName}`);

            // Update status to loading
            this.updateApplicationStatus(app, ProtectionStatus.Loading, "Processing configuration...");

            // Set the configuration path if needed
            if (app.configurationPath && 'setConfigPath' in config) {
                (config as any).setConfigPath(app.configurationPath);
            }

            // Get SSE proxying setting from settings service
            const serviceManager = ServiceManager.getInstance();
            const settings = serviceManager.settingsService.getSettings();
            const enableSSEProxying = settings.enableSSEProxying ?? false; // Default to false for safety

            // Process the configuration - pass application name and SSE setting
            const result = await config.processConfigFile(app.name, enableSSEProxying);

            // Update the application with the results
            if (result.success) {
                if (result.servers) {
                    app.servers = result.servers;

                    // Determine overall protection status
                    const unprotectedCount = result.servers.filter(s => !s.isProtected).length;
                    if (unprotectedCount === 0) {
                        if (result.servers.length > 0) {
                            this.updateApplicationStatus(app, ProtectionStatus.Protected, result.message);

                            // Queue notification about successful configuration update
                            const serverCount = result.servers.length;
                            const requiresRestart = config.requiresRestartForChanges?.() || false;
                            this.queueConfigurationUpdate(app.name, serverCount, requiresRestart);
                        } else {
                            this.updateApplicationStatus(app, ProtectionStatus.Error, "No servers found");
                        }
                    } else {
                        this.updateApplicationStatus(app, ProtectionStatus.Error, result.message);
                    }
                }
            } else {
                // Check if this is a file not found error
                if (result.isNotFound) {
                    this.updateApplicationStatus(app, ProtectionStatus.NotFound, result.message);
                } else {
                    this.updateApplicationStatus(app, ProtectionStatus.Error, result.message);
                }
            }

            return result;
        } finally {
            // Always remove from processing set when done
            this.processingApplications.delete(appName);
        }
    }

    /**
     * Restore unprotected config for an application
     * This removes our proxy and returns to the original MCP configuration
     */
    async restoreUnprotectedConfig(appName: string): Promise<ConfigOperationResult> {
        const app = this.applications.get(appName);
        const config = this.configurations.get(appName);

        if (!app || !config) {
            return {
                success: false,
                message: `Application ${appName} not found`
            };
        }

        this.logger.info(`Restoring unprotected config for: ${appName}`);

        // Update status
        this.updateApplicationStatus(app, ProtectionStatus.Loading, "Restoring unprotected configuration...");

        // Set the configuration path if needed
        if (app.configurationPath && 'setConfigPath' in config) {
            (config as any).setConfigPath(app.configurationPath);
        }

        // Restore the configuration
        const result = await config.restoreUnprotectedConfig();

        // Update the application with the results
        if (result.success) {
            if (result.servers) {
                app.servers = result.servers;
                // After successful restoration, set status to Loading instead of Error
                this.updateApplicationStatus(app, ProtectionStatus.Loading, "Unprotected configuration restored");
            }
        } else {
            // Check if this is a file not found error
            if (result.isNotFound) {
                this.updateApplicationStatus(app, ProtectionStatus.NotFound, result.message);
            } else {
                this.updateApplicationStatus(app, ProtectionStatus.Error, result.message);
            }
        }

        return result;
    }

    /**
     * Start monitoring configuration file for an application
     */
    async startWatchingConfig(appName: string): Promise<boolean> {
        const app = this.applications.get(appName);
        const config = this.configurations.get(appName);

        if (!app || !config) {
            return false;
        }

        try {
            // Skip if already watching
            if (this.fileWatchers.has(appName)) {
                return true;
            }

            this.logger.info(`Starting to watch config for: ${appName}`);

            // Process config initially
            this.processConfig(appName);

            // Check if configuration file exists before trying to watch it
            try {
                await fs.promises.stat(app.configurationPath);
            } catch (error: any) {
                if (error.code === 'ENOENT') {
                    this.logger.info(`Configuration file does not exist yet: ${app.configurationPath}. Will watch parent directory.`);
                    // We'll still set up watching for the parent directory in case the file gets created
                } else {
                    throw error; // Re-throw non-ENOENT errors
                }
            }

            // Keep track of last modified timestamp to handle duplicate events
            let lastModified = Date.now();

            // Watch for changes
            const watcher = fs.watch(app.configurationPath, (eventType, filename) => {
                // Skip if this file was recently modified by us to prevent infinite loops
                if (recentlyModifiedByUs.has(app.configurationPath)) {
                    this.logger.debug(`Ignoring change to ${appName} config - we just modified it`);
                    return;
                }

                // Skip if we're already processing this application
                if (this.processingApplications.has(appName)) {
                    this.logger.debug(`File change event ignored for ${appName} - already processing`);
                    return;
                }

                // Clear any existing debounce timer
                if (this.watcherDebounceTimers.has(appName)) {
                    clearTimeout(this.watcherDebounceTimers.get(appName));
                }

                // Set a debounce timer to wait for file operations to complete
                this.watcherDebounceTimers.set(
                    appName,
                    setTimeout(async () => {
                        try {
                            // Check if file exists and get modified time
                            const stats = await fs.promises.stat(app.configurationPath);
                            const currentModified = stats.mtimeMs;

                            // Skip if the change was too recent (likely our own change)
                            if (currentModified - lastModified < 500) {
                                this.logger.debug(`Skipping rapid-fire changes for ${appName}`);
                                return;
                            }

                            lastModified = currentModified;
                            this.logger.debug(`File change event detected for ${appName}`);

                            // Track previous server count and config state
                            const prevServerCount = app.servers.length;
                            const prevProtectedCount = app.servers.filter(s => s.isProtected).length;

                            // Process config
                            await this.processConfig(appName);

                            // Note: Notifications are now handled in processConfig
                        } catch (error) {
                            this.logger.error(`Error processing file change for ${appName}:`, error);
                        }
                    }, 500)
                );
            });

            this.fileWatchers.set(appName, watcher);
            return true;
        } catch (error) {
            this.logger.error(`Error starting to watch config for ${appName}:`, error);
            return false;
        }
    }

    /**
     * Stop monitoring configuration file for an application
     */
    stopWatchingConfig(appName: string): boolean {
        const app = this.applications.get(appName);
        const config = this.configurations.get(appName);

        if (!app || !config) {
            return false;
        }

        try {
            this.logger.info(`Stopping to watch config for: ${appName}`);

            // Remove file watcher
            const watcher = this.fileWatchers.get(appName);
            if (watcher) {
                watcher.close();
                this.fileWatchers.delete(appName);
            }

            return true;
        } catch (error) {
            this.logger.error(`Error stopping to watch config for ${appName}:`, error);
            return false;
        }
    }

    /**
     * Start monitoring all configuration files
     */
    startWatchingAll(): void {
        this.logger.info('Starting to watch all configuration files');

        // Clear any existing configuration updates
        this.pendingConfigUpdates = [];
        if (this.notificationDebounceTimer) {
            clearTimeout(this.notificationDebounceTimer);
            this.notificationDebounceTimer = null;
        }

        // Process all applications first
        const processPromises = Array.from(this.applications.values()).map(app => {
            return this.processConfig(app.name);
        });

        // Start watching all files
        for (const app of this.applications.values()) {
            this.startWatchingConfig(app.name).catch(error => {
                this.logger.error(`Failed to start watching config for ${app.name}:`, error);
            });
        }

        // Make sure queued notifications are processed
        if (this.pendingConfigUpdates.length > 0 && !this.notificationDebounceTimer) {
            this.notificationDebounceTimer = setTimeout(() => {
                this.processConfigurationUpdates();
            }, 500);
        }
    }

    /**
     * Stop monitoring all configuration files
     */
    stopWatchingAll(): void {
        this.logger.info('Stopping to watch all configuration files');

        for (const app of this.applications.values()) {
            this.stopWatchingConfig(app.name);
        }
    }

    /**
     * Update the status of an application and notify listeners
     * @param app The application to update
     * @param status The new protection status
     * @param message Optional status message
     */
    private updateApplicationStatus(app: MCPApplication, status: ProtectionStatus, message?: string): void {
        this.logger.info(`Updating status for ${app.name} to ${status} ${message ? `- ${message}` : ''}`);

        // Update the application status
        app.status = status;
        if (message) {
            app.statusMessage = message;
        }

        // Update the applications map
        this.applications.set(app.name, app);

        // Notify listeners about the updated application
        this.publishEvent(ServiceEvent.CONFIGURATIONS_UPDATED, this.getApplications());

        // Notify renderer process about the updated application
        const windows = BrowserWindow.getAllWindows();
        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send('configurations:application-update', app);
            }
        }
    }

    /**
     * Discover tools for an SSE server
     * @param appName The application name
     * @param serverName The server name
     * @param forceDiscovery Whether to force discovery even if already in progress
     * @returns Promise that resolves to true if discovery was started, false otherwise
     */
    async discoverSSEServerTools(appName: string, serverName: string, forceDiscovery = false): Promise<boolean> {
        const serverKey = `${appName}:${serverName}`;

        // Check if we're already discovering tools for this server
        if (this.discoveringTools.has(serverKey) && !forceDiscovery) {
            this.logger.info(`Tool discovery already in progress for ${appName}/${serverName}`);
            return false;
        }

        this.logger.info(`Starting SSE server tool discovery for ${appName}/${serverName}`);

        // Mark that we're discovering tools for this server BEFORE starting
        this.discoveringTools.add(serverKey);
        this.logger.info(`Added ${serverKey} to discovering tools set. Current discovering: ${Array.from(this.discoveringTools).join(', ')}`);

        try {
            // Get the application and server
            const app = this.applications.get(appName);
            if (!app) {
                this.logger.error(`Application ${appName} not found for tool discovery. Available apps: ${Array.from(this.applications.keys()).join(', ')}`);
                this.discoveringTools.delete(serverKey);
                return false;
            }

            // Find the server
            const server = app.servers.find(s => s.serverName === serverName);
            if (!server) {
                this.logger.error(`Server ${serverName} not found in application ${appName}. Available servers: ${app.servers.map(s => s.serverName).join(', ')}`);
                this.discoveringTools.delete(serverKey);
                return false;
            }

            if (!('url' in server.config)) {
                this.logger.error(`Server ${serverName} is not an SSE server`);
                this.discoveringTools.delete(serverKey);
                return false;
            }

            // Update server state to show it's discovering (only if not already set)
            if (!server.isDiscovering) {
                server.isDiscovering = true;
                this.updateApplication(app);
                this.logger.info(`Marked server ${appName}/${serverName} as discovering in UI`);
            }

            // Get the original URL from environment variables
            const targetUrl = server.config.env?.[MCPDefenderEnvVar.OriginalUrl];
            if (!targetUrl) {
                this.logger.error(`Original URL not found for server ${serverName}`);
                this.discoveringTools.delete(serverKey);

                // Update server state to clear discovering status
                server.isDiscovering = false;
                this.updateApplication(app);

                return false;
            }

            // Get the service manager
            const serviceManager = ServiceManager.getInstance();

            // Use the discoverServerTools method to properly trigger tool discovery
            this.logger.info(`Requesting tool discovery from defender for ${appName}/${serverName} at ${targetUrl}`);
            serviceManager.defenderService.discoverServerTools(appName, serverName, targetUrl);

            // Tool discovery happens asynchronously; results will be received via handleToolsUpdate
            return true;
        } catch (error) {
            this.logger.error(`Error discovering tools for ${appName}/${serverName}:`, error);
            this.discoveringTools.delete(serverKey);

            // Get the application and server to update the state
            const app = this.applications.get(appName);
            if (app) {
                const server = app.servers.find(s => s.serverName === serverName);
                if (server) {
                    // Update server state to clear discovering status
                    server.isDiscovering = false;
                    this.updateApplication(app);
                }
            }

            return false;
        }
    }

    /**
     * Add a configuration update to the pending queue
     * @param appName Application name
     * @param serverCount Number of servers protected
     * @param requiresRestart Whether the app requires restart for changes
     */
    private queueConfigurationUpdate(appName: string, serverCount: number, requiresRestart: boolean): void {
        // Add to pending updates
        this.pendingConfigUpdates.push({
            appName,
            serverCount,
            requiresRestart
        });

        // Set or reset debounce timer
        if (this.notificationDebounceTimer) {
            clearTimeout(this.notificationDebounceTimer);
        }

        this.notificationDebounceTimer = setTimeout(() => {
            this.processConfigurationUpdates();
        }, 500); // 500ms debounce
    }

    /**
     * Process all pending configuration updates and show a consolidated notification
     */
    private processConfigurationUpdates(): void {
        if (this.pendingConfigUpdates.length === 0) return;

        // Check if notifications are enabled in settings
        const serviceManager = ServiceManager.getInstance();
        const settings = serviceManager.settingsService.getSettings();

        // Skip notification if disabled in settings
        const { notificationSettings } = settings;
        if (notificationSettings === 0) { // NotificationSettings.NONE
            this.logger.info(`Notifications disabled, skipping ${this.pendingConfigUpdates.length} update notifications`);
            this.pendingConfigUpdates = [];
            this.notificationDebounceTimer = null;
            return;
        }

        // Create a copy of the updates
        const updates = [...this.pendingConfigUpdates];

        // Clear the pending updates
        this.pendingConfigUpdates = [];
        this.notificationDebounceTimer = null;

        // Show consolidated notification
        notification.consolidatedConfigUpdates(updates);

        this.logger.info(`Sent consolidated notification for ${updates.length} application updates`);
    }

    /**
     * Handle settings updates to handle secure tools server changes
     * @param settings The updated settings
     */
    private handleSecureToolsSettingChange(settings: any): void {
        if (settings && typeof settings.useMCPDefenderSecureTools !== 'undefined') {
            this.logger.info(`Secure tools setting changed to: ${settings.useMCPDefenderSecureTools}`);

            // Reprocess all applications to add/remove the secure tools server
            this.processAllConfigurations();
        }
    }

    /**
     * Reprocess all application configurations
     * This is used when settings change that affect configuration processing
     */
    private async processAllConfigurations(): Promise<void> {
        this.logger.info('Reprocessing all application configurations due to settings change');

        for (const [appName, app] of this.applications.entries()) {
            try {
                await this.processConfig(appName);
                this.logger.info(`Successfully reprocessed configuration for ${appName}`);
            } catch (error) {
                this.logger.error(`Failed to reprocess configuration for ${appName}:`, error);
            }
        }

        // Notify about the updates
        this.notifyDefenderAndWebContents();
    }
}