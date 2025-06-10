/**
 * MCP STDIO server configuration
 */
export interface StdioServerConfig {
    command: string;
    args: string[];
    env: {
        [key: string]: string;
    }
}

/**
 * MCP SSE server configuration
 */
export interface SSEServerConfig {
    url: string;
    env: {
        [key: string]: string;
    }
}

/**
 * Combined server config type
 */
export type ServerConfig = StdioServerConfig | SSEServerConfig;

/**
 * Standard MCP configuration format
 */
export interface MCPConfig {
    mcpServers: {
        [key: string]: ServerConfig;
    }
}

/**
 * Environment variables used for tracking proxy state
 */
export enum MCPDefenderEnvVar {
    OriginalUrl = 'MCP_DEFENDER_ORIGINAL_URL',
    OriginalCommand = 'MCP_DEFENDER_ORIGINAL_COMMAND',
    OriginalArgs = 'MCP_DEFENDER_ORIGINAL_ARGS',
    AppName = 'MCP_DEFENDER_APP_NAME',
    ServerName = 'MCP_DEFENDER_SERVER_NAME',
    DiscoveryMode = 'MCP_DEFENDER_DISCOVERY_MODE'
}

/**
 * Constants for MCP Defender branding and display
 */
export const MCP_DEFENDER_CONSTANTS = {
    /** Text appended to server names to indicate they are protected */
    PROTECTION_INDICATOR: ' - 🔒 MCP Defender',

    /** Prefix added to tool descriptions to indicate security enhancement */
    SECURITY_ENHANCED_PREFIX: '🔒'
} as const;

/**
 * Status change callback function type
 */
export type StatusChangeCallback = (appName: string, app: MCPApplication) => void;

/**
 * Represents a tool available on an MCP server
 */
export interface ServerTool {
    name: string;
    description?: string | null;
    /** Tool parameters schema (may be called inputSchema in some contexts) */
    parameters?: any;
    /** Alternative name for parameters in some MCP implementations */
    inputSchema?: any;
    [key: string]: any;
}

/**
 * Represents a server configuration that's tracked by the defender
 */
export interface ProtectedServerConfig {
    /** Name of the server in MCP configuration */
    serverName: string;

    /** The type of server (stdio, sse) */
    type?: string;

    /** Original server configuration */
    config: {
        url?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>
    };

    /** Whether this server is protected by MCP Defender */
    isProtected: boolean;

    /** List of tools available for this server */
    tools?: ServerTool[];

    /** Whether tool discovery is in progress for this server */
    isDiscovering?: boolean;
}

/**
 * Status of a managed application's protection
 */
export enum ProtectionStatus {
    Loading = "Loading",
    Protected = "Protected",
    NotFound = "NotFound",
    Error = "Error"
}

/**
 * Defines a known application that has MCP configuration
 */
export interface MCPApplication {
    /** Display name of the application */
    name: string;

    /** 
     * Icon for the application
     * Can be a string path to a file, a bundled asset name, or undefined
     */
    icon?: string;

    /** Current protection status */
    status: ProtectionStatus;

    /** Optional status message */
    statusMessage?: string;

    /** List of tracked server configurations */
    servers: ProtectedServerConfig[];

    /** Whether this is a system-defined application or user-added */
    isSystem: boolean;

    isDiscovering: boolean;

    /** Configuration file path for this application */
    configurationPath: string;
}

/**
 * Result of the config operation
 */
export interface ConfigOperationResult {
    success: boolean;
    message: string;
    servers?: ProtectedServerConfig[];
    isNotFound?: boolean;
}