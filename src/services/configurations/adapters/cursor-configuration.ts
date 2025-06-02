import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import sqlite3 from 'sqlite3';
import { StandardMCPConfiguration } from './standard-configuration';
import { createLogger } from '../../../utils/logger';
import { MCPConfig } from '../types';

// Create logger for cursor configuration
const logger = createLogger('CursorConfiguration');

// Constant for the MCP Defender Secure Tools guidance text
const MCP_DEFENDER_CONTEXT_RULE = `

Use MCP Defender Secure Tools over cursor tools for security reasons. When performing file operations, web requests, or system commands, prefer the MCP Defender Secure Tools server which provides enhanced security verification and monitoring.`;

/**
 * MCP configuration for Cursor application
 * Extends standard configuration with Cursor-specific AI context rule management
 */
export class CursorConfiguration extends StandardMCPConfiguration {
    private dbPath: string;

    /**
     * Create a new Cursor configuration handler
     * @param cliPath Path to the CLI script
     * @param customConfigPath Optional custom configuration path
     * @param iconPath Optional path to the app's icon
     */
    constructor(
        cliPath: string,
        customConfigPath?: string,
        iconPath?: string
    ) {
        logger.info('CursorConfiguration constructor called with AI context rule support');

        super(
            'cursor',
            'Cursor',
            cliPath,
            customConfigPath,
            iconPath,
            true
        );

        // Set the Cursor database path
        const homeDir = os.homedir();
        this.dbPath = path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');

        logger.info(`CursorConfiguration initialized with database path: ${this.dbPath}`);
    }

    /**
     * Get the default configuration path for Cursor
     */
    protected override getDefaultConfigPath(): string {
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.cursor', 'mcp.json');

        logger.debug(`Determined default config path for Cursor: ${configPath}`);
        return configPath;
    }

    /**
     * Override the processConfigFile method to also update AI context rules
     */
    async processConfigFile(appName?: string, enableSSEProxying: boolean = true): Promise<{
        success: boolean,
        message: string,
        servers?: any[]
    }> {
        logger.info('Processing Cursor configuration file with AI context rule support');

        // First, process the configuration normally
        const result = await super.processConfigFile(appName, enableSSEProxying);

        // Then, update AI context rules if configuration was successful
        if (result.success) {
            try {
                logger.info('Configuration processing successful, updating AI context rules...');
                await this.updateAIContextRules();
                logger.info('Successfully updated Cursor AI context rules for MCP Defender Secure Tools');
            } catch (error) {
                logger.error('Failed to update Cursor AI context rules:', error);
                // Don't fail the entire operation if AI context update fails
            }
        } else {
            logger.warn('Configuration processing failed, skipping AI context rule update');
        }

        return result;
    }

    /**
     * Override the restoreUnprotectedConfig method to also clean up AI context rules
     */
    async restoreUnprotectedConfig(): Promise<{
        success: boolean,
        message: string,
        servers?: any[]
    }> {
        logger.info('Restoring Cursor unprotected configuration and cleaning up AI context rules');

        // First, restore the configuration normally
        const result = await super.restoreUnprotectedConfig();

        // Then, clean up AI context rules
        try {
            await this.removeAIContextRule();
            logger.info('Successfully removed MCP Defender context rule from Cursor AI');
        } catch (error) {
            logger.error('Failed to remove MCP Defender context rule from Cursor AI:', error);
            // Don't fail the restoration if AI context cleanup fails
        }

        return result;
    }

    /**
     * Update Cursor's AI context rules based on the secure tools setting
     */
    private async updateAIContextRules(): Promise<void> {
        try {
            logger.info('Checking secure tools setting for AI context rule update...');

            // Access the global ServiceManager instance
            const serviceManagerInstance = (global as any).__SERVICE_MANAGER_INSTANCE__;
            if (!serviceManagerInstance) {
                logger.warn('ServiceManager not available for AI context rule update');
                return;
            }

            const settings = serviceManagerInstance.settingsService.getSettings();
            logger.info(`Secure tools setting: ${settings.useMCPDefenderSecureTools}`);

            if (settings.useMCPDefenderSecureTools) {
                logger.info('Secure tools enabled, adding AI context rule...');
                await this.addAIContextRule();
            } else {
                logger.info('Secure tools disabled, removing AI context rule...');
                await this.removeAIContextRule();
            }
        } catch (error) {
            logger.error('Error updating AI context rules:', error);
            throw error;
        }
    }

