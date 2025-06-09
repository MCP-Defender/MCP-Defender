/**
 * Verification API Handlers
 * 
 * These endpoints are used by the CLI helper for verifying tool calls and responses
 * when using the STDIO transport with the MCP server.
 */

import http from 'node:http';
import { verifyToolCall, verifyToolResponse } from '../verification-utils.js';
import { DefenderState, sendMessageToParent } from '../common/types.js';
import { DefenderServerEvent } from '../../services/defender/types.js';

/**
 * Handle verification request for a tool call
 * 
 * This API endpoint is used by the CLI helper for STDIO transport verification
 * It verifies tool calls against security policies for the STDIO transport
 * 
 * @param data Request data containing message and tool information
 * @param res HTTP response object
 * @param state Global defender state
 */
export async function handleVerifyRequest(
    data: any,
    res: http.ServerResponse,
    state: DefenderState
) {
    const { message, toolName } = data;

    if (!message || !toolName) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
    }

    try {
        // Extract args from the message - note that in MCP, the arguments are directly under params
        const args = message.params?.arguments || {};

        // Extract user_intent from args and remove it from the args passed to the tool
        const userIntent = args.user_intent || '';
        const { user_intent, ...toolArgs } = args; // Remove user_intent from tool args

        // Server info for scan result
        const serverInfo = {
            serverName: data.serverInfo?.name || 'unknown',
            serverVersion: data.serverInfo?.version || 'unknown',
            appName: data.serverInfo?.appName || 'unknown'
        };

        console.debug(`Server info: ${JSON.stringify(serverInfo)}`);
        console.debug(`User intent: ${userIntent}`);

        // Verify the tool call with user intent
        const verification = await verifyToolCall(toolName, toolArgs, serverInfo, userIntent);

        // Response with verification result
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            blocked: !verification.allowed,
            reason: !verification.allowed ? 'Security policy violation' : null,
            modified: false // No modification support yet
        }));
    } catch (error) {
        console.error('Error verifying tool call:', error);

        // Return error
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Verification error', blocked: true }));
    }
}

/**
 * Handle verification request for a tool response
 * 
 * This API endpoint is used by the CLI helper for STDIO transport verification
 * It verifies tool responses against security policies for the STDIO transport
 * 
 * @param data Request data containing message and tool information
 * @param res HTTP response object
 * @param state Global defender state
 */
export async function handleVerifyResponse(
    data: any,
    res: http.ServerResponse,
    state: DefenderState
) {
    const { message, toolName } = data;

    if (!message || !toolName) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
    }

    try {
        // Server info for scan result
        const serverInfo = {
            serverName: data.serverInfo?.name || 'unknown',
            serverVersion: data.serverInfo?.version || 'unknown',
            appName: data.serverInfo?.appName || 'unknown'
        };

        // Verify the tool response
        const verification = await verifyToolResponse(
            toolName,
            message,
            serverInfo
        );

        // Response with verification result
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            blocked: !verification.allowed,
            reason: !verification.allowed ? 'Security policy violation' : null,
            modified: false // No modification support yet
        }));
    } catch (error) {
        console.error('Error verifying tool response:', error);

        // Return error
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Verification error', blocked: false }));
    }
}

/**
 * Handle tool registration from CLI helper
 * 
 * This API endpoint receives tool information from the CLI helper when it 
 * intercepts a tools/list response. The tools are stored in the defender state
 * and a notification is sent to the main process.
 * 
 * @param data Request data containing tools and server information
 * @param res HTTP response object
 * @param state Global defender state
 */
