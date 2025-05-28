import { BaseMCPConfiguration } from '../base-configuration';
import { StandardMCPConfiguration } from './standard-configuration';
import { VSCodeMCPConfiguration } from './vscode-configuration';
import { CursorConfiguration } from './cursor-configuration';
import { ClaudeConfiguration } from './claude-configuration';
import { WindsurfConfiguration } from './windsurf-configuration';
import { createLogger } from '../../../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

// Create logger for configuration factory
const logger = createLogger('ConfigurationFactory');

/**
 * Creates the appropriate configuration adapter based on the application name
 */
export function createConfiguration(
    appName: string,
    cliPath: string,
    customConfigPath?: string,
    iconPath?: string
): BaseMCPConfiguration {
    const normalizedAppName = appName.toLowerCase().trim();

    logger.info(`Creating configuration for app: ${appName}`);

    // Select the appropriate configuration class based on app name
    switch (normalizedAppName) {
        case 'vscode':
        case 'visual studio code':
            return new VSCodeMCPConfiguration(cliPath, customConfigPath, iconPath);

        case 'cursor':
            return new CursorConfiguration(cliPath, customConfigPath, iconPath);

        case 'claude':
        case 'claude desktop':
            return new ClaudeConfiguration(cliPath, customConfigPath, iconPath);

        case 'windsurf':
            return new WindsurfConfiguration(cliPath, customConfigPath, iconPath);

        default:
            // For unknown applications, use the generic StandardMCPConfiguration
            logger.info(`No specific configuration found for ${appName}, using standard configuration`);
            // By default, unknown applications don't require restart
            const requiresRestart = false;
            return new StandardMCPConfiguration(
                normalizedAppName,
                appName, // Use original name for display
                cliPath,
                customConfigPath,
                iconPath,
                requiresRestart
            );
    }
}

/**
 * Detects an application based on the config file path
 * This is useful when we already have a config file but need to determine what app it belongs to
 */
export function detectApplicationFromConfigPath(configPath: string): string | undefined {
    logger.info(`Detecting application from config path: ${configPath}`);

    const fileName = path.basename(configPath).toLowerCase();
    const dirPath = path.dirname(configPath).toLowerCase();

    if (dirPath.includes('.cursor') && fileName === 'mcp.json') {
        return 'cursor';
    }

    if (dirPath.includes('claude') && fileName.includes('claude_desktop_config')) {
        return 'claude desktop';
    }

    if (dirPath.includes('.codeium/windsurf') && fileName === 'mcp_config.json') {
        return 'windsurf';
    }

    if (dirPath.includes('.vscode') || fileName === 'settings.json') {
        return 'vscode';
    }

    // If we can't determine app type from path, check the content if file exists
    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            // Look for app-specific markers in the config
            if (config && typeof config === 'object') {
                if ('mcp.serverList' in config) {
                    return 'vscode';
                }
            }
        } catch (error) {
            logger.error(`Error reading config file for detection: ${error.message}`);
        }
    }

    logger.info(`Could not detect application from config path: ${configPath}`);
    return undefined;
} 