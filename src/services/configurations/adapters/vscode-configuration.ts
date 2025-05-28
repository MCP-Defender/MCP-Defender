import * as os from 'os';
import * as path from 'path';
import { BaseMCPConfiguration } from '../base-configuration';
import { MCPConfig, ServerConfig } from '../types';
import { createLogger } from '../../../utils/logger';

// Create logger for VSCode configuration
const logger = createLogger('VSCodeConfiguration');

/**
 * VS Code specific server configuration that includes a 'type' field
 */
interface VSCodeServerConfig extends Record<string, any> {
    type?: 'stdio' | 'sse' | 'http';
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
}

/**
 * VSCode MCP configuration adapter
 * 
 * Handles VS Code settings.json format:
 * {
 *   "other": "settings",
 *   "mcp": {
 *     "servers": {
 *       "serverName": {
 *         "type": "stdio",
 *         "command": "node",
 *         "args": ["server.js"]
 *       }
 *     }
 *   }
 * }
 */
export class VSCodeMCPConfiguration extends BaseMCPConfiguration {
    private configPath: string;

    /**
     * Create a new VSCode configuration handler
     * @param cliPath Path to the CLI script
     * @param customConfigPath Optional custom configuration path
     * @param iconPath Optional path to the app's icon
     */
    constructor(
        cliPath: string,
        customConfigPath?: string,
        iconPath?: string
    ) {
        super('vscode', 'Visual Studio Code', cliPath, iconPath);
        this.configPath = customConfigPath || this.getDefaultConfigPath();
        logger.info(`Created VSCode configuration, config path: ${this.configPath}`);
    }

    /**
     * Get the default VSCode settings.json path
     */
    protected getDefaultConfigPath(): string {
        const homeDir = os.homedir();
        let configPath: string;

        // Different paths based on OS
        if (process.platform === 'darwin') {
            // macOS
            configPath = path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
        } else if (process.platform === 'win32') {
            // Windows
            configPath = path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
        } else {
            // Linux
            configPath = path.join(homeDir, '.config', 'Code', 'User', 'settings.json');
        }

        logger.debug(`Determined VSCode settings path: ${configPath}`);
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
        logger.info(`Setting custom VSCode config path: ${configPath}`);
        this.configPath = configPath;
    }

    /**
     * Extract MCP configuration from VS Code settings
     * Looks for the mcp.servers format per VS Code documentation
     */
    extractMCPConfig(appConfig: any): MCPConfig {
        if (!appConfig) {
            logger.debug('Empty VSCode settings, returning empty MCP config');
            return { mcpServers: {} };
        }

        // Extract servers from the mcp.servers format
        let mcpServers: Record<string, ServerConfig> = {};

        if (appConfig.mcp?.servers && typeof appConfig.mcp.servers === 'object') {
            logger.debug(`Found servers in mcp.servers format`);
            mcpServers = this.normalizeVSCodeServers(appConfig.mcp.servers);
        }

        logger.debug(`Extracted ${Object.keys(mcpServers).length} servers from VSCode settings`);

        return {
            mcpServers
        };
    }

    /**
     * Normalize servers from the VS Code format to match our internal format
     * This handles the 'type' field for proper conversion
     */
    private normalizeVSCodeServers(servers: Record<string, VSCodeServerConfig>): Record<string, ServerConfig> {
        const normalizedServers: Record<string, ServerConfig> = {};

        for (const [serverName, serverConfig] of Object.entries(servers)) {
            // Create a copy of the server config
            const normalizedConfig = { ...serverConfig };

            // Handle the type field
            if (normalizedConfig.type) {
                // In VSCode format, type can be "stdio", "sse", or "http"
                // We need to convert this to our internal format
                if (normalizedConfig.type === "stdio") {
                    // Stdio servers have command and args
                    // This format is already compatible with our internal format
                } else if (normalizedConfig.type === "sse" || normalizedConfig.type === "http") {
                    // For SSE and HTTP servers, VS Code specifies the type but our format 
                    // determines the type by the presence of a URL
                    delete normalizedConfig.type;
                }
            }

            normalizedServers[serverName] = normalizedConfig as ServerConfig;
        }

        return normalizedServers;
    }

    /**
     * Convert servers to the VS Code format
     * This adds the 'type' field as needed
     */
    private convertToVSCodeFormat(servers: Record<string, ServerConfig>): Record<string, VSCodeServerConfig> {
        const vsCodeServers: Record<string, VSCodeServerConfig> = {};

        for (const [serverName, serverConfig] of Object.entries(servers)) {
            // Create a copy of the server config
            const vsCodeConfig: VSCodeServerConfig = { ...serverConfig };

            // Add the type field based on the server config
            if ('url' in vsCodeConfig) {
                // For URL-based servers, add the "sse" type
                vsCodeConfig.type = "sse";
            } else if ('command' in vsCodeConfig) {
                // For command-based servers, add the "stdio" type
                vsCodeConfig.type = "stdio";
            }

            vsCodeServers[serverName] = vsCodeConfig;
        }

        return vsCodeServers;
    }

    /**
     * Merge MCP configuration back into VS Code settings
     * Updates the mcp.servers setting
     */
    mergeMCPConfig(appConfig: any, mcpConfig: MCPConfig): any {
        // Create a copy of the original config
        const updatedConfig = appConfig ? { ...appConfig } : {};
        const serverCount = Object.keys(mcpConfig.mcpServers).length;

        // Ensure the mcp object exists
        if (!updatedConfig.mcp) {
            updatedConfig.mcp = {};
        }

        // Update the servers with the VS Code format
        updatedConfig.mcp.servers = this.convertToVSCodeFormat(mcpConfig.mcpServers);

        logger.debug(`Merged ${serverCount} servers into VSCode configuration`);

        return updatedConfig;
    }
}