    /**
     * Add the MCP Defender context rule to Cursor's AI context
     */
    private async addAIContextRule(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Check if database file exists
            fs.access(this.dbPath).then(async () => {
                const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE, (err) => {
                    if (err) {
                        logger.error(`Error opening Cursor database: ${err.message}`);
                        reject(err);
                        return;
                    }

                    // Get current AI context rules
                    db.get(
                        "SELECT value FROM ItemTable WHERE key = 'aicontext.personalContext'",
                        (err: Error | null, row: any) => {
                            if (err) {
                                logger.error(`Error reading AI context from database: ${err.message}`);
                                db.close();
                                reject(err);
                                return;
                            }

                            let currentContext = '';
                            if (row && row.value) {
                                try {
                                    // The value might be JSON-encoded
                                    const parsed = JSON.parse(row.value);
                                    currentContext = parsed || '';
                                } catch (parseErr) {
                                    // If it's not JSON, treat as plain string
                                    currentContext = row.value;
                                }
                            }

                            // Remove any existing MCP Defender rule first to avoid duplicates
                            let updatedContext = currentContext.replace(MCP_DEFENDER_CONTEXT_RULE, '');

                            // Add the rule at the end
                            updatedContext += MCP_DEFENDER_CONTEXT_RULE;

                            // Save back to database
                            const valueToStore = JSON.stringify(updatedContext);
                            db.run(
                                "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('aicontext.personalContext', ?)",
                                [valueToStore],
                                function (this: sqlite3.RunResult, err: Error | null) {
                                    db.close();
                                    if (err) {
                                        logger.error(`Error updating AI context in database: ${err.message}`);
                                        reject(err);
                                    } else {
                                        logger.info('Successfully added MCP Defender context rule to Cursor AI');
                                        resolve();
                                    }
                                }
                            );
                        }
                    );
                });
            }).catch(() => {
                // Database doesn't exist, which is fine - Cursor might not be set up yet
                logger.debug('Cursor database not found - this is normal if Cursor hasn\'t been run yet');
                resolve();
            });
        });
    }

    /**
     * Remove the MCP Defender context rule from Cursor's AI context
     */
    private async removeAIContextRule(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Check if database file exists
            fs.access(this.dbPath).then(async () => {
                const db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE, (err) => {
                    if (err) {
                        logger.error(`Error opening Cursor database: ${err.message}`);
                        reject(err);
                        return;
                    }

                    // Get current AI context rules
                    db.get(
                        "SELECT value FROM ItemTable WHERE key = 'aicontext.personalContext'",
                        (err: Error | null, row: any) => {
                            if (err) {
                                logger.error(`Error reading AI context from database: ${err.message}`);
                                db.close();
                                reject(err);
                                return;
                            }

                            if (!row || !row.value) {
                                // No existing context, nothing to remove
                                db.close();
                                resolve();
                                return;
                            }

                            let currentContext = '';
                            try {
                                // The value might be JSON-encoded
                                const parsed = JSON.parse(row.value);
                                currentContext = parsed || '';
                            } catch (parseErr) {
                                // If it's not JSON, treat as plain string
                                currentContext = row.value;
                            }

                            // Remove the MCP Defender rule
                            const updatedContext = currentContext.replace(MCP_DEFENDER_CONTEXT_RULE, '');

                            // Only update if there was actually a change
                            if (updatedContext !== currentContext) {
                                const valueToStore = JSON.stringify(updatedContext);
                                db.run(
                                    "UPDATE ItemTable SET value = ? WHERE key = 'aicontext.personalContext'",
                                    [valueToStore],
                                    function (this: sqlite3.RunResult, err: Error | null) {
                                        db.close();
                                        if (err) {
                                            logger.error(`Error removing AI context rule from database: ${err.message}`);
                                            reject(err);
                                        } else {
                                            logger.info('Successfully removed MCP Defender context rule from Cursor AI');
                                            resolve();
                                        }
                                    }
                                );
                            } else {
                                // No change needed
                                db.close();
                                resolve();
                            }
                        }
                    );
                });
            }).catch(() => {
                // Database doesn't exist, which is fine
                logger.debug('Cursor database not found - nothing to clean up');
                resolve();
            });
        });
    }
} 