export async function handleRegisterTools(
    data: any,
    res: http.ServerResponse,
    state: DefenderState
) {
    const { tools, serverInfo, appName, serverName } = data;

    if (!tools || !Array.isArray(tools)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid tools data' }));
        return;
    }

    try {
        // Create a unique key for storing the tools
        const effectiveServerName = serverInfo?.name || serverName || 'unknown';
        const effectiveAppName = appName || 'unknown';
        const key = `${effectiveAppName}:${effectiveServerName}`;

        // Log detailed tool information including descriptions
        console.log(`Registering ${tools.length} tools for ${key}:`);
        tools.forEach((tool, index) => {
            const description = tool.description ? ` - ${tool.description}` : ' (no description)';
            const parameters = tool.parameters || tool.inputSchema;
            const paramCount = parameters?.properties ? Object.keys(parameters.properties).length : 0;

            console.log(`  ${index + 1}. ${tool.name}${description} (${paramCount} parameters)`);
        });

        // Initialize serverTools if needed
        if (!state.serverTools) {
            state.serverTools = new Map();
        }

        // Process tools to ensure they have proper structure for storage
        const processedTools = tools.map(tool => ({
            name: tool.name,
            description: tool.description || null,
            parameters: tool.parameters || tool.inputSchema || null,
            // Keep any additional properties
            ...tool
        }));

        // Store tools in the state with enhanced information
        state.serverTools.set(key, {
            tools: processedTools,
            serverInfo: {
                name: effectiveServerName,
                version: serverInfo?.version || 'unknown',
                appName: effectiveAppName,
                ...serverInfo
            },
            lastUpdated: new Date()
        });

        console.log(`Successfully registered ${tools.length} tools for ${key}`);

        // Count tools with and without descriptions for logging
        const toolsWithDescriptions = processedTools.filter(tool => tool.description);
        const toolsWithoutDescriptions = processedTools.filter(tool => !tool.description);

        if (toolsWithDescriptions.length > 0) {
            console.log(`  ${toolsWithDescriptions.length} tools have descriptions`);
        }
        if (toolsWithoutDescriptions.length > 0) {
            console.log(`  ${toolsWithoutDescriptions.length} tools missing descriptions`);
        }

        // Notify main process about the new tools with enhanced data
        sendMessageToParent({
            type: DefenderServerEvent.TOOLS_UPDATE,
            data: {
                appName: effectiveAppName,
                serverName: effectiveServerName,
                tools: processedTools,
                timestamp: new Date().toISOString(),
                stats: {
                    total: processedTools.length,
                    withDescriptions: toolsWithDescriptions.length,
                    withoutDescriptions: toolsWithoutDescriptions.length
                }
            }
        });

        // Return success with detailed information
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            success: true,
            message: `Registered ${tools.length} tools for ${effectiveAppName}:${effectiveServerName}`,
            stats: {
                total: processedTools.length,
                withDescriptions: toolsWithDescriptions.length,
                withoutDescriptions: toolsWithoutDescriptions.length
            }
        }));
    } catch (error) {
        console.error('Error registering tools:', error);

        // Return error
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Tool registration error' }));
    }
}

/**
 * Handle log messages from CLI helper
 * 
 * This API endpoint receives log messages from the CLI helper and forwards them
 * to the main process for centralized logging. This bypasses file system restrictions
 * that might prevent the CLI from writing logs directly.
 * 
 * @param data Request data containing log messages
 * @param res HTTP response object
 * @param state Global defender state
 */
export async function handleCliLogs(
    data: any,
    res: http.ServerResponse,
    state: DefenderState
) {
    const { messages, source } = data;

    if (!messages || !Array.isArray(messages)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid log data format' }));
        return;
    }

    try {
        // Forward logs to the main process
        const sourceInfo = source || {
            appName: 'unknown',
            serverName: 'unknown',
            processId: 'unknown'
        };

        // Forward each message to the parent process
        for (const logEntry of messages) {
            // Add source information to the log entry
            const enhancedLogEntry = {
                ...logEntry,
                source: sourceInfo,
                timestamp: logEntry.timestamp || new Date().toISOString()
            };

            // Forward to main process for centralized logging
            sendMessageToParent({
                type: 'CLI_LOG',
                data: enhancedLogEntry
            });

            // Also log to console for debugging
            const logLevel = logEntry.level?.toLowerCase() || 'info';
            const logMethod = logLevel === 'error' ? console.error :
                logLevel === 'warn' ? console.warn :
                    logLevel === 'debug' ? console.debug :
                        console.log;
            logMethod(`[CLI:${sourceInfo.processId}] ${logEntry.message}`);
        }

        // Return success
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            success: true,
            count: messages.length
        }));
    } catch (error) {
        console.error('Error handling CLI logs:', error);

        // Return error
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: 'Log processing error',
            message: String(error)
        }));
    }
} 