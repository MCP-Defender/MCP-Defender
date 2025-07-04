#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';  // Add synchronous fs for accessSync
import path from 'node:path';
import os from 'node:os';

/**
 * MCP STDIO Proxy - Intercepts and verifies MCP tool calls and responses
 * 
 * This proxy sits between an MCP client and server, intercepting JSON-RPC messages
 * to allow for security verification of tool calls and responses.
 */

// MCP Defender Constants
const MCP_DEFENDER_CONSTANTS = {
    SECURITY_ENHANCED_PREFIX: '🔒'
} as const;

// Configuration
const CONFIG = {
    // Enable debug mode with --debug flag or MCP_DEBUG=true environment variable
    // Add this to your MCP configuration env section for more detailed logs
    debug: true,
    defenderPort: 28173,
    defenderHost: '127.0.0.1',
    // Use environment variable for log dir or default to OS temp directory
    logDir: process.env.MCP_DEFENDER_LOG_DIR || path.join(os.homedir(), '.mcp-defender', 'logs'),
    // Flag for discovery mode - optimizes for tool discovery
    discoveryMode: process.env.MCP_DEFENDER_DISCOVERY_MODE === 'true'
};

// Ensure log directory exists
async function ensureLogDirectory() {
    try {
        await fs.mkdir(CONFIG.logDir, { recursive: true });
    } catch (error) {
        console.error('[Logger] Failed to create log directory:', error);
    }
}

// Get log file path - use date for file naming
function getLogFilePath() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(CONFIG.logDir, `mcp-defender-cli-${date}.log`);
}

// Write log message to file
async function writeToLogFile(message: string) {
    try {
        await fs.appendFile(getLogFilePath(), message + '\n', 'utf8');
    } catch (error) {
        console.error('[Logger] Failed to write to log file:', error);
    }
}

// Simple logger - uses console.error for immediate feedback
const log = {
    debug: async (message: string): Promise<void> => {
        // Skip excessive logging in discovery mode unless explicitly debugging
        if (CONFIG.debug && (!CONFIG.discoveryMode || message.includes('tools/list'))) {
            console.error(`[DEBUG] ${message}`);
            // Also log to file as backup if we can
            try {
                const timestamp = new Date().toISOString();
                await writeToLogFile(`${timestamp} DEBUG [${process.pid}] ${message}`);
            } catch (error) {
                // Ignore file writing errors - console.error is the primary output
            }
        }
    },
    info: async (message: string): Promise<void> => {
        // Reduce verbosity in discovery mode
        if (!CONFIG.discoveryMode || message.includes('tools') || message.includes('discovery')) {
            console.error(`[INFO] ${message}`);
            try {
                const timestamp = new Date().toISOString();
                await writeToLogFile(`${timestamp} INFO [${process.pid}] ${message}`);
            } catch (error) {
                // Ignore file writing errors
            }
        }
    },
    error: async (message: string, error?: any): Promise<void> => {
        console.error(`[ERROR] ${message}`);
        try {
            const timestamp = new Date().toISOString();
            await writeToLogFile(`${timestamp} ERROR [${process.pid}] ${message}`);

            if (error && CONFIG.debug) {
                console.error(error);
                // Try to stringify error for log file
                let errorDetails = '';
                try {
                    errorDetails = JSON.stringify(error);
                } catch {
                    errorDetails = String(error);
                }
                await writeToLogFile(`${timestamp} ERROR [${process.pid}] Details: ${errorDetails}`);
            }
        } catch (error) {
            // Ignore file writing errors
        }
    }
};

// Command arguments
const cmdIndex = process.argv.indexOf('--debug') > -1 ?
    process.argv.indexOf('--debug') + 1 : 2;
let command = process.argv[cmdIndex];
const args = process.argv.slice(cmdIndex + 1);

