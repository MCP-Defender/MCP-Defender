/**
 * MCP Defender Controller
 * 
 * This module serves as the core of the MCP Defender proxy, intercepting and verifying
 * MCP communications between clients and servers.
 * 
 * Acts as the entry point for the defender proxy, delegating to transport-specific handlers.
 */

import http from 'node:http';
import { URL } from 'node:url';
import { DefenderServerEvent, DefenderServiceEvent, DefenderStatus } from '../services/defender/types';
import { Signature } from '../services/signatures/types';
import {
  verifyToolCall,
  verifyToolResponse,
  initVerification,
} from './verification-utils.js';
import { DefenderState, SSEConnection, PendingToolCall, sendMessageToParent, ScanSettings } from './common/types.js';
import { ProtectedServerConfig, MCPApplication, MCPDefenderEnvVar } from '../services/configurations/types.js';

// Import transport handlers
import { handleSseConnection, handleMessageEndpoint } from './transports/http-sse-transport.js';
// import { handleStreamableHttpConnection, handleStreamableHttpMessage } from './transports/streamable-http-transport.js';
import { handleVerifyRequest, handleVerifyResponse, handleRegisterTools } from './transports/stdio-transport.js';
import { ScanMode } from '../services/settings/types';

// Server configuration
// TODO: get this from settings later
const SERVER_CONFIG = {
  port: 28173,
  host: '127.0.0.1'
};

/**
 * Global server state
 * Maintains connections, signatures, and scan results
 */
const state: DefenderState = {
  server: null as http.Server | null,
  signatures: [] as Signature[],
  sseConnections: new Map<string, SSEConnection>(), // Active SSE connections
  pendingToolCalls: new Map<string, PendingToolCall>(), // Pending tool calls waiting for responses
  running: false,                 // Server running state
  protectedServers: new Map<string, ProtectedServerConfig[]>(), // Protected server configurations by app name
  settings: {
    scanMode: ScanMode.REQUEST_RESPONSE,
    loginToken: null,
    llm: {
      model: "",
      apiKey: null,
      provider: ""
    },
    disabledSignatures: new Set<string>(),
    appVersion: "",
    appPlatform: ""
  }
};

/**
 * Starts the proxy server
 * IMPORTANT: This should only be called explicitly, never automatically on module load
 */
async function startServer() {
  if (state.running) {
    console.log('Server already running');
    return;
  }

  console.log(`Starting MCP Defender proxy server on ${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);

  // Create HTTP server
  const server = http.createServer(handleRequest);

  // Start the server
  server.listen(SERVER_CONFIG.port, SERVER_CONFIG.host, () => {
    console.log(`MCP Defender server running at http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
    state.running = true;

    // Notify parent process
    sendMessageToParent({
      type: DefenderServerEvent.STATUS,
      data: {
        status: DefenderStatus.running,
        error: null
      }
    });
  });

  // Store server reference
  state.server = server;

  // Handle errors
  server.on('error', (error) => {
    console.error('Server error:', error);
    sendMessageToParent({
      type: DefenderServerEvent.STATUS,
      data: {
        status: DefenderStatus.error,
        error: error.message
      }
    });
  });
}

/**
 * Stops the server gracefully
 */
function stopServer() {
  if (state.server) {
    state.server.close(() => {
      console.log('Server stopped');
      state.running = false;
      sendMessageToParent({
        type: DefenderServerEvent.STATUS,
        data: {
          status: DefenderStatus.stopped,
          error: null
        }
      });
    });
  }
}

