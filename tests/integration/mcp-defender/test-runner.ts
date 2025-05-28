/**
 * Test runner for MCP Defender
 *
 * Orchestrates testing of all MCP transport types
 * with both allowed and blocked operations.
 * 
 * This uses Node.js built-in test runner:
 * https://nodejs.org/api/test.html
 */

import { createStdioClient, createSSEClient, createStreamableClient } from './test-clients';
import { testCases } from './test-cases';
import { spawn, ChildProcess } from 'child_process';
import { execSync } from 'child_process';
import { describe, it, before, after, TestContext } from 'node:test';
import assert from 'node:assert';
import { waitForProcessReady, killProcess, isToolCallAllowed, isSecurityPolicyError, cleanupElectronProcesses } from './test-utils';

// For cleanup at the end of all tests
import { after as afterAll } from 'node:test';

// Track processes for cleanup
const processes: ChildProcess[] = [];

// Track test results for reporting
type Transport = 'STDIO' | 'HTTP+SSE' | 'STREAMABLE';

interface TestResult {
    passed: number;
    failed: number;
    transportType: Transport;
    failedTests: string[];
}

const testResults: TestResult[] = [];

// Handle EPIPE and other common errors gracefully
process.on('uncaughtException', (err) => {
    if (err.message && err.message.includes('EPIPE')) {
        console.log('Caught EPIPE error - a process ended unexpectedly');
        return; // Don't crash, just continue
    }
    console.error('Uncaught exception:', err);
    cleanup(1);
});

// Create a cleanup function we can call from various places
function cleanup(exitCode = 0) {
    console.log('\n--- Cleaning up ---');

    // Kill tracked processes
    for (const proc of processes) {
        const isElectronProc = proc.spawnargs.some(arg =>
            arg.includes('electron') || arg.includes('Electron'));
        killProcess(proc, isElectronProc);
    }

    // Force cleanup of any lingering Electron processes
    cleanupElectronProcesses().then(() => {
        console.log('Cleanup complete. Exiting...');
        process.exit(exitCode);
    });
}

// Modified spawn function that tracks processes
function spawnAndTrack(command: string, args: string[], options: any = {}): ChildProcess {
    console.log(`Spawning process: ${command} ${args.join(' ')}`);

    // Ensure we have stdio: 'pipe' for child process communication
    const updatedOptions = {
        ...options,
        stdio: options.stdio || 'pipe'
    };

    // Spawn the process
    const proc = spawn(command, args, updatedOptions);

    // Setup error handling
    proc.on('error', (err) => {
        console.error(`Process error (${command}):`, err);
    });

    proc.on('exit', (code, signal) => {
        console.log(`Process exited (${command}) with code ${code} and signal ${signal}`);
    });

    // Only setup stdout/stderr listeners if we're not already piping them elsewhere
    if (updatedOptions.stdio === 'pipe') {
        // Add safety checks to prevent EPIPE errors
        proc.stdout?.on('data', (data) => {
            try {
                console.log(`[${command} stdout]: ${data.toString().trim().substring(0, 200)}`);
            } catch (err) {
                // Ignore write errors
            }
        });

        proc.stderr?.on('data', (data) => {
            try {
                console.error(`[${command} stderr]: ${data.toString().trim().substring(0, 200)}`);
            } catch (err) {
                // Ignore write errors
            }
        });
    }

    console.log(`Spawned process PID: ${proc.pid}`);
    processes.push(proc);
    return proc;
}

