/**
 * Tool Call Tracking Utilities
 * 
 * This file contains utilities for tracking tool calls and their responses
 * in the MCP Defender HTTP+SSE transport implementation.
 */

import { DefenderState, PendingToolCall } from '../common/types.js';

// Constants
export const TOOL_CALL_MAX_AGE = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a unique tool call ID for tracking
 * Combines the app name, server name, and request ID to ensure uniqueness
 * 
 * @param requestId The JSON-RPC request ID
 * @param serverName The MCP server name
 * @param appName The application name
 * @returns A unique string key to track the tool call
 */
export function getCallKey(requestId: string | number, serverName: string, appName: string = 'unknown'): string {
    return `${appName}:${serverName}:${requestId}`;
}

/**
 * Track a new tool call in the pending calls map
 * 
 * @param state Global defender state
 * @param toolName Name of the tool being called
 * @param requestId Request ID from the JSON-RPC call
 * @param serverName MCP server name
 * @param appName Application name
 * @param args Tool arguments
 * @returns The generated call key
 */
export function trackToolCall(
    state: DefenderState,
    toolName: string,
    requestId: string | number,
    serverName: string,
    appName: string,
    args: any
): string {
    // Generate a unique key for this call
    const callKey = getCallKey(requestId, serverName, appName);

    // Create tracking object
    const pendingCall: PendingToolCall = {
        toolName,
        requestId,
        serverName,
        appName,
        timestamp: Date.now(),
        args
    };

    // Store in the global pending calls map
    state.pendingToolCalls.set(callKey, pendingCall);
    console.log(`Tracking tool call ${toolName} with id ${requestId} as ${callKey}`);

    return callKey;
}

/**
 * Clean up stale pending tool calls that never received responses
 * 
 * @param state Global defender state
 * @returns Number of calls cleaned up
 */
export function cleanupStaleCalls(state: DefenderState): number {
    const now = Date.now();
    let count = 0;

    // Find and remove stale calls
    state.pendingToolCalls.forEach((call, id) => {
        if (now - call.timestamp > TOOL_CALL_MAX_AGE) {
            state.pendingToolCalls.delete(id);
            count++;
        }
    });

    if (count > 0) {
        console.log(`Cleaned up ${count} stale tool calls`);
    }

    return count;
} 