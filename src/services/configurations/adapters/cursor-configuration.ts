import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { StandardMCPConfiguration } from './standard-configuration';
import { createLogger } from '../../../utils/logger';
import { MCPConfig } from '../types';
import { protectCursor, unprotectCursor } from '../../../utils/cursor-rules';

// Create logger for cursor configuration
const logger = createLogger('CursorConfiguration');



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

        // If configuration was successful, also protect Cursor with rules
        if (result.success) {
            logger.info('Configuration successful, now protecting Cursor with MCP Defender rules');
            const cursorProtected = await protectCursor();

            if (cursorProtected) {
                logger.info('Successfully protected Cursor with MCP Defender rules');
            } else {
                logger.warn('Failed to protect Cursor with MCP Defender rules, but configuration was successful');
                // Don't fail the entire operation if rule protection fails
            }
        } else {
            logger.info('Configuration failed, skipping Cursor rule protection');
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

        // First, unprotect Cursor by removing MCP Defender rules
        logger.info('Removing MCP Defender rules from Cursor');
        const cursorUnprotected = await unprotectCursor();

        if (cursorUnprotected) {
            logger.info('Successfully removed MCP Defender rules from Cursor');
        } else {
            logger.warn('Failed to remove MCP Defender rules from Cursor, continuing with configuration restore');
        }

        // Then, restore the configuration normally
        const result = await super.restoreUnprotectedConfig();

        return result;
    }
} 