// Define the test suites using Node.js test runner
describe('MCP Defender Integration Tests', () => {
    // Cleanup any existing processes before tests start
    before(async () => {
        console.log('Cleaning up any existing processes before tests start');
        await cleanupElectronProcesses();
    });

    describe('STDIO Transport', () => {
        let defenderProcess: ChildProcess | null = null;
        let client: any = null;
        const testResult: TestResult = {
            passed: 0,
            failed: 0,
            transportType: 'STDIO',
            failedTests: []
        };

        before(async () => {
            // Start MCP Defender
            defenderProcess = spawnAndTrack('npm', ['run', 'start'], {
                env: {
                    ...process.env,
                    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
                    OPENAI_LOG: 'error',
                    NODE_ENV: 'test' // Set test environment
                }
            });

            // Wait for defender to be ready
            const isReady = await waitForProcessReady(
                defenderProcess,
                ['running', '8081'],
                'MCP Defender started successfully',
                'Timeout waiting for MCP Defender to start',
                9000,
                5000
            );

            if (!isReady) {
                throw new Error('Failed to start MCP Defender');
            }

            // Create STDIO client
            client = await createStdioClient({
                serverName: 'everything',
            });
        });

        after(async () => {
            // Cleanup
            if (client) {
                try {
                    await client.close();
                } catch (err) {
                    console.error('Error closing client:', err);
                }
            }

            // Kill defender process - note it's an Electron process
            killProcess(defenderProcess, true);
            defenderProcess = null;

            // Store results
            testResults.push(testResult);

            // Wait for processes to terminate
            await new Promise(resolve => setTimeout(resolve, 1000));
        });

        // Basic test for tool call
        it('should be able to call add tool', async (t: TestContext) => {
            try {
                const result = await client.callTool({
                    name: 'add',
                    arguments: { a: 2, b: 3 }
                });

                assert.ok(result.content, 'Response should have content field');
                assert.ok(Array.isArray(result.content), 'Content should be an array');

                // Check that the response contains the expected result
                const hasCorrectResult = result.content.some((item: any) =>
                    item.type === 'text' &&
                    typeof item.text === 'string' &&
                    item.text.includes('5')
                );

                assert.ok(hasCorrectResult, 'Response should indicate that 2+3=5');
                testResult.passed++;
            } catch (error) {
                testResult.failed++;
                testResult.failedTests.push('should be able to call add tool');
                throw error;
            }
        });
    });

    // HTTP+SSE Transport Tests
    describe('HTTP+SSE Transport', () => {
        let sseServer: ChildProcess | null = null;
        let defenderProcess: ChildProcess | null = null;
        let client: any = null;
        const SSE_PORT = 3001;
        const testResult: TestResult = {
            passed: 0,
            failed: 0,
            transportType: 'HTTP+SSE',
            failedTests: []
        };

        // Setup before HTTP+SSE tests
        before(async () => {
            // Start the test server and defender
            try {
                execSync('pkill -f "mcp-defender" || true');
                await cleanupElectronProcesses();
            } catch (error) {
                console.log('No existing MCP Defender processes found');
            }

            // Start SSE server
            sseServer = spawnAndTrack('npm', ['run', 'start:sse', '--', `--port=${SSE_PORT}`], {
                cwd: './node_modules/@modelcontextprotocol/server-everything'
            });

            // Wait for server
            const sseReady = await waitForProcessReady(
                sseServer,
                ['Server is running on port'],
                'SSE server started successfully',
                'Timeout waiting for SSE server to start'
            );

            if (!sseReady) {
                throw new Error('Failed to start SSE server');
            }

            // Start MCP Defender (Electron app)
            defenderProcess = spawnAndTrack('npx', ['electron', '.'], {
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
                    MCP_DEFENDER_TEST_MODE: 'true',
                    OPENAI_LOG: 'error',
                    __MCP_PROXY_ORIGINAL_URL: `http://localhost:${SSE_PORT}/sse`
                }
            });

            // Wait for defender
            const defenderReady = await waitForProcessReady(
                defenderProcess,
                ['running', '8081'],
                'MCP Defender started successfully',
                'Timeout waiting for MCP Defender to start'
            );

            if (!defenderReady) {
                throw new Error('Failed to start MCP Defender');
            }

            // Connect client
            client = await createSSEClient({
                serverName: 'everything',
                port: 8081,
                defaultTimeout: 10000
            });
        });

        // Cleanup after HTTP+SSE tests
        after(async () => {
            // Close the client connection
            if (client) {
                try {
                    console.log('Closing client connection');
                } catch (error) {
                    console.error('Error closing client:', error);
                }
            }

            // Kill the server and defender - note Electron needs special handling
            killProcess(sseServer, false);
            killProcess(defenderProcess, true);

            // Store results
            testResults.push(testResult);

            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));
        });

        // Tests for HTTP+SSE transport
        it('should correctly add two numbers', async (t: TestContext) => {
            try {
                const addResponse = await client.callTool({
                    name: 'add',
                    arguments: { a: 2, b: 3 }
                });

                // Verify the response structure
                assert.ok(addResponse, 'Response should exist');
                assert.ok(addResponse.content, 'Response should have content field');
                assert.ok(Array.isArray(addResponse.content), 'Content should be an array');

                // Check that the response contains the expected result
                const hasCorrectResult = addResponse.content.some((item: any) =>
                    item.type === 'text' &&
                    typeof item.text === 'string' &&
                    item.text.includes('5')
                );

                assert.ok(hasCorrectResult, 'Response should indicate that 2+3=5');
                testResult.passed++;
            } catch (error) {
                testResult.failed++;
                testResult.failedTests.push('should correctly add two numbers');
                throw error;
            }
        });
    });
});

// Force cleanup of all processes on exit
afterAll(async () => {
    console.log('\n--- Test Summary ---');

    // Log test results
    testResults.forEach(result => {
        if (result.failed > 0) {
            console.error(`${result.transportType}: ${result.passed} passed, ${result.failed} failed`);
            result.failedTests.forEach(test => {
                console.error(`  - ${test}`);
            });
        } else {
            console.log(`${result.transportType}: ${result.passed} passed`);
        }
    });

    // Do a thorough cleanup including Electron processes
    await cleanupElectronProcesses();

    // Kill any remaining tracked processes
    for (const proc of processes) {
        const isElectronProc = proc.spawnargs.some(arg =>
            arg.includes('electron') || arg.includes('Electron'));
        killProcess(proc, isElectronProc);
    }

    // Force exit after cleanup
    setTimeout(() => {
        process.exit(0);
    }, 2000);
});

// Register process exit handlers for clean shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT, cleaning up...');
    cleanup(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, cleaning up...');
    cleanup(0);
});
