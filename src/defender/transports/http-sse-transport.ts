/**
 * HTTP+SSE Transport Handler (2024-11-05 spec)
 * 
 * Implements a proxy for the MCP HTTP+SSE transport as defined in the specification:
 * https://modelcontextprotocol.io/specification/2024-11-05/basic/transports.md
 * 
 * Note: This implements the older HTTP+SSE transport pattern from the 2024-11-05 spec, not 
 * the newer Streamable HTTP transport from the 2025-03-26 spec. The key difference is that
 * the older spec uses two separate endpoints (SSE endpoint and message endpoint), while the
 * newer spec uses a single endpoint for both.
 * 
 * The HTTP+SSE transport uses two endpoints:
 * 1. SSE endpoint (GET) - Client establishes a long-lived connection to receive events
 * 2. Message endpoint (POST) - Client sends requests to this endpoint
 * 
 * MCP HTTP+SSE FLOW:
 * ----------------
 * According to the MCP specification:
 * 
 * 1. Client makes a GET request to SSE endpoint with Accept: text/event-stream header
 * 2. Server responds with 200 OK and Content-Type: text/event-stream 
 * 3. Server sends an 'endpoint' event with message URI as data
 * 4. Client sends tool requests via POST to the message endpoint
 * 5. Server can respond in two ways:
 *    a) Direct HTTP response to the POST request
 *    b) 202 Accepted, followed by event on the SSE stream
 * 
 * MCP DEFENDER PROXY IMPLEMENTATION:
 * -------------------------------
 * Our proxy implementation follows these steps:
 * 
 * 1. SSE Connection Setup:
 *    - Client connects to our proxy's SSE endpoint
 *    - Proxy opens connection to target MCP server
 *    - Proxy intercepts and rewrites 'endpoint' event to point to our message endpoint
 *    - Both connections remain open for the session
 * 
 * 2. Tool Call Request (POST):
 *    - Client makes a POST request to our message endpoint
 *    - Proxy verifies the tool call against security policies
 *    - If allowed, proxy stores call details in pendingToolCalls Map with key "{serverName}:{requestId}"
 *    - Proxy forwards request to target MCP server
 * 
 * 3. Tool Call Response Handling:
 *    - If response comes directly via HTTP:
 *      * Proxy looks up request ID in pendingToolCalls
 *      * Proxy verifies the response against security policies
 *      * If allowed, proxy forwards to client
 *      * Entry is removed from pendingToolCalls
 * 
 *    - If response comes via SSE event:
 *      * Target server sends 202 Accepted in response to POST
 *      * Later, target sends event containing the response
 *      * Proxy intercepts event, extracts request ID
 *      * Proxy looks up request ID in pendingToolCalls
 *      * Proxy verifies response against security policies
 *      * If allowed, proxy forwards event to client
 *      * Entry is removed from pendingToolCalls
 * 
 * 4. Cleanup:
 *    - Stale pending tool calls are periodically removed
 *    - SSE connections are closed when clients disconnect
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { EventEmitter } from 'node:events';
import { ScanResult } from '../../services/scans/types';
import {
    verifyToolCall,
    verifyToolResponse
} from '../verification-utils.js';
import { SSEConnection, DefenderState, PendingToolCall, sendMessageToParent } from '../common/types.js';

// Import the new utility functions for tool call tracking
import { getCallKey, trackToolCall, cleanupStaleCalls, TOOL_CALL_MAX_AGE } from '../utils/tool-call-tracker.js';

// Import utility function for finding target URLs
import { findTargetUrlForServer } from '../defender-controller.js';
import { DefenderServerEvent } from '../../services/defender/types.js';
import { MCPDefenderEnvVar } from '../../services/configurations/types.js';

/**
 * Sends a tools/list request to the target server and updates the tool registry
 * This implements tool discovery for SSE transport as per MCP specification
 * 
 * @param targetUrl The target server URL
 * @param serverName The MCP server name
 * @param appName The application name
 */
