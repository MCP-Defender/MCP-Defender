import * as os from 'os';
import * as path from 'path';
import { StandardMCPConfiguration } from './standard-configuration';
import { createLogger } from '../../../utils/logger';

// Create logger for Windsurf configuration
const logger = createLogger('WindsurfConfiguration');

/**
 * MCP configuration for Windsurf application
 */
export class WindsurfConfiguration extends StandardMCPConfiguration {
    /**
     * Create a new Windsurf configuration handler
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
            'windsurf',
            'Windsurf',
            cliPath,
            customConfigPath,
            iconPath
        );
    }

    /**
     * Get the default configuration path for Windsurf
     */
    protected override getDefaultConfigPath(): string {
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');

        logger.debug(`Determined default config path for Windsurf: ${configPath}`);
        return configPath;
    }
} 