// In production builds, resolve executable paths if needed
if (command === 'node' || command === 'npx' || command === 'docker') {
    // Function to check if a path exists and is executable
    const isExecutable = (path: string): boolean => {
        try {
            fsSync.accessSync(path, fsSync.constants.F_OK | fsSync.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    };

    // Try to find the executable
    let executablePath: string;

    if (command === 'node') {
        // First try the current process's executable path (might be Electron in production)
        if (process.execPath.includes('node') && isExecutable(process.execPath)) {
            executablePath = process.execPath;
        } else {
            // Try common Node.js locations
            const possibleNodePaths = [
                '/usr/local/bin/node',  // Common macOS location
                '/usr/bin/node',        // Common Linux location
                '/opt/homebrew/bin/node', // Apple Silicon Homebrew
                process.env.NODE_PATH ? path.join(process.env.NODE_PATH, 'node') : null,
            ].filter(Boolean);

            executablePath = 'node'; // fallback
            for (const possiblePath of possibleNodePaths) {
                if (possiblePath && isExecutable(possiblePath)) {
                    executablePath = possiblePath;
                    break;
                }
            }
        }
    } else if (command === 'npx') {
        // Try common npx locations
        const possibleNpxPaths = [
            '/usr/local/bin/npx',     // Common macOS location
            '/usr/bin/npx',           // Common Linux location
            '/opt/homebrew/bin/npx',  // Apple Silicon Homebrew
            process.env.NPM_CONFIG_PREFIX ? path.join(process.env.NPM_CONFIG_PREFIX, 'bin', 'npx') : null,
        ].filter(Boolean);

        executablePath = 'npx'; // fallback
        for (const possiblePath of possibleNpxPaths) {
            if (possiblePath && isExecutable(possiblePath)) {
                executablePath = possiblePath;
                break;
            }
        }
    } else if (command === 'docker') {
        // Try common docker locations
        const possibleDockerPaths = [
            '/usr/local/bin/docker',  // Common macOS location
            '/usr/bin/docker',        // Common Linux location
            '/opt/homebrew/bin/docker', // Apple Silicon Homebrew
            '/Applications/Docker.app/Contents/Resources/bin/docker', // Docker Desktop on macOS
        ];

        executablePath = 'docker'; // fallback
        for (const possiblePath of possibleDockerPaths) {
            if (isExecutable(possiblePath)) {
                executablePath = possiblePath;
                break;
            }
        }
    }

    log.debug(`Resolved executable path from '${command}' to '${executablePath}'`);
    command = executablePath;
}

// MCP protocol state
const state = {
    protocolVersion: "2024-11-05",
    currentToolName: null as string | null,
    currentToolId: null as string | null,
    // New fields for tool discovery
    pendingToolsListId: null as string | number | null,
    discoveredTools: [] as any[],
    // App and server identification
    appName: process.env.MCP_DEFENDER_APP_NAME || 'unknown',
    serverName: process.env.MCP_DEFENDER_SERVER_NAME || 'unknown',
    serverVersion: "unknown",
    // App metadata from MCP Defender
    appVersion: process.env.MCP_DEFENDER_APP_VERSION || 'unknown',
    appPlatform: process.env.MCP_DEFENDER_APP_PLATFORM || 'unknown',
    // Flag to exit after tool discovery is complete
    exitAfterDiscovery: CONFIG.discoveryMode
};

// Initialize log directory
ensureLogDirectory().catch(err => {
    console.error('Failed to create log directory:', err);
});

// Initialize and log startup info
log.debug(`Starting MCP STDIO Proxy - Process ID: ${process.pid}`);
log.debug(`Command: ${command}`);
log.debug(`Args: ${args.join(' ')}`);
if (CONFIG.discoveryMode) {
    log.info('Running in discovery mode - will exit after tools are discovered');

    // In discovery mode, set a timeout to exit if no tools are discovered
    // Reduced timeout for faster IDE integration
    setTimeout(() => {
        log.error('Discovery mode timeout - no tools discovered within 5 seconds').catch(() => { });
        process.exit(2);
    }, 5000);
}

/**
 * Interface for verification request data
 */
interface VerificationData {
    message: any;
    toolName: string;
    serverInfo: any;
}

/**
 * Makes an HTTP request to the MCP Defender server
 */
async function makeApiRequest(
    endpoint: string,
    data: any,
    method: 'GET' | 'POST' = 'POST'
): Promise<Record<string, any> | null> {
    return new Promise((resolve, reject) => {
        try {
            const postData = method === 'POST' ? JSON.stringify(data) : '';

            const options = {
                hostname: CONFIG.defenderHost,
                port: CONFIG.defenderPort,
                path: endpoint,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            log.debug(`Making API request to ${endpoint} with options: ${JSON.stringify(options)} and data: ${JSON.stringify(data)} `);

            const req = http.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        log.debug(`API response from ${endpoint}: status=${res.statusCode}, data=${responseData}`);

                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            if (responseData) {
                                const parsedData = JSON.parse(responseData);
                                resolve(parsedData);
                            } else {
                                resolve({});
                            }
                        } else {
                            reject(new Error(`API request failed with status ${res.statusCode}: ${responseData}`));
                        }
                    } catch (e) {
                        reject(new Error(`Invalid response from ${endpoint}: ${responseData}`));
                    }
                });
            });

            req.on('error', (error: any) => {
                log.error(`Network error making request to ${endpoint}: ${error.message}`).catch(() => { });
                // Provide more specific error messages
                if (error.code === 'ECONNREFUSED') {
                    reject(new Error('MCP Defender server not running or not accessible'));
                } else if (error.code === 'ENOTFOUND') {
                    reject(new Error('MCP Defender server host not found'));
                } else {
                    reject(error);
                }
            });

            req.setTimeout(35000, () => {
                log.error(`Request to ${endpoint} timed out after 35 seconds`).catch(() => { });
                req.destroy();
                reject(new Error('Verification request timeout - Security alert may have timed out or MCP Defender server may be overloaded'));
            });

            if (method === 'POST') {
                req.write(postData);
            }
            req.end();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Extract and store MCP server information from initialize response
 */
async function extractServerInfo(message: any): Promise<void> {
    if (message && message.result && message.id === 0) {
        // This is likely the initialize response
        const result = message.result;

        // Extract protocol version
        if (result.protocolVersion) {
            state.protocolVersion = result.protocolVersion;
            await log.debug(`MCP Protocol Version: ${state.protocolVersion}`);
        }

        // Extract server info
        /*
            Example server info:
            "serverInfo":{"name":"example-servers/everything","version":"1.0.0"}}}
        */
        if (result.serverInfo) {
            // Only set server version since our name is in another format
            state.serverVersion = result.serverInfo.version;
            await log.debug(`MCP Server: ${state.serverName} v${state.serverVersion}`);
        }
    }
}

/**
 * Process a JSON-RPC message from stdin before forwarding to target server
 */
async function processRequest(message: any): Promise<any> {
    try {
        // Handle MCP initialization
        if (message.method === 'initialize' && message.id === 0) {
            log.debug('Detected MCP initialize request').catch(() => { });
        }

        // Detect tools/list request - we'll track this to capture the response
        if (message.method === 'tools/list') {
            log.debug(`Detected tools list request with ID: ${message.id}`).catch(() => { });
            state.pendingToolsListId = message.id;
        }

        // Check if this is a tool call
        // The MCP specification uses "tools/call" for the method name
        if (message.method === 'tools/call') {
            // Extract tool name and ID from message (params structure is different from what we expected)
            const params = message.params || {};
            state.currentToolName = params.name || 'unknown';
            state.currentToolId = message.id || null;

            log.debug(`Detected tool call: ${state.currentToolName} (ID: ${state.currentToolId})`).catch(() => { });

            // Send the tool call for verification
            try {
                // Add test signatures to the verification request if available
                const verificationData: VerificationData = {
                    message,
                    toolName: state.currentToolName,
                    serverInfo: {
                        appName: state.appName,
                        name: state.serverName,
                        version: state.serverVersion
                    }
                };

                log.debug(`Sending tool call for verification: ${state.currentToolName}`).catch(() => { });
                log.info(`Verifying tool call: ${state.currentToolName} - This may show a security alert if policy violations are detected`).catch(() => { });
                const verificationResponse = await makeApiRequest(
                    `/verify/request`,
                    verificationData
                );
                log.debug(`Received verification response for ${state.currentToolName}: ${JSON.stringify(verificationResponse)}`).catch(() => { });

                // Handle verification result
                if (verificationResponse) {
                    // If tool call is blocked
                    if (verificationResponse.blocked) {
                        log.debug(`Tool call blocked: ${state.currentToolName} - Reason: ${verificationResponse.reason || 'Policy violation'}`).catch(() => { });

                        // Create a response that indicates the call was blocked
                        const blockResponse = {
                            jsonrpc: "2.0",
                            id: message.id,
                            result: {
                                content: [
                                    {
                                        type: "text",
                                        text: `MCP Defender blocked tool call to ${state.currentToolName} - ${verificationResponse.reason || 'Security policy violation'}`
                                    }
                                ]
                            }
                        };

                        return blockResponse;
                    }

                    // If tool call is modified
                    if (verificationResponse.modified && verificationResponse.message) {
                        log.debug(`Tool call modified: ${state.currentToolName}`).catch(() => { });
                        return verificationResponse.message;
                    }

                    // If verification response is valid but doesn't explicitly block or modify,
                    // and it's not explicitly allowed, treat as allowed
                    // (This handles the case where blocked: false, modified: false)
                } else {
                    // Null or malformed verification response - block for security
                    log.error(`Received null or malformed verification response for ${state.currentToolName}`).catch(() => { });
                    log.error(`Blocking tool call ${state.currentToolName} due to malformed verification response`).catch(() => { });

                    const blockResponse = {
                        jsonrpc: "2.0",
                        id: message.id,
                        result: {
                            content: [
                                {
                                    type: "text",
                                    text: `MCP Defender blocked tool call to ${state.currentToolName} - Verification service returned invalid response. Tool calls are blocked when verification cannot be completed for security reasons.`
                                }
                            ]
                        }
                    };

                    return blockResponse;
                }
            } catch (error) {
                log.error(`Tool call verification error: ${error.message}`, error).catch(() => { });

                // On verification error, block the tool call for security
                log.error(`Blocking tool call ${state.currentToolName} due to verification failure`).catch(() => { });

                // Create a response that indicates the call was blocked due to verification error
                const blockResponse = {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                        content: [
                            {
                                type: "text",
                                text: `MCP Defender blocked tool call to ${state.currentToolName} - Verification service unavailable (${error.message}). Tool calls are blocked when verification cannot be completed for security reasons.`
                            }
                        ]
                    }
                };

                return blockResponse;
            }

            // If verification passed, we need to strip user_intent before forwarding to target
            if (message.params && message.params.arguments && message.params.arguments.user_intent) {
                log.debug(`Stripping user_intent before forwarding to target server`).catch(() => { });

                // Create a clean message without user_intent for the target server
                const cleanMessage = {
                    ...message,
                    params: {
                        ...message.params,
                        arguments: (() => {
                            const { user_intent, ...cleanArgs } = message.params.arguments;
                            return cleanArgs;
                        })()
                    }
                };

                return cleanMessage;
            }
        }

        // Add this inside processRequest function right before returning the message:
        if (message.method && message.method.startsWith('tools/')) {
            log.debug(`Handling MCP method: ${message.method}, params: ${JSON.stringify(message.params)}`).catch(() => { });
        }

        // For non-tool calls or verified tool calls, pass through
        log.debug(`Returning message from processRequest: ${JSON.stringify(message)}`).catch(() => { });
        return message;
    } catch (error) {
        log.error('Error processing request', error).catch(() => { });
        return message; // Pass through on error
    }
}

