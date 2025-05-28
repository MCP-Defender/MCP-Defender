/**
 * Unit tests for MCP configuration management
 * 
 * These tests verify that the configuration management classes correctly:
 * 1. Parse MCP configurations
 * 2. Create protected versions of configurations
 * 3. Restore unprotected configurations
 * 4. Handle different configuration formats (standard and VSCode)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
    MCPConfig,
    ProtectionStatus,
    ServerConfig
} from '../../../src/types/mcp';
import { StandardMCPConfiguration } from '../../../src/configurations/adapters/standard-configuration';
import { VSCodeMCPConfiguration } from '../../../src/configurations/adapters/vscode-configuration';

// Create a temporary directory for test files
const tempDir = path.join(os.tmpdir(), `mcp-defender-tests-${Date.now()}`);

// Sample configurations for testing
const sampleStandardConfig: MCPConfig = {
    mcpServers: {
        'test-stdio': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/test-folder'],
            env: {}
        },
        'test-sse': {
            url: 'http://localhost:3000/sse',
            env: {}
        }
    }
};

const sampleVSCodeConfig = {
    'editor.fontSize': 14,
    'workbench.colorTheme': 'Default Dark+',
    'mcp.servers': {
        'test-stdio': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/test-folder'],
            env: {}
        },
        'test-sse': {
            url: 'http://localhost:3000/sse',
            env: {}
        }
    }
};

// Helper to create test file paths
function getTestFilePath(name: string): string {
    return path.join(tempDir, name);
}

// Setup and cleanup
before(() => {
    // Create temporary directory
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Created test directory: ${tempDir}`);

    // Write sample configuration files
    fs.writeFileSync(
        getTestFilePath('standard-config.json'),
        JSON.stringify(sampleStandardConfig, null, 2)
    );

    fs.writeFileSync(
        getTestFilePath('vscode-config.json'),
        JSON.stringify(sampleVSCodeConfig, null, 2)
    );
});

after(() => {
    // Clean up temporary directory
    try {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
        console.log(`Removed test directory: ${tempDir}`);
    } catch (error) {
        console.error(`Error cleaning up test directory: ${error}`);
    }
});

// Mock CLI path for testing
const testCliPath = '/test/path/to/cli.js';

describe('Standard MCP Configuration', () => {
    let standardConfig: StandardMCPConfiguration;

    before(() => {
        // Create configuration adapter with test parameters
        standardConfig = new StandardMCPConfiguration(
            'Test App',
            testCliPath,
            getTestFilePath('standard-config.json')
        );
    });

    it('should correctly identify unprotected servers', async () => {
        // Read original config and analyze it
        const config = await standardConfig.readConfig(standardConfig.getConfigPath());
        const mcpConfig = standardConfig.extractMCPConfig(config);
        const servers = standardConfig.analyzeConfig(mcpConfig);

        // Verify none of the servers are protected yet
        assert.strictEqual(servers.length, 2, 'Should have found 2 servers');
        assert.strictEqual(servers.filter(s => s.isProtected).length, 0, 'No servers should be protected yet');

        // Verify server names
        const serverNames = servers.map(s => s.serverName);
        assert.ok(serverNames.includes('test-stdio'), 'Should include test-stdio server');
        assert.ok(serverNames.includes('test-sse'), 'Should include test-sse server');
    });

    it('should create a protected version of the configuration', async () => {
        // Process the configuration file
        const result = await standardConfig.processConfigFile();

        // Verify the result
        assert.strictEqual(result.success, true, 'Process should succeed');
        assert.strictEqual(result.servers?.length, 2, 'Should have 2 servers');
        assert.strictEqual(result.servers?.filter(s => s.isProtected).length, 2, 'All servers should be protected');

        // Read the processed file and check the structure
        const processedConfig = await standardConfig.readConfig(standardConfig.getConfigPath());

        // Check for STDIO proxy configuration
        const stdioServer = processedConfig.mcpServers['test-stdio'];
        assert.strictEqual(stdioServer.command, 'node', 'Command should be changed to node');
        assert.ok(stdioServer.args[0].includes(testCliPath), 'First argument should be the CLI path');
        assert.strictEqual(stdioServer.env.__MCP_PROXY_ORIGINAL_COMMAND, 'npx', 'Original command should be stored');
        assert.ok(stdioServer.env.__MCP_PROXY_ORIGINAL_ARGS.includes('@modelcontextprotocol/server-filesystem'), 'Original args should be stored');

        // Check for SSE proxy configuration
        const sseServer = processedConfig.mcpServers['test-sse'];
        assert.ok(sseServer.url.includes('localhost:8081'), 'URL should be proxied to defender port');
        assert.ok(sseServer.url.includes('/test-sse/sse'), 'URL should include server name');
        assert.strictEqual(sseServer.env.__MCP_PROXY_ORIGINAL_URL, 'http://localhost:3000/sse', 'Original URL should be stored');
    });

    it('should restore the unprotected configuration', async () => {
        // Ensure we have a backup file
        assert.ok(fs.existsSync(standardConfig.getUnprotectedConfigPath()), 'Unprotected backup file should exist');

        // Restore the configuration
        const result = await standardConfig.restoreUnprotectedConfig();

        // Verify the result
        assert.strictEqual(result.success, true, 'Restore should succeed');

        // Read the restored file and check the structure
        const restoredConfig = await standardConfig.readConfig(standardConfig.getConfigPath());

        // Check that it matches the original configuration
        const stdioServer = restoredConfig.mcpServers['test-stdio'];
        assert.strictEqual(stdioServer.command, 'npx', 'Original command should be restored');
        assert.strictEqual(stdioServer.args[0], '-y', 'Original args should be restored');
        assert.strictEqual(stdioServer.args[1], '@modelcontextprotocol/server-filesystem', 'Original args should be restored');

        // Check that proxy env vars are removed
        assert.strictEqual(stdioServer.env.__MCP_PROXY_ORIGINAL_COMMAND, undefined, 'Proxy env vars should be removed');

        // Check SSE server
        const sseServer = restoredConfig.mcpServers['test-sse'];
        assert.strictEqual(sseServer.url, 'http://localhost:3000/sse', 'Original URL should be restored');
        assert.strictEqual(sseServer.env.__MCP_PROXY_ORIGINAL_URL, undefined, 'Proxy env vars should be removed');

        // Verify unprotected file is deleted after restoration
        assert.strictEqual(fs.existsSync(standardConfig.getUnprotectedConfigPath()), false, 'Unprotected backup file should be deleted');
    });
});

describe('VSCode MCP Configuration', () => {
    let vscodeConfig: VSCodeMCPConfiguration;

    before(() => {
        // Create configuration adapter with test parameters
        vscodeConfig = new VSCodeMCPConfiguration(
            testCliPath,
            getTestFilePath('vscode-config.json')
        );
    });

    it('should correctly extract MCP configuration from VSCode settings', async () => {
        // Read VSCode config
        const config = await vscodeConfig.readConfig(vscodeConfig.getConfigPath());

        // Extract MCP portion
        const mcpConfig = vscodeConfig.extractMCPConfig(config);

        // Verify structure
        assert.ok(mcpConfig.mcpServers, 'Should have mcpServers property');
        assert.strictEqual(Object.keys(mcpConfig.mcpServers).length, 2, 'Should have 2 servers');

        // Verify server configurations
        assert.ok(mcpConfig.mcpServers['test-stdio'], 'Should have test-stdio server');
        assert.ok(mcpConfig.mcpServers['test-sse'], 'Should have test-sse server');
    });

    it('should create a protected version of the VSCode configuration', async () => {
        // Process the configuration file
        const result = await vscodeConfig.processConfigFile();

        // Verify the result
        assert.strictEqual(result.success, true, 'Process should succeed');
        assert.strictEqual(result.servers?.length, 2, 'Should have 2 servers');
        assert.strictEqual(result.servers?.filter(s => s.isProtected).length, 2, 'All servers should be protected');

        // Read the processed file and check the structure
        const processedConfig = await vscodeConfig.readConfig(vscodeConfig.getConfigPath());

        // Verify non-MCP settings are preserved
        assert.strictEqual(processedConfig['editor.fontSize'], 14, 'Editor settings should be preserved');
        assert.strictEqual(processedConfig['workbench.colorTheme'], 'Default Dark+', 'Theme settings should be preserved');

        // Check for STDIO proxy configuration
        const stdioServer = processedConfig['mcp.servers']['test-stdio'];
        assert.strictEqual(stdioServer.command, 'node', 'Command should be changed to node');
        assert.ok(stdioServer.args[0].includes(testCliPath), 'First argument should be the CLI path');

        // Check for SSE proxy configuration
        const sseServer = processedConfig['mcp.servers']['test-sse'];
        assert.ok(sseServer.url.includes('localhost:8081'), 'URL should be proxied to defender port');
    });

    it('should restore the unprotected VSCode configuration', async () => {
        // Restore the configuration
        const result = await vscodeConfig.restoreUnprotectedConfig();

        // Verify the result
        assert.strictEqual(result.success, true, 'Restore should succeed');

        // Read the restored file and check the structure
        const restoredConfig = await vscodeConfig.readConfig(vscodeConfig.getConfigPath());

        // Verify non-MCP settings are preserved
        assert.strictEqual(restoredConfig['editor.fontSize'], 14, 'Editor settings should be preserved');
        assert.strictEqual(restoredConfig['workbench.colorTheme'], 'Default Dark+', 'Theme settings should be preserved');

        // Check that it matches the original configuration
        const stdioServer = restoredConfig['mcp.servers']['test-stdio'];
        assert.strictEqual(stdioServer.command, 'npx', 'Original command should be restored');

        // Check SSE server
        const sseServer = restoredConfig['mcp.servers']['test-sse'];
        assert.strictEqual(sseServer.url, 'http://localhost:3000/sse', 'Original URL should be restored');
    });
}); 