export async function queryServerTools(
    targetUrl: string,
    serverName: string,
    appName: string
): Promise<void> {
    try {
        console.log(`Querying tools from SSE server: ${serverName} at ${targetUrl}`);

        // Determine target API endpoint (convert SSE URL to message endpoint)
        const messageEndpoint = targetUrl.replace('/sse', '/message');

        // Create a trackable request ID
        const requestId = `mcp-defender-tools-list-${Date.now()}`;

        // Create a tools/list JSON-RPC request
        const listRequest = {
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/list',
            params: {}
        };

        // Send the request with a timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(messageEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(listRequest),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Check if successful
        if (!response.ok) {
            console.warn(`Failed to query tools: ${response.status} ${response.statusText}`);

            // Signal discovery failure
            sendMessageToParent({
                type: DefenderServerEvent.TOOLS_DISCOVERY_COMPLETE,
                data: { appName, serverName, success: false }
            });
            return;
        }

        // Parse the response
        const data = await response.json();

        // Check if we got a valid response with tools
        if (data?.result?.tools && Array.isArray(data.result.tools)) {
            const tools = data.result.tools;
            console.log(`Discovered ${tools.length} tools from server ${serverName} for app ${appName}`);

            // Send tools update to main process
            sendMessageToParent({
                type: DefenderServerEvent.TOOLS_UPDATE,
                data: {
                    tools,
                    appName,
                    serverName
                }
            });

            // Signal discovery success
            sendMessageToParent({
                type: DefenderServerEvent.TOOLS_DISCOVERY_COMPLETE,
                data: { appName, serverName, success: true }
            });
        } else {
            console.warn(`Invalid tools/list response from server ${serverName}:`, data);

            // Signal discovery failure
            sendMessageToParent({
                type: DefenderServerEvent.TOOLS_DISCOVERY_COMPLETE,
                data: { appName, serverName, success: false }
            });
        }
    } catch (error: any) {
        // Handle abort errors separately
        if (error.name === 'AbortError') {
            console.error(`Tool query to ${serverName} timed out after 5 seconds`);
        } else {
            console.error(`Error querying tools from SSE server ${serverName}:`, error);
        }

        // Signal discovery failure
        sendMessageToParent({
            type: DefenderServerEvent.TOOLS_DISCOVERY_COMPLETE,
            data: { appName, serverName, success: false }
        });
    }
}

/**
 * Handler for SSE connections (HTTP+SSE Transport from MCP spec version 2024-11-05)
 * 
 * Transport flow:
 * 1. Client makes a GET request to SSE endpoint with Accept: text/event-stream header
 * 2. Server responds with 200 OK and Content-Type: text/event-stream
 * 3. Server sends an 'endpoint' event with message URI as data
 * 4. Client sends tool requests via POST to the message endpoint
 * 5. Server responds directly to POST requests and sends events via SSE
 * 
 * MCP Defender acts as a proxy between the client and MCP server:
 * - It forwards the SSE connection to the target server
 * - It rewrites the 'endpoint' event to point to our proxy
 * - It verifies tool calls and responses for security policy compliance
 * 
 * @param req Client HTTP request
 * @param res Client HTTP response
 * @param state Global defender state
 */
