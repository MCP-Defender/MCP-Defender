/**
 * Command Injection Pattern Detector
 * 
 * Detects common command injection patterns in tool input.
 * Helps prevent execution of malicious shell commands.
 * 
 * @param {any} toolInput - The tool input/arguments to analyze
 * @param {object} context - Additional context (toolName, userIntent, etc.)
 * @returns {{allowed: boolean, reason: string}} - Verification result
 */
function detectCommandInjection(toolInput, context) {
    try {
        // Convert input to searchable string
        const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

        // Command injection character patterns
        const injectionChars = [
            /[;&|`$(){}\\[\]<>]/,  // Shell metacharacters
            /\|\s*\w+/,            // Pipes followed by commands
            /&&\s*\w+/,            // Command chaining with &&
            /;\s*\w+/              // Command separation with ;
        ];

        // Dangerous command patterns
        const dangerousCommands = [
            /\b(curl|wget|nc|netcat|bash|sh|cmd|powershell|eval|exec|system)\b/i,
            /\b(rm\s+-rf|del\s+\/[sf]|format\s+c:)/i,  // Destructive commands
            /\b(chmod\s+777|chown\s+root)/i,            // Permission changes
            /\b(sudo\s+|su\s+)/i,                       // Privilege escalation
            /\b(cat\s+\/etc\/passwd|type\s+%SYSTEMROOT%)/i  // System file access
        ];

        // Command substitution patterns
        const substitutionPatterns = [
            /\$\(.*\)/,      // $(command)
            /`.*`/,          // `command`
            /%[^%]+%/,       // %VARIABLE% (Windows)
            /\${.*}/         // ${variable}
        ];

        // Process/environment manipulation
        const processPatterns = [
            /\|\s*(curl|wget|nc|bash|sh)/i,
            />\s*\/dev\/(tcp|udp)/,
            /\/proc\/\d+\//,
            /\/dev\/shm\//
        ];

        // Check all pattern categories
        const allPatterns = [
            ...injectionChars,
            ...dangerousCommands,
            ...substitutionPatterns,
            ...processPatterns
        ];

        const detectedPattern = allPatterns.find(pattern => pattern.test(inputStr));

        if (detectedPattern) {
            return {
                allowed: false,
                reason: `Command injection pattern detected in tool input`
            };
        }

        // Additional check for encoded payloads
        try {
            const decodedInput = decodeURIComponent(inputStr);
            if (decodedInput !== inputStr) {
                // Check decoded content for injection patterns
                const decodedDetection = allPatterns.find(pattern => pattern.test(decodedInput));
                if (decodedDetection) {
                    return {
                        allowed: false,
                        reason: 'Command injection pattern detected in URL-decoded input'
                    };
                }
            }
        } catch (decodeError) {
            // Ignore decode errors, continue with original checks
        }

        return {
            allowed: true,
            reason: 'No command injection patterns detected'
        };

    } catch (error) {
        return {
            allowed: false,
            reason: `Command injection detection error: ${error.message}`
        };
    }
}

module.exports = detectCommandInjection; 