/**
 * Process a JSON-RPC message from target server before forwarding to stdout
 */
async function processResponse(message: any): Promise<any> {
    try {
        // Add debug info about the message we're processing
        if (state.currentToolName && message.id === state.currentToolId) {
            log.debug(`Received potential response for tool ${state.currentToolName} with ID ${state.currentToolId}`).catch(() => { });
        }

        // Check for server info in initialize response
        if (message.id === 0 && message.result && message.result.serverInfo) {
            extractServerInfo(message).catch(() => { }); // Non-blocking
        }

        // Check if this is a response to a tools/list request
        if (state.pendingToolsListId !== null && message.id === state.pendingToolsListId && message.result) {
            log.debug('Received tools list response').catch(() => { }); // Non-blocking

            // Store the original tools locally
            const originalTools = message.result.tools || [];

            // Quick sync logging for critical info
            if (CONFIG.debug) {
                console.error(`[DEBUG] Discovered ${originalTools.length} tools`);
            }

            // Modify each tool to add user_intent parameter (synchronous operation)
            const modifiedTools = originalTools.map((tool: any) => {
                const modifiedTool = { ...tool };

                // Ensure inputSchema exists
                if (!modifiedTool.inputSchema) {
                    modifiedTool.inputSchema = {
                        type: "object",
                        properties: {},
                        required: []
                    };
                }

                // Add user_intent to properties
                modifiedTool.inputSchema.properties = {
                    ...modifiedTool.inputSchema.properties,
                    user_intent: {
                        type: "string",
                        description: "Explain the reasoning and context for why you are calling this tool. Describe what you're trying to accomplish and how this tool call fits into your overall task. This helps with security monitoring and audit trails."
                    }
                };

                // Add user_intent to required fields
                const requiredFields = modifiedTool.inputSchema.required || [];
                if (!requiredFields.includes('user_intent')) {
                    modifiedTool.inputSchema.required = [...requiredFields, 'user_intent'];
                }

                // Add security-enhanced prefix to description if not already present
                if (modifiedTool.description && !modifiedTool.description.includes('🔒 SECURITY-ENHANCED')) {
                    modifiedTool.description = `${MCP_DEFENDER_CONSTANTS.SECURITY_ENHANCED_PREFIX}${modifiedTool.description}`;
                }

                return modifiedTool;
            });

            // Update the message with modified tools (this needs to happen synchronously)
            message.result.tools = modifiedTools;

            // Store both original and modified tools
            state.discoveredTools = originalTools; // Keep original for registration

            // Register tools with defender in background (non-blocking)
            setImmediate(async () => {
                try {
                    // Create enhanced registration data with explicit tool information
                    const toolsWithDescriptions = originalTools.map((tool: any) => ({
                        name: tool.name,
                        description: tool.description || null,
                        parameters: tool.inputSchema || null,
                        // Preserve any additional tool properties
                        ...tool
                    }));

                    const registrationData = {
                        tools: toolsWithDescriptions,
                        serverInfo: {
                            appName: state.appName,
                            name: state.serverName,
                            version: state.serverVersion
                        },
                        appName: state.appName,
                        serverName: state.serverName
                    };

                    await makeApiRequest('/register-tools', registrationData);
                    log.debug('Successfully registered tools with defender').catch(() => { });

                    // In discovery mode, exit after successfully registering tools
                    if (state.exitAfterDiscovery) {
                        log.info(`Discovery mode: Exiting after successful tool registration`).catch(() => { });
                        setTimeout(() => {
                            process.exit(0);
                        }, 100); // Shorter delay since response is already sent
                    }
                } catch (error) {
                    log.error('Failed to register tools with defender', error).catch(() => { });

                    if (state.exitAfterDiscovery) {
                        log.error('Discovery mode: Exiting after failed tool registration').catch(() => { });
                        setTimeout(() => {
                            process.exit(1);
                        }, 100);
                    }
                }
            });

            // Clear pending ID
            state.pendingToolsListId = null;
        }

        // Check if this is a response to a tool call
        // In MCP, tool responses have a result property and match our tracked currentToolId
        if (message.result && state.currentToolName && message.id && message.id === state.currentToolId) {
            log.debug(`Detected response for tool: ${state.currentToolName}`).catch(() => { });

            const verificationData: VerificationData = {
                message,
                toolName: state.currentToolName,
                serverInfo: {
                    appName: state.appName,
                    name: state.serverName,
                    version: state.serverVersion
                }
            };

            // Send the response for verification
            try {
                log.debug(`Sending tool response for verification: ${state.currentToolName}`).catch(() => { });
                const verificationResponse = await makeApiRequest(
                    `/verify/response`,
                    verificationData
                );
                log.debug(`Received verification response for ${state.currentToolName}: ${JSON.stringify(verificationResponse)}`).catch(() => { });

                // Handle verification result
                if (verificationResponse) {
                    // If response is blocked
                    if (verificationResponse.blocked) {
                        log.debug(`Tool response blocked: ${state.currentToolName} - Reason: ${verificationResponse.reason || 'Policy violation'}`).catch(() => { });

                        // Create a response that indicates the result was blocked
                        const blockResponse = {
                            jsonrpc: "2.0",
                            id: message.id,
                            result: {
                                content: [
                                    {
                                        type: "text",
                                        text: `MCP Defender blocked response from tool ${state.currentToolName} - ${verificationResponse.reason || 'Security policy violation'}`
                                    }
                                ]
                            }
                        };

                        // Clear tool state
                        state.currentToolName = null;
                        state.currentToolId = null;

                        return blockResponse;
                    }

                    // If response is modified
                    if (verificationResponse.modified && verificationResponse.message) {
                        log.debug(`Tool response modified: ${state.currentToolName}`).catch(() => { });

                        // Clear tool state
                        state.currentToolName = null;
                        state.currentToolId = null;

                        return verificationResponse.message;
                    }
                }
            } catch (error) {
                log.error('Tool response verification error', error).catch(() => { });
            }

            // Clear tool info after processing the response
            state.currentToolName = null;
            state.currentToolId = null;
        }

        // For non-tool responses or verified responses, pass through
        return message;
    } catch (error) {
        log.error('Error processing response', error).catch(() => { });
        state.currentToolName = null;
        state.currentToolId = null;
        return message; // Pass through on error
    }
}

