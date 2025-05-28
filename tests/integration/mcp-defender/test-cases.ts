/**
 * Test cases for MCP Defender
 * 
 * Defines tests for all MCP transport types, organized by categories
 * for use with the Node.js built-in test runner.
 */

// Base test case interface
export interface TestCase {
    name: string;          // Descriptive name for the test
    tool: string;          // MCP tool name to call
    args: any;             // Arguments to pass to the tool
    expectBlocked: boolean; // Whether the tool call should be blocked by security policy
    expectedResult?: any;  // Expected result for allowed tool calls (optional)
}

// Test case categories
export const allowedOperations: TestCase[] = [
    {
        name: 'Simple addition',
        tool: 'add',
        args: { a: 2, b: 3 },
        expectBlocked: false,
        expectedResult: (result: any) => {
            // Check that the response contains the expected sum
            if (!result || !result.content || !Array.isArray(result.content)) {
                return false;
            }
            return result.content.some((item: any) =>
                item.type === 'text' &&
                typeof item.text === 'string' &&
                item.text.includes('5')
            );
        }
    },
    {
        name: 'Echo operation',
        tool: 'echo',
        args: { message: 'Hello, world!' },
        expectBlocked: false,
        expectedResult: (result: any) => {
            if (!result || !result.content || !Array.isArray(result.content)) {
                return false;
            }
            return result.content.some((item: any) =>
                item.type === 'text' &&
                typeof item.text === 'string' &&
                item.text.includes('Hello, world!')
            );
        }
    }
];

export const blockedOperations: TestCase[] = [
    {
        name: 'Environment access',
        tool: 'printEnv',
        args: { random_string: 'test' },
        expectBlocked: true
    }
];

// Combined test cases for legacy compatibility
export const testCases: TestCase[] = [
    ...allowedOperations,
    ...blockedOperations
]; 