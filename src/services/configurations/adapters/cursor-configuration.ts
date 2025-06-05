import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs/promises';
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

        return result;
    }
} 