import * as os from 'os';
import * as path from 'path';
import { StandardMCPConfiguration } from './standard-configuration';
import { createLogger } from '../../../utils/logger';

// Create logger for cursor configuration
const logger = createLogger('CursorConfiguration');

/**
 * MCP configuration for Cursor application
 */
export class CursorConfiguration extends StandardMCPConfiguration {
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
        super(
            'cursor',
            'Cursor',
            cliPath,
            customConfigPath,
            iconPath,
            true
        );
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
} 