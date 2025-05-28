import * as os from 'os';
import * as path from 'path';
import { StandardMCPConfiguration } from './standard-configuration';
import { createLogger } from '../../../utils/logger';

// Create logger for Claude configuration
const logger = createLogger('ClaudeConfiguration');

/**
 * MCP configuration for Claude Desktop application
 */
export class ClaudeConfiguration extends StandardMCPConfiguration {
    /**
     * Create a new Claude Desktop configuration handler
     * @param cliPath Path to the CLI script
     * @param customConfigPath Optional custom configuration path
     * @param iconPath Optional path to the app's icon
     */
    constructor(
        cliPath: string,
        customConfigPath?: string,
        iconPath?: string
    ) {
        super(
            'claude-desktop',
            'Claude Desktop',
            cliPath,
            customConfigPath,
            iconPath,
            true // Claude Desktop requires restart for config changes
        );
    }

    /**
     * Get the default configuration path for Claude Desktop based on the platform
     */
    protected override getDefaultConfigPath(): string {
        const homeDir = os.homedir();
        let configPath: string;

        if (process.platform === 'darwin') {
            // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
            configPath = path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        } else if (process.platform === 'win32') {
            // Windows: %APPDATA%\Claude\claude_desktop_config.json
            configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
        } else {
            // For Linux or other platforms, default to home directory
            configPath = path.join(homeDir, '.claude', 'claude_desktop_config.json');
        }

        logger.debug(`Determined default config path for Claude Desktop: ${configPath}`);
        return configPath;
    }
} 