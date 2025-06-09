#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import http from 'node:http';
import fs from 'node:fs/promises';
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
    SECURITY_ENHANCED_PREFIX: '🔒 SECURITY-ENHANCED: '
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
const command = process.argv[cmdIndex];
const args = process.argv.slice(cmdIndex + 1);

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
                        if (responseData) {
                            const parsedData = JSON.parse(responseData);
                            resolve(parsedData);
                        } else {
                            resolve({});
                        }
                    } catch (e) {
                        reject(new Error(`Invalid response: ${responseData}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
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
            await log.debug('Detected MCP initialize request');
        }

        // Detect tools/list request - we'll track this to capture the response
        if (message.method === 'tools/list') {
            await log.debug(`Detected tools list request with ID: ${message.id}`);
            state.pendingToolsListId = message.id;
        }

        // Check if this is a tool call
        // The MCP specification uses "tools/call" for the method name
        if (message.method === 'tools/call') {
            // Extract tool name and ID from message (params structure is different from what we expected)
            const params = message.params || {};
            state.currentToolName = params.name || 'unknown';
            state.currentToolId = message.id || null;

            await log.debug(`Detected tool call: ${state.currentToolName} (ID: ${state.currentToolId})`);

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

                const verificationResponse = await makeApiRequest(
                    `/verify/request`,
                    verificationData
                );

                // Handle verification result
                if (verificationResponse) {
                    // If tool call is blocked
                    if (verificationResponse.blocked) {
                        await log.debug(`Tool call blocked: ${state.currentToolName} - Reason: ${verificationResponse.reason || 'Policy violation'}`);

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
                        await log.debug(`Tool call modified: ${state.currentToolName}`);
                        return verificationResponse.message;
                    }
                }
            } catch (error) {
                await log.error(`Tool call verification error`, error);
                // On error, continue with original message but strip user_intent
            }

            // If verification passed or failed with error, we need to strip user_intent before forwarding to target
            if (message.params && message.params.arguments && message.params.arguments.user_intent) {
                await log.debug(`Stripping user_intent before forwarding to target server`);

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
            await log.debug(`Handling MCP method: ${message.method}, params: ${JSON.stringify(message.params)}`);
        }

        // For non-tool calls or verified tool calls, pass through
        return message;
    } catch (error) {
        await log.error('Error processing request', error);
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
            await log.debug(`Received potential response for tool ${state.currentToolName} with ID ${state.currentToolId}`);
        }

        // Check for server info in initialize response
        if (message.id === 0 && message.result && message.result.serverInfo) {
            await extractServerInfo(message);
        }

        // Check if this is a response to a tools/list request
        if (state.pendingToolsListId !== null && message.id === state.pendingToolsListId && message.result) {
            await log.debug('Received tools list response');

            // Store the original tools locally
            const originalTools = message.result.tools || [];
            await log.debug(`Discovered ${originalTools.length} tools`);

            // Log tool descriptions for debugging
            for (const tool of originalTools) {
                await log.debug(`Tool: ${tool.name}${tool.description ? ` - ${tool.description}` : ' (no description)'}`);
            }

            // Modify each tool to add user_intent parameter
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

            // Update the message with modified tools
            message.result.tools = modifiedTools;

            // Store both original and modified tools
            state.discoveredTools = originalTools; // Keep original for registration

            await log.debug(`Modified ${modifiedTools.length} tools to include user_intent parameter`);

            // Send original tools to defender server for tracking (not the modified ones)
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

                await log.debug(`Registering ${toolsWithDescriptions.length} tools with defender (preserving descriptions)`);

                await makeApiRequest('/register-tools', registrationData);
                await log.debug('Successfully registered tools with defender');

                // In discovery mode, exit after successfully registering tools
                if (state.exitAfterDiscovery) {
                    await log.info(`Discovery mode: Exiting after successful tool registration`);
                    setTimeout(() => {
                        process.exit(0);
                    }, 500); // Small delay to ensure message is sent
                }
            } catch (error) {
                await log.error('Failed to register tools with defender', error);

                if (state.exitAfterDiscovery) {
                    await log.error('Discovery mode: Exiting after failed tool registration');
                    setTimeout(() => {
                        process.exit(1);
                    }, 500);
                }
            }

            // Clear pending ID
            state.pendingToolsListId = null;
        }

        // Check if this is a response to a tool call
        // In MCP, tool responses have a result property and match our tracked currentToolId
        if (message.result && state.currentToolName && message.id && message.id === state.currentToolId) {
            await log.debug(`Detected response for tool: ${state.currentToolName}`);

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
                const verificationResponse = await makeApiRequest(
                    `/verify/response`,
                    verificationData
                );

                // Handle verification result
                if (verificationResponse) {
                    // If response is blocked
                    if (verificationResponse.blocked) {
                        await log.debug(`Tool response blocked: ${state.currentToolName} - Reason: ${verificationResponse.reason || 'Policy violation'}`);

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
                        await log.debug(`Tool response modified: ${state.currentToolName}`);

                        // Clear tool state
                        state.currentToolName = null;
                        state.currentToolId = null;

                        return verificationResponse.message;
                    }
                }
            } catch (error) {
                await log.error('Tool response verification error', error);
            }

            // Clear tool info after processing the response
            state.currentToolName = null;
            state.currentToolId = null;
        }

        // For non-tool responses or verified responses, pass through
        return message;
    } catch (error) {
        await log.error('Error processing response', error);
        state.currentToolName = null;
        state.currentToolId = null;
        return message; // Pass through on error
    }
}

// Handle signals to ensure clean shutdown
async function handleSignal(signal: NodeJS.Signals): Promise<void> {
    await log.debug(`Received ${signal}, shutting down`);

    if (targetServer) {
        targetServer.kill(signal);
    }
    process.exit(0);
}

// Set up signal handlers
process.on('SIGINT', () => {
    handleSignal('SIGINT').catch(err => console.error('Error in signal handler:', err));
});
process.on('SIGTERM', () => {
    handleSignal('SIGTERM').catch(err => console.error('Error in signal handler:', err));
});

// Remove all the HTTP-based log sending code
// Just handle process exit for cleanup
process.on('exit', () => {
    console.error('Process exiting');
});

// Start the target MCP server
const targetServer = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env
});

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
    await log.debug(`Received ${chunk.length} bytes from stdin`);

    // Add data to buffer
    stdinBuffer.append(chunk);

    // Process all complete messages in the buffer
    while (true) {
        try {
            const message = stdinBuffer.readMessage();
            if (!message) break;

            await log.debug(`Processing message from stdin: ${JSON.stringify(message)}`);

            // Process the message before forwarding
            const processedMessage = await processRequest(message);

            // If the processed message is a block response (different from the original),
            // send it directly to stdout instead of to the target server
            if (processedMessage !== message && processedMessage.result) {
                await log.debug(`Sending block response directly to stdout`);
                const serialized = serializeMessage(processedMessage);
                process.stdout.write(serialized);
                continue;
            }

            // Otherwise, forward to target server's stdin
            const serialized = serializeMessage(processedMessage);
            targetServer.stdin.write(serialized);
        } catch (error) {
            await log.error('Failed to process stdin message', error);
        }
    }
});

// Handle messages from target server's stdout (to MCP client)
targetServer.stdout.on('data', async (chunk) => {
    await log.debug(`Received ${chunk.length} bytes from target server`);

    // Add data to buffer
    targetStdoutBuffer.append(chunk);

    // Process all complete messages in the buffer
    while (true) {
        try {
            const message = targetStdoutBuffer.readMessage();
            if (!message) break;

            await log.debug(`Processing message from server: ${JSON.stringify(message)}`);

            // Process the message before forwarding
            const processedMessage = await processResponse(message);

            // Forward to our stdout (to MCP client)
            const serialized = serializeMessage(processedMessage);
            process.stdout.write(serialized);
        } catch (error) {
            await log.error('Failed to process server message', error);
        }
    }
});

// Handle stdin end
process.stdin.on('end', () => {
    log.debug('stdin ended, closing target server').catch(err => {
        console.error('Failed to log message:', err);
    });

    targetServer.stdin.end();
});