import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, shell, BrowserWindow } from 'electron';
import { BaseService, ServiceEvent } from '../base-service';
import { Signature, isLLMSignature, isDeterministicSignature } from './types';
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
            this.publishEvent(ServiceEvent.SIGNATURES_UPDATED, {
                signatures: this.signatures,
                signaturesDirectory: USERS_SIGNATURES
            });
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
     * Load signatures from the unified signatures.json file
     */
    private async processUsersSignaturesChanges(): Promise<Signature[]> {
        // Clear current signatures
        this.signatures = [];

        try {
            const signaturesFilePath = path.join(USERS_SIGNATURES, 'signatures.json');

            // Check if the unified signatures file exists
            try {
                await fs.promises.access(signaturesFilePath);
            } catch (error) {
                this.logger.warn('No signatures.json file found in user directory');
                return this.signatures;
            }

            // Read and parse the unified signatures file
            const data = await fs.promises.readFile(signaturesFilePath, 'utf8');
            const allSignatures = JSON.parse(data) as Signature[];

            this.logger.info(`Found ${allSignatures.length} signatures in signatures.json`);

            // Validate each signature based on its type
            const validSignatures = allSignatures.filter(sig => {
                // Check base properties
                if (!sig.id || !sig.name || !sig.description || !sig.category || !sig.type) {
                    return false;
                }

                // Type-specific validation
                if (sig.type === 'llm') {
                    return !!(sig as any).prompt;
                } else if (sig.type === 'deterministic') {
                    return !!(sig as any).functionFile;
                }

                // Unknown type
                return false;
            });

            if (validSignatures.length !== allSignatures.length) {
                this.logger.warn(`signatures.json contained ${allSignatures.length - validSignatures.length} invalid signatures`);
            }

            // Set our validated signatures
            this.signatures = validSignatures;
            this.logger.info(`Loaded ${validSignatures.length} valid signatures (${validSignatures.filter(s => s.type === 'llm').length} LLM, ${validSignatures.filter(s => s.type === 'deterministic').length} deterministic)`);

            // Update the defender service with the new signatures
            this.notifyDefenderAndWebContents();

            return this.signatures;
        } catch (error) {
            this.logger.error('Error processing signatures file:', error);
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

                // Check if unified signatures.json exists in bundled directory
                const bundledSignaturesFile = path.join(BUNDLED_SIGNATURES, 'signatures.json');
                try {
                    await fs.promises.access(bundledSignaturesFile);

                    // Copy the unified signatures file
                    const data = await fs.promises.readFile(bundledSignaturesFile, 'utf8');
                    const userSignaturesFile = path.join(USERS_SIGNATURES, 'signatures.json');
                    await fs.promises.writeFile(userSignaturesFile, data, 'utf8');
                    this.logger.info('Copied unified signatures.json to user directory');
                } catch (error) {
                    this.logger.error('Error copying unified signatures.json:', error);
                }

                // Also sync deterministic functions directory if it exists
                await this.syncDeterministicFunctions();
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
 * Sync deterministic function files from bundled to user directory
 */
    private async syncDeterministicFunctions(): Promise<void> {
        try {
            // Define paths (simplified - functions are directly in deterministic/ directory)
            const bundledDeterministicDir = path.join(BUNDLED_SIGNATURES, 'deterministic');
            const userDeterministicDir = path.join(USERS_SIGNATURES, 'deterministic');

            // Check if bundled deterministic directory exists
            try {
                await fs.promises.access(bundledDeterministicDir);
            } catch (error) {
                this.logger.info('No bundled deterministic functions found, skipping sync');
                return;
            }

            // Create user deterministic directory if it doesn't exist
            try {
                await fs.promises.mkdir(userDeterministicDir, { recursive: true });
                this.logger.info(`Created deterministic directory at ${userDeterministicDir}`);
            } catch (error) {
                // Directory might already exist, that's fine
            }

            // Copy function files directly from deterministic directory
            try {
                // Copy all function files from bundled deterministic directory
                const functionFiles = await fs.promises.readdir(bundledDeterministicDir);
                for (const file of functionFiles) {
                    if (file.endsWith('.js')) {
                        const srcFile = path.join(bundledDeterministicDir, file);
                        const destFile = path.join(userDeterministicDir, file);

                        const data = await fs.promises.readFile(srcFile, 'utf8');
                        await fs.promises.writeFile(destFile, data, 'utf8');
                        this.logger.info(`Copied deterministic function ${file} to user directory`);
                    }
                }
            } catch (error) {
                this.logger.error('Error copying deterministic functions:', error);
            }

        } catch (error) {
            this.logger.error('Error syncing deterministic functions:', error);
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
            if (filename === 'signatures.json') {
                this.logger.info(`Signatures file change detected: ${eventType} - ${filename}`);
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