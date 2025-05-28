import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, shell, BrowserWindow } from 'electron';
import { BaseService, ServiceEvent } from '../base-service';
import { Signature } from './types';
import { DefenderServiceEvent } from '../defender/types';
import { ServiceManager } from '../service-manager';

/**
 * Constants for signature file locations
 */
const SIGNATURES_DIRECTORY = "signatures";
const USERS_SIGNATURES = path.join(app.getPath('userData'), SIGNATURES_DIRECTORY);
// Built-in signatures directory for development mode
const BUNDLED_SIGNATURES = app.isPackaged
    ? path.join(process.resourcesPath, SIGNATURES_DIRECTORY)
    : path.join(app.getAppPath(), SIGNATURES_DIRECTORY);

/**
 * Signatures Service
 * Manages signature file loading, syncing and watching
 */
export class SignaturesService extends BaseService {
    // In-memory cache of signatures
    private signatures: Signature[] = [];

    // Track file watchers
    private directoryWatcher: fs.FSWatcher | null = null;

    // Debounce timer for file change events
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_DELAY = 2000; // 2 seconds

    /**
     * Create a new signatures service
     */
    constructor() {
        super('Signatures');

        // Listen for defender ready event
        const serviceManager = ServiceManager.getInstance();
        serviceManager.defenderService.on(DefenderServiceEvent.READY, () => {
            this.logger.info('Defender service is ready, sending signatures');
            this.notifyDefenderAndWebContents();
        });
    }

    /**
     * Start the signatures service
     * Initializes signatures directory and starts watching for changes
     */
    start(): boolean {
        if (!super.start()) return false;

        this.logger.info('Starting signatures service');

        // Begin async initialization
        this.initialize().catch(error => {
            this.logger.error('Failed to initialize signatures service', error);
        });

        // Return true immediately as initialization continues asynchronously
        return true;
    }

    /**
     * Initialize the service asynchronously
     * This is separated from start() to maintain compatibility with BaseService
     */
    private async initialize(): Promise<void> {
        try {
            // Load built-in signatures and ensure directory exists
            await this.loadBundledSignatures();

            // Start watching the users signatures directory
            await this.startWatchingSignaturesDirectory();
        } catch (error) {
            this.logger.error('Error during async initialization', error);
            throw error;
        }
    }

    /**
     * Stop the signatures service
     * Cleans up watchers and resources
     */
    stop(): boolean {
        if (!super.stop()) return false;

        this.logger.info('Stopping signatures service');

        // Stop watching signatures directory
        this.stopWatchingSignaturesDirectory();

        return true;
    }

    /**
     * Get all loaded signatures
     */
    getSignatures(): Signature[] {
        return [...this.signatures];
    }

    /**
     * Open the signatures directory in the file explorer
     */
    async openSignaturesDirectory(): Promise<boolean> {
        try {
            this.logger.info(`Opening signatures directory: ${USERS_SIGNATURES}`);
            await shell.openPath(USERS_SIGNATURES);
            return true;
        } catch (error) {
            this.logger.error('Failed to open signatures directory', error);
            return false;
        }
    }