/**
 * Main request handler for the HTTP server
 * Routes requests to appropriate handlers based on URL pattern
 * 
 * Supported endpoints:
 * 
 * API endpoints:
 * - /verify/request         - API for CLI helper to verify tool requests (POST)
 * - /verify/response        - API for CLI helper to verify tool responses (POST)
 * - /register-tools         - API for CLI helper to register available tools (POST)
 * - /scan-results           - Retrieve scan results (GET)
 * 
 * HTTP+SSE transport (2024-11-05 spec):
 * - /{appName}/{serverName}/sse       - SSE connection endpoint (GET)
 * - /{appName}/{serverName}/message   - Message endpoint for client requests (POST)
 * - /message                - Root message fallback (POST)
 * 
 * Streamable HTTP transport (2025-03-26 spec):
 * - /{appName}/{serverName}           - Single MCP endpoint for both GET (SSE) and POST (messages)
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`Handling request: ${req.method} ${pathname}`);

  try {
    // Handle API requests from STDIO CLI helper first to prevent them from being 
    // mistaken as streamable HTTP endpoints
    if (pathname.startsWith('/verify/')) {
      console.log('Received verification request:', pathname);
      if (req.method !== 'POST') {
        res.statusCode = 405; // Method Not Allowed
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Allow', 'POST');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Parse JSON body
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          // Parse JSON body
          const data = JSON.parse(body);
          console.debug('Received verification request:', data);

          // Handle verification requests
          if (pathname.startsWith('/verify/request')) {
            await handleVerifyRequest(data, res, state);
          } else if (pathname.startsWith('/verify/response')) {
            await handleVerifyResponse(data, res, state);
          } else {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        } catch (error) {
          console.error('Error parsing request body:', error);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Handle tools registration from CLI helper
    if (pathname === '/register-tools' && req.method === 'POST') {
      console.log('Received tool registration request from CLI');

      // Parse JSON body
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          // Parse JSON body
          const data = JSON.parse(body);
          console.debug('Received tool registration data:', data);

          // Extract necessary information
          const { tools, serverInfo, appName, serverName } = data;

          // Validate required fields
          if (!tools || !appName || !serverName) {
            console.error('Missing required fields in tool registration data');
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing required fields' }));
            return;
          }

          // Import and call the handler from stdio-transport
          await handleRegisterTools(data, res, state);
        } catch (error) {
          console.error('Error processing tool registration:', error);
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    // Handle SSE endpoints - this would be the GET connection for the old spec
    if (pathname.endsWith('/sse')) {
      // For SSE endpoints, we only support GET
      if (req.method !== 'GET') {
        res.statusCode = 405; // Method Not Allowed
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Allow', 'GET');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Parse the URL path to extract app name and server name
      // Expected format: /{appName}/{serverName}/sse
      const pathParts = pathname.split('/').filter(part => part.length > 0);

      if (pathParts.length >= 2) {
        // Extract app name and server name from path
        const appName = pathParts[0];
        const serverName = pathParts[1];

        console.log(`SSE connection with app name: ${appName}, server name: ${serverName}`);

        // Add app name to request headers for downstream handlers
        req.headers['mcp_defender_app_name'] = appName;

        handleSseConnection(req, res, state);
        return;
      }

      // Fall back to old pattern if we can't parse the path
      console.log(`Warning: Using legacy SSE path pattern without app name: ${pathname}`);
      handleSseConnection(req, res, state);
      return;
    }

    // Handle message endpoints - this is the POST endpoint for clients using the old spec
    if (pathname.includes('/message')) {
      // Extract server name from the path
      let serverName;
      let appName;

      // Parse the URL path
      // Expected formats:
      // /{appName}/{serverName}/message - new format with app name
      // /{serverName}/message - legacy format
      // /message - root endpoint format
      const pathParts = pathname.split('/').filter(part => part.length > 0);

      if (pathParts.length >= 2 && pathParts[pathParts.length - 1] === 'message') {
        if (pathParts.length >= 3) {
          // Format: /{appName}/{serverName}/message
          appName = pathParts[0];
          serverName = pathParts[1];
          console.log(`Message endpoint with app name: ${appName}, server name: ${serverName}`);

          // Add app name to request headers for downstream handlers
          req.headers['mcp_defender_app_name'] = appName;
        } else {
          // Format: /{serverName}/message
          serverName = pathParts[0];
          console.log(`Legacy message endpoint format without app name: ${pathname}`);
        }
      } else if (pathname === '/message') {
        // Special case for root /message - try to extract serverName from query param or use 'default'
        // Parse query string for session ID
        const sessionId = url.searchParams.get('sessionId');
        console.log(`Request to root /message endpoint with sessionId: ${sessionId}`);

        // Try to find an existing SSE connection with this session ID if provided
        if (sessionId) {
          // Look for an active SSE connection with this session ID
          // We could enhance this by storing the session ID in the SSE connection object
          console.log('Looking for active SSE connection with matching session ID or related information');

          // For now, we'll use a default value if we can't determine it from the URL
          serverName = 'everything';
          appName = 'Cursor'; // Default app name

          // Try to find all SSE connections and see if we can find a matching one
          if (state.sseConnections.size > 0) {
            console.log(`Examining ${state.sseConnections.size} active connections for session matching`);
            for (const [id, conn] of state.sseConnections.entries()) {
              // If we find a match, use that connection's app and server name
              console.log(`Connection: server=${conn.serverName}, app=${conn.appName || 'unknown'}`);
              serverName = conn.serverName;
              appName = conn.appName || appName;
              console.log(`Found active connection, using server=${serverName}, app=${appName}`);
              break; // Use the first connection we find for now
            }
          }
        }

        // Store app name in headers for downstream handlers
        if (appName) {
          req.headers['mcp_defender_app_name'] = appName;
        }

        console.log(`Resolved root /message request to app: ${appName}, server: ${serverName}`);
      }

      // For message endpoints, we only support POST
      if (req.method !== 'POST') {
        res.statusCode = 405; // Method Not Allowed
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Allow', 'POST');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      handleMessageEndpoint(req, res, serverName, state);
      return;
    }

    // Handle Streamable HTTP transport (2025-03-26)
    // This handles both GET and POST to the same endpoint (not ending with /sse or /message)
    /*
    if (pathname.split('/').length >= 2 && pathname !== '/') {
      const pathParts = pathname.split('/').filter(part => part.length > 0);

      if (pathParts.length >= 2) {
        // New format: /{appName}/{serverName}
        const appName = pathParts[0];
        const serverName = pathParts[1];

        console.log(`Streamable HTTP request with app name: ${appName}, server name: ${serverName}`);

        // Add app name to request headers for downstream handlers
        req.headers['mcp_defender_app_name'] = appName;

        if (req.method === 'GET') {
          // Handle GET for SSE stream connection
          handleStreamableHttpConnection(req, res, serverName, state);
          return;
        } else if (req.method === 'POST') {
          // Handle POST for JSON-RPC messages
          handleStreamableHttpMessage(req, res, serverName, state);
          return;
        } else {
          // Only GET and POST are allowed for this endpoint
          res.statusCode = 405; // Method Not Allowed
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Allow', 'GET, POST');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
      } else {
        // Legacy format: /{serverName}
        const serverName = pathParts[0];
        console.log(`Legacy Streamable HTTP request for server: ${serverName}`);

        if (req.method === 'GET') {
          handleStreamableHttpConnection(req, res, serverName, state);
          return;
        } else if (req.method === 'POST') {
          handleStreamableHttpMessage(req, res, serverName, state);
          return;
        } else {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Allow', 'GET, POST');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
      }
    }
    */

    // Default 404 handler
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('Request handler error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Update the protected servers state with application data from the main process
 * @param applications List of applications and their server configurations
 */
function updateProtectedServers(applications: MCPApplication[]) {
  // Clear existing state and rebuild
  state.protectedServers.clear();

  console.log(`Updating protected servers data with ${applications.length} applications`);

  // Process each application and add its servers to the map
  for (const app of applications) {
    // Store the server configurations for this app
    state.protectedServers.set(app.name, app.servers);

    console.log(`Added ${app.servers.length} servers for application "${app.name}"`);
  }
}

/**
 * Find a protected server configuration by app name and server name
 * @param appName The application name
 * @param serverName The server name within the application
 * @returns The server configuration if found, undefined otherwise
 */
function findProtectedServer(appName: string, serverName: string): ProtectedServerConfig | undefined {
  const appServers = state.protectedServers.get(appName);
  if (!appServers) {
    console.log(`No servers found for app: ${appName}`);
    return undefined;
  }

  const server = appServers.find(s => s.serverName === serverName);
  if (!server) {
    console.log(`Server "${serverName}" not found in app: ${appName}`);
    return undefined;
  }

  return server;
}

/**
 * Find the target URL for a server based on app name and server name
 * @param appName The application name
 * @param serverName The server name within the application
 * @returns The target URL if found, undefined otherwise
 */
function findTargetUrlForServer(appName: string, serverName: string): string | undefined {
  const server = findProtectedServer(appName, serverName);
  if (!server) {
    return undefined;
  }

  // Get the original URL from environment
  const originalUrl = server.config.env?.[MCPDefenderEnvVar.OriginalUrl];
  if (!originalUrl) {
    console.log(`Original URL not found for server ${serverName} in app ${appName}`);
    return undefined;
  }

  return originalUrl;
}

// Listen for messages from main process
process.parentPort.on('message', (message: any) => {
  console.log('Received message from main process:', JSON.stringify(message, null, 2));

  // Normalize message structure
  let messageType: string;
  let messageData: any;

  // Handle different message formats
  if (message.type) {
    // Format: { type: "...", data: {...} }
    messageType = message.type;
    messageData = message.data;
  } else if (message.data && message.data.type) {
    // Format: { data: { type: "...", data: {...} } }
    messageType = message.data.type;
    messageData = message.data.data;
  } else {
    console.error('Invalid message format received:', message);
    return;
  }

  console.log(`Normalized message: type=${messageType}`);

  // Handle different message types
  switch (messageType) {
    case DefenderServiceEvent.START_SERVER:
      startServer();
      break;

    case DefenderServiceEvent.UPDATE_SIGNATURES:
      const signatures: Signature[] = messageData?.signatures || [];
      console.log(`Received signatures update with ${signatures.length} signatures`);

      // Update signatures in state
      state.signatures = signatures;
      break;

    case DefenderServiceEvent.UPDATE_SETTINGS:
      console.log(`Received settings update`);

      // Update the OpenAI API key, model, and scan mode
      try {
        const settings = messageData;

        // Update state with new settings
        if (settings.scanMode) {
          console.log(`Updating scan mode to: ${settings.scanMode}`);
          // Update scan settings in state
          state.settings.scanMode = settings.scanMode;
        }

        // Update LLM settings
        if (settings.llm) {
          console.log(`Updating LLM settings`);
          // Update state to use the new llm format
          state.settings.llm = {
            model: settings.llm.model || "",
            apiKey: settings.llm.apiKey || null,
            provider: settings.llm.provider || ""
          };

          // Initialize verification with new key if provided
          if (settings.llm.apiKey && settings.llm.provider === 'OpenAI') {
            console.log(`Initializing verification with ${settings.llm.provider} model: ${settings.llm.model}`);
            initVerification(settings.llm.apiKey);
          }
        }

        // Set the login token if available
        if (settings.user && settings.user.loginToken) {
          console.log(`Setting login token for verification`);
          state.settings.loginToken = settings.user.loginToken;
        } else if (settings.user) {
          // Clear login token if not provided
          state.settings.loginToken = null;
        }

        // Update disabled signatures if provided
        if (settings.disabledSignatures) {
          console.log(`Updating disabled signatures list`);
          // Convert from Set to Array for JSON serialization and back to Set
          const disabledIds = Array.isArray(settings.disabledSignatures)
            ? new Set(settings.disabledSignatures)
            : settings.disabledSignatures;

          state.settings.disabledSignatures = disabledIds;
        }

      } catch (err) {
        console.error('Error updating settings:', err);
      }
      break;

    case DefenderServiceEvent.UPDATE_CONFIGURATIONS:
      console.log('Received protected servers update');

      try {
        const applications = messageData?.applications;
        if (applications && Array.isArray(applications)) {
          // Update protected servers state
          updateProtectedServers(applications);
          console.log(`Updated protected servers data with ${applications.length} applications`);
        } else {
          console.error('Invalid protected servers data:', messageData);
        }
      } catch (err) {
        console.error('Error updating protected servers:', err);
      }
      break;

    case DefenderServiceEvent.UPDATE_APP_METADATA:
      console.log('Received app metadata update');

      try {
        const { appVersion, appPlatform } = messageData;
        if (appVersion && appPlatform) {
          state.settings.appVersion = appVersion;
          state.settings.appPlatform = appPlatform;
          console.log(`Updated app metadata: version=${appVersion}, platform=${appPlatform}`);
        } else {
          console.error('Invalid app metadata:', messageData);
        }
      } catch (err) {
        console.error('Error updating app metadata:', err);
      }
      break;

    case 'defender-server:discover-tools':
      console.log('Received request to discover tools');

      // Extract data from the message
      const { appName, serverName, targetUrl } = messageData;

      console.log(`Starting tool discovery for ${appName}/${serverName} using target URL: ${targetUrl}`);

      // Dynamically import and call queryServerTools
      import('./transports/http-sse-transport.js')
        .then(({ queryServerTools }) => {
          console.log(`Successfully imported queryServerTools, calling it now...`);
          // Call the function to query tools
          queryServerTools(targetUrl, serverName, appName)
            .then(() => {
              console.log(`Tool discovery request completed for ${appName}/${serverName}`);
            })
            .catch(error => {
              console.error('Error discovering tools:', error);
            });
        })
        .catch(error => {
          console.error('Error importing queryServerTools:', error);
        });
      break;

    default:
      console.log('Unhandled message type:', messageType);
      break;
  }
});

// Keep the process alive
process.on('SIGINT', () => {
  console.log('SIGINT received. Exiting process gracefully.');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Don't exit, keep the process running
});

// Export functions for testing
export {
  startServer,
  stopServer,
  state,
  findTargetUrlForServer,
  findProtectedServer,
  updateProtectedServers
};

