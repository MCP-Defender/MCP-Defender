import * as os from 'os';
import * as path from 'path';
import { BaseMCPConfiguration } from '../base-configuration';
import { MCPConfig } from '../types';
import { createLogger } from '../../../utils/logger';

// Create logger for standard configuration
const logger = createLogger('StandardConfiguration');

/**
 * Standard MCP configuration for most applications
 * 
 * This handles the default MCP configuration format used by most applications:
 * {
 *   "mcpServers": {
 *     "serverName": {
 *       "url": "http://localhost:3000/sse"
 *     }
 *   }
 * }
 */
export class StandardMCPConfiguration extends BaseMCPConfiguration {
    private configPath: string;

    /**
     * Create a new standard MCP configuration handler
     * @param appName Internal application name
     * @param displayName Human-readable display name
     * @param cliPath Path to the CLI script
     * @param customConfigPath Optional custom configuration path
     * @param iconPath Optional path to the app's icon
     * @param requiresRestart Whether the app requires restart for config changes
     */
    constructor(
        appName: string,
        displayName: string,
        cliPath: string,
        customConfigPath?: string,
        iconPath?: string,
        requiresRestart: boolean = false
    ) {
        super(appName, displayName, cliPath, iconPath, requiresRestart);
        this.configPath = customConfigPath || this.getDefaultConfigPath();
        logger.info(`Created standard configuration for app: ${appName}, config path: ${this.configPath}`);
    }

    /**
     * Get the default configuration path based on OS and app name
     */
    protected getDefaultConfigPath(): string {
        const homeDir = os.homedir();
        const appNameNormalized = this.appName.toLowerCase().replace(/\s+/g, '-');

        // For custom apps, store in a dedicated directory
        const safeAppName = this.appName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const configPath = path.join(homeDir, '.mcp-defender', 'configs', `${safeAppName}.json`);

        logger.debug(`Determined default config path for ${this.appName}: ${configPath}`);
        return configPath;
    }

    /**
     * Get the configuration file path
     */
    getConfigPath(): string {
        return this.configPath;
    }

    /**
     * Set a custom configuration path
     */
    setConfigPath(configPath: string): void {
        logger.info(`Setting custom config path for ${this.appName}: ${configPath}`);
        this.configPath = configPath;
    }

    /**
     * Extract MCP configuration from the standard format
     * In the standard format, the entire file is the MCP config
     */
    extractMCPConfig(appConfig: any): MCPConfig {
        // For standard MCP config, the entire file is the MCP config
        return appConfig || { mcpServers: {} };
    }

    /**
     * Merge MCP configuration back into the standard format
     * In the standard format, the entire file is the MCP config
     */
    mergeMCPConfig(appConfig: any, mcpConfig: MCPConfig): any {
        // For standard MCP config, we replace the entire file
        return mcpConfig;
    }
}