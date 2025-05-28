/**
 * Test clients for MCP Defender
 * 
 * Provides client implementations for each MCP transport type
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'path';

export interface ClientOptions {
    serverName: string;
    defaultTimeout?: number;
}

/**
 * Create an MCP client using STDIO transport
 * 
 * This uses npx to run the Everything MCP server via STDIO
 * Our CLI helper automatically intercepts communications
 * 
 * @param options Client configuration options
 * @returns Initialized MCP client
 */
export async function createStdioClient(options: ClientOptions) {
    // Create a client
    const client = new Client({
        name: 'mcp-defender-test-client',
        version: '1.0.0'
    });

    // Create the transport
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
            path.resolve('./dist/cli.js'),
            path.resolve('./node_modules/.bin/mcp-server-everything')
        ],
        env: {
            // Any environment variables needed by the server
            PATH: process.env.PATH
        }
    });

    // Connect and initialize
    await client.connect(transport);

    return client;
}

/**
 * Create an MCP client using HTTP+SSE transport (2024-11-05 spec)
 * 
 * This connects to our MCP Defender proxy, which forwards to the target server
 * 
 * @param options Client configuration options
 * @returns Initialized MCP client
 */
export async function createSSEClient(options: ClientOptions & { port: number }) {
    console.log(`Creating SSE client with a single connection to: http://localhost:${options.port}/${options.serverName}/sse`);
    const client = new Client({
        name: `mcp-defender-test-client-${Date.now()}`, // Unique client name
        version: '1.0.0'
    });

    // Add error handler to catch connection errors
    const transport = new SSEClientTransport(
        new URL(`http://localhost:${options.port}/${options.serverName}/sse`)
    );

    try {
        await client.connect(transport);
        console.log("SSE client connected");
        return client;
    } catch (err) {
        console.error("Failed to connect SSE client:", err);
        throw err;
    }
}

/**
 * Create an MCP client using Streamable HTTP transport (2025-03-26 spec)
 * 
 * This connects to our MCP Defender proxy, which forwards to the target server
 * 
 * @param options Client configuration options
 * @returns Initialized MCP client
 */
export async function createStreamableClient(options: ClientOptions & { port: number }) {
    // Create a client
    const client = new Client({
        name: 'mcp-defender-test-client',
        version: '1.0.0'
    });

    // Create the transport
    const transport = new StreamableHTTPClientTransport(
        new URL(`http://localhost:${options.port}/${options.serverName}`)
    );

    // Connect and initialize
    await client.connect(transport);

    return client;
} 