    /**
     * Notify the defender service about signature updates
     */
    public notifyDefenderAndWebContents(): void {
        if (this.signatures.length > 0) {
            this.logger.info(`Publishing ${this.signatures.length} signatures to event bus`);
            this.publishEvent(ServiceEvent.SIGNATURES_UPDATED, this.signatures);
        } else {
            this.logger.warn('No signatures to publish');
        }

        // Find active windows and send updates to them
        const windows = BrowserWindow.getAllWindows();
        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send('signatures:update', this.signatures);
            }
        }
    }

    /**
     * Load signatures from all JSON files in the user's signatures directory
     */
    private async processUsersSignaturesChanges(): Promise<Signature[]> {
        // Clear current signatures
        this.signatures = [];

        try {
            // Read all files in the directory
            const files = await fs.promises.readdir(USERS_SIGNATURES);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            this.logger.info(`Found ${jsonFiles.length} signature files in ${USERS_SIGNATURES}`);

            // Process each JSON file
            for (const file of jsonFiles) {
                try {
                    const filePath = path.join(USERS_SIGNATURES, file);
                    const data = await fs.promises.readFile(filePath, 'utf8');
                    const fileSignatures = JSON.parse(data) as Signature[];

                    // Validate each signature
                    const validSignatures = fileSignatures.filter(sig => {
                        return sig.id && sig.name && sig.description && sig.prompt && sig.category;
                    });

                    if (validSignatures.length !== fileSignatures.length) {
                        this.logger.warn(`File ${file} contained ${fileSignatures.length - validSignatures.length} invalid signatures`);
                    }

                    // Add valid signatures to our collection
                    this.signatures = [...this.signatures, ...validSignatures];
                    this.logger.info(`Loaded ${validSignatures.length} signatures from ${file}`);
                } catch (error) {
                    this.logger.error(`Error processing signature file ${file}:`, error);
                    // Continue with other files even if one fails
                }
            }

            // Update the defender service with the new signatures
            this.notifyDefenderAndWebContents();

            return this.signatures;
        } catch (error) {
            this.logger.error('Error processing signatures directory:', error);
            throw error;
        }
    }

    /**
     * Ensures the signatures directory exists and syncs bundled signatures
     */
    private async loadBundledSignatures(): Promise<void> {
        try {
            // Check if the directory exists
            try {
                await fs.promises.access(USERS_SIGNATURES);
                this.logger.info(`Signatures directory exists at ${USERS_SIGNATURES}`);
            } catch (error) {
                // Directory doesn't exist, create it
                this.logger.info(`Creating signatures directory at ${USERS_SIGNATURES}`);
                await fs.promises.mkdir(USERS_SIGNATURES, { recursive: true });
            }

            // Sync built-in signatures regardless if the directory existed or not
            try {
                // Check if built-in signatures directory exists
                try {
                    await fs.promises.access(BUNDLED_SIGNATURES);
                } catch (error) {
                    this.logger.error(`No built-in signatures directory found at ${BUNDLED_SIGNATURES}`);
                    throw new Error(`Built-in signatures directory not found at ${BUNDLED_SIGNATURES}. This is required for application functionality.`);
                }

                this.logger.info(`Syncing signatures from ${BUNDLED_SIGNATURES}`);

                // Read all built-in signature files
                const files = await fs.promises.readdir(BUNDLED_SIGNATURES);
                const jsonFiles = files.filter(file => file.endsWith('.json'));

                if (jsonFiles.length === 0) {
                    this.logger.warn('No built-in signature files found - this may cause functionality issues');
                    return;
                }

                // Copy each built-in signature file to user directory
                for (const file of jsonFiles) {
                    try {
                        const srcFilePath = path.join(BUNDLED_SIGNATURES, file);
                        const destFilePath = path.join(USERS_SIGNATURES, file);

                        // Read built-in signature file
                        const data = await fs.promises.readFile(srcFilePath, 'utf8');

                        // Write to user directory, overwriting if exists
                        await fs.promises.writeFile(destFilePath, data, 'utf8');
                        this.logger.info(`Copied built-in signature file ${file} to user directory`);
                    } catch (error) {
                        this.logger.error(`Error copying built-in signature file ${file}:`, error);
                        // Continue with other files even if one fails
                    }
                }
            } catch (error) {
                this.logger.error('Error syncing built-in signatures:', error);
                throw error;
            }
        } catch (error) {
            this.logger.error('Error ensuring signatures directory:', error);
            throw error;
        }
    }

    /**
     * Handle directory/file changes with debouncing to prevent multiple rapid updates
     */
    private handleSignatureChanges(): void {
        // Clear any existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Set a new timer
        this.debounceTimer = setTimeout(async () => {
            this.logger.info('Signature files changed, reloading...');
            await this.processUsersSignaturesChanges();
            this.debounceTimer = null;
        }, this.DEBOUNCE_DELAY);
    }

    /**
     * Start watching the signatures directory for changes
     */
    private async startWatchingSignaturesDirectory(): Promise<void> {
        // Stop any existing watcher
        this.stopWatchingSignaturesDirectory();

        // Ensure directory exists and load initial signatures
        await this.processUsersSignaturesChanges();

        // Start watching the directory
        this.directoryWatcher = fs.watch(USERS_SIGNATURES, (eventType, filename) => {
            if (filename && filename.endsWith('.json')) {
                this.logger.info(`Signature file change detected: ${eventType} - ${filename}`);
                this.handleSignatureChanges();
            }
        });

        // Handle watcher errors
        this.directoryWatcher.on('error', (error) => {
            this.logger.error('Error watching signatures directory:', error);
        });

        this.logger.info(`Started watching signatures directory at ${USERS_SIGNATURES}`);
    }

    /**
     * Stop watching the signatures directory
     */
    private stopWatchingSignaturesDirectory(): void {
        // Close any existing watcher
        if (this.directoryWatcher) {
            this.directoryWatcher.close();
            this.directoryWatcher = null;
            this.logger.info('Stopped watching signatures directory');
        }

        // Clear any pending debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}