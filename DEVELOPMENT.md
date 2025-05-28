## Architecture

MCP Defender consists of three main components:

1. **Electron Application** - User interface for managing the defender
2. **Defender Server** - Proxy server that intercepts MCP communications
3. **CLI Helper** - Utility to proxy STDIO communications

### Service Architecture

MCP Defender uses a service-based architecture to organize its functionality:

- **Base Service** - Common foundation that provides logging, lifecycle management, and event handling
- **Settings Service** - Manages application settings and persistence
- **Future Services** - Defender, Signatures, etc.

Each service follows a consistent pattern:
- `service.ts` - Core implementation
- `handlers.ts` - IPC handler registration
- `types.ts` - TypeScript type definitions

Services integrate with the UI through a consistent API pattern in the preload script,
with interface definitions in `global.d.ts` following the naming convention `[serviceName]API`.

### Logging

The application includes a built-in logging system that:
- Automatically prefixes logs with the service name
- Supports different log levels (DEBUG, INFO, WARN, ERROR)
- Writes logs to both console and files in the user's app data directory
- Requires no external dependencies

### Environment Variables

The following environment variables are used for testing and development:

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNATURES_DIR` | Directory containing security signature files | `./signatures` |
| `OPENAI_API_KEY` | API key for OpenAI (used for verification) | None |
| `DEBUG` | Enable debug logging | `false` |
| `__MCP_PROXY_ORIGINAL_URL` | Original URL of the MCP server (for proxying) | None |

### Testing

```bash
# Run all tests
npm run test:all

# Run specific transport tests
npm run test:stdio
npm run test:sse
npm run test:streamable
```