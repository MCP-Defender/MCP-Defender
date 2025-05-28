import http from 'node:http';
import { EventEmitter } from 'node:events';
import { ScanResult } from '../../services/scans/types';
import { Signature } from '../../services/signatures/types';
import { ProtectedServerConfig } from '../../services/configurations/types';
import { ScanMode } from '../../services/settings/types';

/**
 * Interface for scan settings that control verification behavior
 */
export interface ScanSettings {
    mode: ScanMode;
}

/**
 * Represents an active SSE connection
 */
export interface SSEConnection {
    serverName: string;            // Name of MCP server being proxied
    clientRes: http.ServerResponse; // HTTP response object for client connection
    clientReq: http.IncomingMessage; // HTTP request object from client
    targetUrl: string;             // URL of the target MCP server
    emitter: EventEmitter;         // Event emitter for internal communication
    proxyRequest: http.ClientRequest | null; // HTTP request to target server
    // Fields for tracking tool call context
    currentToolName?: string | null;
    currentToolId?: string | number | null;
    // Store the app name with the connection
    appName?: string;
}

/**
 * Represents a pending tool call that's waiting for a response
 * Used to track tool calls across all connections for verification
 */
export interface PendingToolCall {
    toolName: string;              // Name of the tool being called
    requestId: string | number;    // ID of the tool call request
    serverName: string;            // Name of the server this call was made to
    appName: string;               // Name of the application this call was made to
    timestamp: number;             // When the call was made (for cleanup)
    args: any;                     // The arguments passed to the tool
}

/**
 * Context for tracking streaming responses
 */
export interface StreamResponseContext {
    buffer: string;
    toolName: string;
    requestId: string | number;
    responseComplete: boolean;
    lastVerified: number;
}

/**
 * JSON-RPC request format as per MCP specification
 * https://modelcontextprotocol.io/specification/2025-03-26/basic.md#json-rpc
 */
export interface JsonRpcRequest<T> {
    id: string | number;
    method: string;
    params: T;
    jsonrpc: string;
}

/**
 * JSON-RPC notification format as per MCP specification
 * https://modelcontextprotocol.io/specification/2025-03-26/basic.md#json-rpc
 * Notifications do not have an ID and do not expect a response
 */
export interface JsonRpcNotification<T> {
    method: string;
    params: T;
    jsonrpc: string;
}

/**
 * Global state for the defender controller
 */
export interface DefenderState {
    server: http.Server | null;
    signatures: Signature[];
    sseConnections: Map<string, SSEConnection>;
    pendingToolCalls: Map<string, PendingToolCall>; // Track pending tool calls across connections
    running: boolean;
    serverTools?: Map<string, ServerToolsInfo>; // Store tool information by app:server key
    protectedServers: Map<string, ProtectedServerConfig[]>; // Store server configs by app name
    settings: {
        scanMode: ScanMode;
        loginToken: string;
        llm: {
            model: string;
            apiKey: string;
            provider: string;
        };
        disabledSignatures: Set<string>;
    };
}

/**
 * Information about a server's available tools 
 */
export interface ServerToolsInfo {
    tools: any[];         // The tools available on this server
    serverInfo: any;      // Information about the server
    lastUpdated: Date;    // When this information was last updated
}

/**
 * Interface for security alert request messages
 * Used to request user input for security violations
 */
export interface SecurityAlertRequest {
    requestId: string;     // Unique ID to match request and response
    scanResult: ScanResult; // The scan result that triggered the alert
}

/**
 * Interface for security alert response messages
 * Contains the user's decision about a security alert
 */
export interface SecurityAlertResponse {
    requestId: string;     // Matches the original request ID
    allowed: boolean;      // True if the user allowed the operation
}

/**
 * Utility function to send a message to the parent process
 */
export function sendMessageToParent(message: any) {
    try {
        console.log('Sending message to parent:', message);
        if (process.parentPort) {
            process.parentPort.postMessage(message);
        } else {
            console.error("No parent port available - this process may not be running in a worker thread");
        }
    } catch (err) {
        console.error("Error sending parentPort message:", err);
    }
}