// Main execution wrapped in async function
(async function main() {
    // Ensure log directory exists
    await ensureLogDirectory();

    // Handle signals to ensure clean shutdown
    async function handleSignal(signal: NodeJS.Signals, targetServer: any): Promise<void> {
        await log.debug(`Received ${signal}, shutting down`);

        if (targetServer) {
            targetServer.kill(signal);
        }
        process.exit(0);
    }

    // Start the target MCP server
    async function startTargetServer() {
        // Prepare environment with proper PATH for spawned processes
        const spawnEnv = { ...process.env };

        // Ensure the directory containing the node executable is in PATH
        if (command.includes('/')) {
            // If we resolved an absolute path for the command, add its directory to PATH
            const commandDir = path.dirname(command);
            const currentPath = spawnEnv.PATH || '';

            // Add the command directory to the beginning of PATH if it's not already there
            if (!currentPath.split(path.delimiter).includes(commandDir)) {
                spawnEnv.PATH = commandDir + path.delimiter + currentPath;
                await log.debug(`Added ${commandDir} to PATH for spawned process`);
            }
        }

        // Also add common Node.js binary locations to PATH as fallback
        const commonNodeDirs = [
            '/usr/local/bin',
            '/usr/bin',
            '/opt/homebrew/bin'
        ];

        let pathUpdated = false;
        for (const dir of commonNodeDirs) {
            const currentPath = spawnEnv.PATH || '';
            if (!currentPath.split(path.delimiter).includes(dir)) {
                spawnEnv.PATH = (spawnEnv.PATH || '') + path.delimiter + dir;
                pathUpdated = true;
            }
        }

        if (pathUpdated) {
            await log.debug(`Updated PATH for spawned process: ${spawnEnv.PATH}`);
        }

        return spawn(command, args, {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: spawnEnv
        });
    }

    // Start the server
    const targetServer = await startTargetServer();

    // Set up error handling for target process
    targetServer.on('error', (error) => {
        log.error(`Failed to start target server: ${error.message}`).catch(err => {
            console.error('Failed to log error:', err);
        });
        process.exit(1);
    });

    // Handle target server exit
    targetServer.on('close', (code) => {
        log.debug(`Target server exited with code ${code || 0}`).catch(err => {
            console.error('Failed to log message:', err);
        });
        process.exit(code || 0);
    });

    // Set up read buffers for processing JSON-RPC messages
    const stdinBuffer = new ReadBuffer();
    const targetStdoutBuffer = new ReadBuffer();

    // Handle messages from stdin (from MCP client)
    process.stdin.on('data', async (chunk) => {
        // Non-blocking debug logging
        log.debug(`Received ${chunk.length} bytes from stdin`).catch(() => { });

        // Add data to buffer
        stdinBuffer.append(chunk);

        // Process all complete messages in the buffer
        while (true) {
            try {
                const message = stdinBuffer.readMessage();
                if (!message) break;

                // Non-blocking debug logging
                log.debug(`Processing message from stdin: ${JSON.stringify(message)}`).catch(() => { });

                // Process the message before forwarding
                const processedMessage = await processRequest(message);

                // If the processed message is a block response (different from the original),
                // send it directly to stdout instead of to the target server
                if (processedMessage !== message && processedMessage.result) {
                    log.debug(`Sending block response directly to stdout`).catch(() => { });
                    const serialized = serializeMessage(processedMessage);
                    process.stdout.write(serialized);
                    continue;
                }

                // Otherwise, forward to target server's stdin
                const serialized = serializeMessage(processedMessage);
                log.debug(`Forwarding message to target server: ${serialized.trim()}`).catch(() => { });
                targetServer.stdin.write(serialized);
            } catch (error) {
                log.error('Failed to process stdin message', error).catch(() => { });
            }
        }
    });

    // Handle messages from target server's stdout (to MCP client)
    targetServer.stdout.on('data', async (chunk) => {
        // Non-blocking debug logging
        log.debug(`Received ${chunk.length} bytes from target server: ${chunk.toString()}`).catch(() => { });

        // Add data to buffer
        targetStdoutBuffer.append(chunk);

        // Process all complete messages in the buffer
        while (true) {
            try {
                const message = targetStdoutBuffer.readMessage();
                if (!message) break;

                // Non-blocking debug logging
                log.debug(`Processing message from server: ${JSON.stringify(message)}`).catch(() => { });

                // Process the message before forwarding
                const processedMessage = await processResponse(message);

                // Forward to our stdout (to MCP client)
                const serialized = serializeMessage(processedMessage);
                process.stdout.write(serialized);
            } catch (error) {
                log.error('Failed to process server message', error).catch(() => { });
            }
        }
    });

    // Handle stdin end
    process.stdin.on('end', () => {
        log.debug('stdin ended, closing target server').catch(err => {
            console.error('Failed to log message:', err);
        });

        if (CONFIG.discoveryMode) {
            // In discovery mode, don't immediately close the target server
            // Wait for the tools response or timeout
            log.debug('Discovery mode: keeping target server alive to receive tools response').catch(() => { });
        } else {
            targetServer.stdin.end();
        }
    });

    // Set up signal handlers
    process.on('SIGINT', () => {
        handleSignal('SIGINT', targetServer).catch(err => console.error('Error in signal handler:', err));
    });
    process.on('SIGTERM', () => {
        handleSignal('SIGTERM', targetServer).catch(err => console.error('Error in signal handler:', err));
    });

    // Remove all the HTTP-based log sending code
    // Just handle process exit for cleanup
    process.on('exit', () => {
        console.error('Process exiting');
    });

})().catch(error => {
    console.error('Fatal error in main execution:', error);
    process.exit(1);
});