export async function handleSseConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    state: DefenderState
) {
    // Get the server name from the URL
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const serverName = pathname.split('/')[2] || 'unknown';
    const appName = pathname.split('/')[1] || 'unknown';

    console.log(`New SSE connection for server: ${serverName}`);
    console.log(`Client headers:`, req.headers);
    console.log(`App name from URL: ${appName}`);

    // Check Accept header for SSE support - required by MCP spec
    const acceptHeader = req.headers.accept || '';
    if (!acceptHeader.includes('text/event-stream')) {
        console.error(`Client does not accept text/event-stream, got: ${acceptHeader}`);
        res.statusCode = 406; // Not Acceptable
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Client must accept text/event-stream' }));
        return;
    }

    // Get target server URL - first try from our app state
    let targetUrl = '';

    // Try to find the target URL using the app and server name
    const stateTargetUrl = findTargetUrlForServer(appName, serverName);
    if (stateTargetUrl) {
        console.log(`Found target URL from app state: ${stateTargetUrl}`);
        targetUrl = stateTargetUrl;
    }
    // If not found, try from environment variables or headers (fallback)
    else {
        console.log(`No target URL found in app state for ${appName}/${serverName}, trying fallback methods`);

        const envKey = MCPDefenderEnvVar.OriginalUrl;
        // Handle possible string array from headers
        const headerValue = req.headers[envKey];

        if (typeof headerValue === 'string') {
            targetUrl = headerValue;
        } else if (Array.isArray(headerValue) && headerValue.length > 0) {
            targetUrl = headerValue[0];
        } else if (process.env[envKey]) {
            targetUrl = process.env[envKey] || '';
        }
    }

    // Use a fallback URL for testing/development if we still don't have one
    if (!targetUrl) {
        // Provide a default for testing, but log a warning
        console.warn(`No target URL found for ${appName}/${serverName}, using default test URL`);
        targetUrl = 'http://localhost:3001/sse';
    } else {
        console.log(`Using target URL: ${targetUrl}`);
    }

    // Ensure the URL is properly formatted
    try {
        // Make sure it's a valid URL
        const testUrl = new URL(targetUrl);
        // Ensure it ends with /sse if it's supposed to be an SSE endpoint
        if (!targetUrl.endsWith('/sse')) {
            targetUrl = `${targetUrl.replace(/\/$/, '')}/sse`;
            console.log(`Adjusted target URL to ensure SSE endpoint: ${targetUrl}`);
        }
    } catch (error: any) {
        console.error(`Invalid target URL: ${targetUrl}`, error);
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: `Invalid target URL: ${targetUrl}`
        }));
        return;
    }

    console.log(`Proxying SSE connection to target URL: ${targetUrl}`);

    try {
        // Create a unique connection ID
        const connectionId = `${serverName}-${Date.now()}`;

        // Set up client response as an SSE connection - following MCP spec requirements
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
        });

        // Send the endpoint event with the message URI where clients should POST messages
        // Per the MCP spec, this must be the first event after connection
        const messageEndpoint = `/${appName}/${serverName}/message`;
        console.log(`Sending endpoint event with message endpoint: ${messageEndpoint}`);
        res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);

        // Create connection tracking object
        const connection: SSEConnection = {
            serverName,
            clientRes: res,
            clientReq: req,
            targetUrl,
            emitter: new EventEmitter(),
            proxyRequest: null,
            appName  // Store the app name with the connection
        };

        // Store connection
        state.sseConnections.set(connectionId, connection);

        // Setup client disconnect handler
        req.on('close', () => {
            console.log(`SSE connection ${connectionId} closed by client`);
            // Clean up any ongoing requests
            if (connection.proxyRequest && !connection.proxyRequest.destroyed) {
                connection.proxyRequest.destroy();
            }
            // Remove from connection tracking
            state.sseConnections.delete(connectionId);
        });

        // Parse the target URL
        const targetUrlObj = new URL(targetUrl);

        console.log(`Target URL parsed as: ${targetUrlObj.protocol}//${targetUrlObj.hostname}:${targetUrlObj.port || '(default)'}${targetUrlObj.pathname}`);

        // Determine which http module to use
        const httpModule = targetUrlObj.protocol === 'https:' ? https : http;

        // Setup options for the target request
        const options = {
            method: 'GET',
            hostname: targetUrlObj.hostname,
            port: targetUrlObj.port || (targetUrlObj.protocol === 'https:' ? 443 : 80),
            path: targetUrlObj.pathname + targetUrlObj.search,
            headers: {
                'Accept': 'text/event-stream',
                // Forward relevant headers
                'User-Agent': req.headers['user-agent'] || 'MCP-Defender-Proxy',
                'Origin': req.headers['origin'] || '',
            }
        };

        console.log(`Connecting to target server with options:`, options);

        // Make request to target server
        const proxyReq = httpModule.request(options, (proxyRes) => {
            console.log(`Connected to target server, status: ${proxyRes.statusCode}`);
            console.log(`Target server headers:`, proxyRes.headers);

            // Check if we got a valid response
            if (proxyRes.statusCode !== 200) {
                console.error(`Target server returned status ${proxyRes.statusCode}`);
                res.write(`event: error\ndata: ${JSON.stringify({
                    error: `Target server returned status ${proxyRes.statusCode}`
                })}\n\n`);
                return;
            }

            // Forward SSE events from target to client
            proxyRes.on('data', (chunk) => {
                // Get the data as string
                const dataStr = chunk.toString();

                // Check if this is an endpoint event that needs rewriting
                if (dataStr.includes('event: endpoint') && dataStr.includes('data: /message')) {
                    // We need to rewrite the endpoint to use our server prefix
                    console.log(`Rewriting endpoint URL in event: ${dataStr.substring(0, 100)}...`);

                    // Extract the session ID if present
                    let sessionId = '';
                    const sessionMatch = dataStr.match(/sessionId=([^&"\s]+)/);
                    if (sessionMatch && sessionMatch[1]) {
                        sessionId = `?sessionId=${sessionMatch[1]}`;
                    }

                    // Get the app name from the connection
                    const connectionAppName = connection.appName || appName;

                    // Create our endpoint URL with the app and server name prefix
                    const ourEndpoint = `/${connectionAppName}/${serverName}/message${sessionId}`;

                    // Format a new SSE event with our endpoint
                    const newEvent = `event: endpoint\ndata: ${ourEndpoint}\n\n`;

                    // Send the modified event
                    console.log(`Sending modified endpoint event: ${newEvent}`);
                    res.write(newEvent);
                } else if (dataStr.includes('event: message') && dataStr.includes('data:')) {
                    // This is a message event that might contain a tool response
                    // Per MCP spec, tool responses in SSE have the format:
                    // event: message
                    // data: {"jsonrpc":"2.0","id":"request-id","result":{...}}
                    //
                    // The result field follows the standard tool response format:
                    // - content: Array of content objects (text, image, etc.)
                    // - isError: Optional boolean indicating if the call resulted in an error
                    console.log(`Examining SSE message event: ${dataStr}`);

                    let shouldForward = true; // Control flag to determine if we forward the original event

                    try {
                        // Extract JSON data from the SSE event
                        // Format according to MCP Spec: event: message\ndata: {jsonData}\n\n
                        const dataMatch = dataStr.match(/data: ({.*})/s);
                        if (dataMatch && dataMatch[1]) {
                            const messageData = JSON.parse(dataMatch[1]);

                            // Check if this is a JSON-RPC response with an ID and result
                            // According to MCP spec, responses must have id and result fields
                            if (messageData.jsonrpc === '2.0' && messageData.id !== undefined && messageData.result) {
                                console.log(`Found JSON-RPC response in SSE event, id: ${messageData.id}`);

                                // Check if this is a response to our internal tools/list request
                                // We identify our internal requests with a specific prefix
                                if (typeof messageData.id === 'string' &&
                                    messageData.id.includes('mcp-defender-tools-list')) {

                                    console.log(`Intercepted internal tools/list response, not forwarding to client`);

                                    // Process the tools data but don't forward the event
                                    if (messageData.result.tools) {
                                        console.log(`Found tools/list response with ${messageData.result.tools.length} tools`);

                                        // Extract app name from environment or headers
                                        const appNameKey = 'MCP_DEFENDER_APP_NAME';
                                        const headerKey = 'mcp_defender_app_name';

                                        // Try to get app name from various sources in order of reliability
                                        let appName = 'unknown';

                                        // 1. Check our custom header from URL path parsing
                                        if (req.headers[headerKey]) {
                                            appName = req.headers[headerKey] as string;
                                        }
                                        // 2. Check environment variable headers
                                        else if (req.headers[appNameKey.toLowerCase()]) {
                                            appName = req.headers[appNameKey.toLowerCase()] as string;
                                        }
                                        // 3. Check process environment
                                        else if (process.env[appNameKey]) {
                                            appName = process.env[appNameKey] || 'unknown';
                                        }

                                        // Send tools update to main process
                                        sendMessageToParent({
                                            type: DefenderServerEvent.TOOLS_UPDATE,
                                            data: {
                                                tools: messageData.result.tools,
                                                appName,
                                                serverName
                                            }
                                        });
                                    }

                                    // Don't forward this internal response to the client
                                    shouldForward = false;
                                    return;
                                }

                                // We no longer try to passively extract tools from client-initiated requests
                                // This simplifies the code and ensures we rely on our active approach
                                // which gives us more reliable app name information

                                // Look up the associated tool call in the pending calls map
                                const connectionAppName = connection.appName || appName;
                                const callKey = getCallKey(messageData.id, serverName, connectionAppName);
                                const pendingCall = state.pendingToolCalls.get(callKey);

                                // If we found a matching tool call, verify the response
                                if (pendingCall) {
                                    const toolName = pendingCall.toolName;
                                    console.log(`Found matching tool request in pending calls map: ${toolName}, key: ${callKey}`);
                                    console.log(`Verifying SSE tool response for tool: ${toolName}, id: ${messageData.id}`);

                                    // Don't forward yet, we'll handle forwarding after verification
                                    shouldForward = false;

                                    // Server info for scan result
                                    const serverInfo = {
                                        serverName: serverName,
                                        serverVersion: '',
                                        appName: connection?.appName || 'unknown'
                                    };

                                    // Verify the response
                                    verifyToolResponse(toolName, messageData.result, serverInfo)
                                        .then(verificationResult => {
                                            console.log(`SSE response verification result:`, JSON.stringify(verificationResult, null, 2));

                                            // If not allowed, we need to block the response
                                            if (!verificationResult.allowed) {
                                                console.warn(`SSE response rejected: Tool response not allowed`);

                                                // Send an error event instead of the actual response
                                                const errorEvent = `event: message\ndata: ${JSON.stringify({
                                                    jsonrpc: '2.0',
                                                    id: messageData.id,
                                                    error: {
                                                        code: -32000,
                                                        message: `Tool response blocked: Security policy violation`,
                                                    }
                                                })}\n\n`;

                                                // Send the error response to the client
                                                res.write(errorEvent);

                                                // Remove from pending calls
                                                state.pendingToolCalls.delete(callKey);

                                                return; // Don't forward the original response
                                            }

                                            // Remove from pending calls
                                            state.pendingToolCalls.delete(callKey);

                                            // Forward the verified response
                                            res.write(dataStr);
                                        })
                                        .catch(error => {
                                            console.error('Error verifying SSE response:', error);
                                            // On error, we'll still forward the response for better UX
                                            res.write(dataStr);

                                            // Remove from pending calls map on error too
                                            state.pendingToolCalls.delete(callKey);
                                        });
                                } else {
                                    // No matching tool call found, forward without verification
                                    console.warn(`No matching tool request found for SSE response, id: ${messageData.id}`);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error processing SSE message event:', error);
                        shouldForward = true; // Make sure we forward on error
                    }

                    // Forward the event if we didn't handle it with verification
                    if (shouldForward) {
                        res.write(dataStr);
                    }
                } else {
                    // Forward other events directly to the client
                    res.write(dataStr);

                    // Log informational message about the data being forwarded
                    if (dataStr.includes('event:')) {
                        console.log(`Forwarding event from target server: ${dataStr}`);
                    }
                }
            });

            // Handle end of response
            proxyRes.on('end', () => {
                console.log('Target server closed the connection');
                // We'll leave the client connection open as the client can still send messages
                res.write(`event: error\ndata: ${JSON.stringify({
                    error: 'Target server closed the connection'
                })}\n\n`);
            });
        });

        // Save the proxy request for cleanup
        connection.proxyRequest = proxyReq;

        // Handle errors on target connection
        proxyReq.on('error', (error) => {
            console.error(`Error connecting to target server: ${error.message}`);
            // Don't close the client connection, just report the error
            res.write(`event: error\ndata: ${JSON.stringify({
                error: `Error connecting to target server: ${error.message}`
            })}\n\n`);
        });

        // End the request (GET has no body)
        proxyReq.end();

        // Query tools from the target server to populate tool registry
        // We do this asynchronously after connection setup to not delay the initial response
        setTimeout(() => {
            // Make a single request to get tools, with timeout and error handling
            queryServerTools(targetUrl, serverName, appName)
                .catch(error => {
                    console.error(`Failed to query tools from ${serverName} at ${targetUrl}: ${error.message}`);
                    // We don't retry on failure - just log the error
                });
        }, 2000); // One-time delay after connection is established

    } catch (error: any) {
        console.error(`Error setting up SSE connection: ${error.message}`);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to set up SSE connection' }));
        } else {
            // If headers already sent, send an error event
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        }
    }
}

/**
 * Handle POST requests to the message endpoint (HTTP+SSE Transport, 2024-11-05 spec)
 * 
 * This function implements the message endpoint part of the MCP HTTP+SSE transport.
 * 
 * According to the MCP spec:
 * - Clients send JSON-RPC requests to the message endpoint
 * - The endpoint is provided in the initial 'endpoint' event from the SSE connection
 * - Servers respond directly to the POST request with JSON-RPC responses
 * - Servers may also send notifications and streaming responses via the SSE connection
 * 
 * @param req Client HTTP request
 * @param res Client HTTP response
 * @param serverName Name of the target MCP server
 * @param state Global defender state
 */
export async function handleMessageEndpoint(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serverName: string,
    state: DefenderState
) {
    // Extract app name from request headers if available
    const appNameKey = 'mcp_defender_app_name';
    const appName = req.headers[appNameKey] as string || 'unknown';

    console.log(`Handling message for app: ${appName}, server: ${serverName}, method: ${req.method}`);

    // Get the request body
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
        try {
            // Parse the message
            const message = JSON.parse(body);
            console.log(`Received message for server ${serverName}:`,
                message.method ?
                    `method: ${message.method}, id: ${message.id}` :
                    JSON.stringify(message).substring(0, 100)
            );

            // Find matching SSE connection for this server
            // Look for connection with matching app name and server name
            let connection = null;
            for (const [id, conn] of state.sseConnections.entries()) {
                // Match by both server name and app name if possible
                if (conn.serverName === serverName &&
                    (!appName || appName === 'unknown' || conn.appName === appName)) {
                    connection = conn;
                    console.log(`Found matching SSE connection for ${appName}/${serverName}`);
                    break;
                }
            }

            // Fallback: look for any connection with matching server name if app name didn't match
            if (!connection) {
                for (const [id, conn] of state.sseConnections.entries()) {
                    if (conn.serverName === serverName) {
                        connection = conn;
                        console.log(`Found connection with matching server name (no app name match): ${serverName}`);
                        break;
                    }
                }
            }

            if (!connection) {
                console.warn(`No active SSE connection found for server ${serverName}`);
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'SSE connection not found' }));
                return;
            }

            // Target URL must be available
            const targetUrl = connection.targetUrl;
            if (!targetUrl) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Target server URL not configured' }));
                return;
            }

            // Verify the request if it's a tool call (tools/call method as per MCP spec)
            if (message.method === 'tools/call' && message.params && message.params.name) {
                try {
                    const toolName = message.params.name;
                    const toolArgs = message.params.arguments || {};

                    // Store the tool call in the global pending calls map
                    const callKey = trackToolCall(
                        state,
                        toolName,
                        message.id,
                        serverName,
                        appName,
                        toolArgs
                    );

                    // Log the tracking information
                    console.log(`Tracking tool call ${toolName} with id ${message.id} as ${callKey}`);

                    // Server info for scan result
                    const serverInfo = {
                        serverName: serverName,
                        serverVersion: '',
                        appName: connection?.appName || 'unknown'
                    };

                    // Verify the tool call
                    const verificationResult = await verifyToolCall(
                        toolName,
                        toolArgs,
                        serverInfo,
                        '' // SSE transport doesn't have user intent - only STDIO proxy adds this
                    );

                    if (!verificationResult.allowed) {
                        console.warn(`Request rejected: Tool call not allowed`);
                        // Send rejection response - per JSON-RPC spec, we return an error object
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: message.id,
                            error: {
                                code: -32000,
                                message: `Tool call not allowed: Security policy violation`,
                            }
                        }));

                        // Remove from pending calls if rejected
                        state.pendingToolCalls.delete(callKey);

                        return;
                    }

                    console.log('continue...')

                    // Periodically clean up stale pending tool calls
                    cleanupStaleCalls(state);
                } catch (error) {
                    console.error('Error during request verification:', error);
                }
            }

            // Construct target message endpoint - converting /sse to /message per MCP spec
            const messageEndpoint = targetUrl.replace('/sse', '/message');
            console.log(`Forwarding message to target server at ${messageEndpoint}`);

            try {
                // Forward the request to the target server using fetch API
                console.log(`Forwarding message to target server at ${messageEndpoint} with body:`, body);
                console.log('body:', JSON.stringify(body, null, 2));
                const response = await fetch(messageEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        // Forward original headers that may be relevant
                        'User-Agent': req.headers['user-agent'] || 'MCP-Defender-Proxy',
                        'Origin': req.headers['origin'] || ''
                    },
                    body
                });

                // Check for HTTP errors
                if (!response.ok) {
                    console.error(`Target server returned HTTP error: ${response.status}`);
                    throw new Error(`Target server returned status ${response.status}`);
                }

                console.log(`response from target server:`, JSON.stringify(response, null, 2));

                // Check if the response has a body to parse
                const contentType = response.headers.get('content-type');
                // Per spec, 202 Accepted means no response body (used for notifications)
                if (response.status === 202 || !contentType || !contentType.includes('application/json')) {
                    // This is a 202 Accepted response (no body) or non-JSON response
                    console.log(`Received non-JSON response (${response.status}) from target server`);

                    // Send appropriate response to client
                    res.statusCode = response.status;
                    for (const [key, value] of response.headers.entries()) {
                        res.setHeader(key, value);
                    }
                    res.end();
                    return;
                }

                // Get the response data (only for JSON responses)
                const responseData = await response.json();
                console.log(`Received JSON response from target server:`, responseData);

                // Verify the response if it's a tool call response
                const callKey = getCallKey(message.id, serverName, appName);
                const pendingCall = state.pendingToolCalls.get(callKey);

                if (pendingCall && responseData.result) {
                    try {
                        const toolName = pendingCall.toolName;

                        // Server info for scan result
                        const serverInfo = {
                            serverName: serverName,
                            serverVersion: '',
                            appName: connection?.appName || 'unknown'
                        };

                        // Verify the tool response
                        const verificationResult = await verifyToolResponse(
                            toolName,
                            responseData.result,
                            serverInfo
                        );

                        if (!verificationResult.allowed) {
                            console.warn(`Response rejected: Tool response not allowed`);
                            // Send rejection response instead
                            res.statusCode = 200;
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                id: message.id,
                                error: {
                                    code: -32000,
                                    message: `Tool response not allowed: Security policy violation`,
                                }
                            }));

                            // Remove from pending calls
                            state.pendingToolCalls.delete(callKey);

                            return;
                        }

                        // Remove from pending calls
                        state.pendingToolCalls.delete(callKey);
                    } catch (error) {
                        console.error('Error during response verification:', error);
                    }
                }

                // Return the response to the client
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(responseData));
            } catch (error) {
                console.error('Error forwarding message to target server:', error);
                res.statusCode = 502;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32000,
                        message: `Error communicating with target server: ${error.message}`,
                    }
                }));
            }
        } catch (error) {
            console.error('Error processing message:', error);
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid message format' }));
        }
    });
} 