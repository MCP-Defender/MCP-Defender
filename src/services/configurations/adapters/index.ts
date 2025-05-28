/**
 * MCP Configuration Adapters
 * 
 * These adapters handle the specific format of MCP configuration 
 * files for different applications.
 */

export * from './standard-configuration';
export * from './vscode-configuration';
export * from './cursor-configuration';
export * from './claude-configuration';
export * from './windsurf-configuration';

// Factory function to create the appropriate configuration based on app name
export * from './configuration-factory'; 