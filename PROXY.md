## MCP Transport Support

MCP Defender supports multiple transport protocols defined in the MCP specification:

### 1. HTTP+SSE Transport (2024-11-05 Spec)

The original transport protocol with separate endpoints:
- SSE connection endpoint: `/{serverName}/sse` (GET)
- Message endpoint: `/{serverName}/message` (POST)

Client Configuration:
```json
{
  "mcpServers": {
    "everything": {
      "url": "http://localhost:8081/everything/sse",
      "env": {}
    }
  }
}
```

### 2. Streamable HTTP Transport (2025-03-26 Spec)

The newer transport protocol with a single endpoint for both SSE streams and messages:
- Combined endpoint: `/{serverName}` (GET for SSE, POST for messages)

Client Configuration:
```json
{
  "mcpServers": {
    "everything": {
      "url": "http://localhost:8081/everything",
      "env": {}
    }
  }
}
```

### 3. STDIO Transport

For command-line applications using standard input/output:
- Uses the CLI helper as a proxy

Client Configuration:
```json
{
  "mcpServers": {
    "everything": {
      "command": "node",
      "args": [
        "cli",
        "npx",
        "@modelcontextprotocol/server-everything"
      ]
    }
  }
}
```

## API Endpoints

The Defender Server (`defender-controller.ts`) exposes the following HTTP endpoints:

### HTTP+SSE Transport Endpoints (2024-11-05 Spec)

- `/{serverName}/sse` (GET) - SSE connection endpoint 
  - Proxies SSE connections between client and MCP server
  - Rewrites the endpoint event to point to our proxy
  - Follows the MCP HTTP+SSE transport specification

- `/{serverName}/message` (POST) - Message endpoint for client requests
  - Accepts JSON-RPC messages from clients
  - Verifies tool calls before forwarding
  - Verifies responses before returning to client

- `/message` (POST) - Root message fallback
  - Special case handling for clients that don't use the server name prefix
  - Used for backward compatibility

### Streamable HTTP Transport Endpoints (2025-03-26 Spec)

- `/{serverName}` (GET/POST) - Combined endpoint for both SSE and messages
  - GET requests establish SSE connections
  - POST requests send tool calls and receive responses
  - Supports streaming responses from server to client
  - Maintains backward compatibility with old spec endpoints

### CLI Helper API Endpoints

- `/verify/request` (POST) - API for CLI helper to verify tool requests
  - Used by the CLI helper for STDIO transport
  - Takes JSON-RPC tool call requests and returns a security decision

- `/verify/response` (POST) - API for CLI helper to verify tool responses
  - Used by the CLI helper for STDIO transport
  - Takes tool call responses and returns a security decision

### Utility Endpoints

- `/scan-results` (GET) - Retrieve scan results
  - Returns a list of all verification results
  - Used by the UI to display threat information

## Verification Flow

### HTTP+SSE Verification Flow (2024-11-05 Spec)
1. Client connects to MCP Defender at `/{serverName}/sse`
2. MCP Defender connects to the target MCP server
3. Client sends tool call requests to `/{serverName}/message`
4. MCP Defender verifies requests before forwarding to target
5. MCP Defender verifies responses before returning to client

### Streamable HTTP Verification Flow (2025-03-26 Spec)
1. Client connects to MCP Defender at `/{serverName}` (GET)
2. MCP Defender establishes an SSE connection to the target MCP server
3. Client sends tool call requests to `/{serverName}` (POST)
4. MCP Defender verifies requests before forwarding to target
5. MCP Defender performs real-time streaming verification on responses
6. Verified responses are streamed back to the client

### STDIO Verification Flow
1. Client's MCP config uses CLI helper as a proxy
2. CLI helper intercepts STDIO communications
3. CLI helper sends verification requests to MCP Defender
4. MCP Defender applies policy rules and returns a decision
5. CLI helper forwards or blocks based on verification results
