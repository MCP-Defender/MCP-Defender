/**
 * SSH Key Pattern Detector
 * 
 * Detects SSH private key patterns in tool input using regex patterns.
 * Prevents accidental exposure of SSH private keys in MCP tool calls.
 * 
 * @param {any} toolInput - The tool input/arguments to analyze
 * @param {object} context - Additional context (toolName, userIntent, etc.)
 * @returns {{allowed: boolean, reason: string}} - Verification result
 */
function detectSSHKeys(toolInput, context) {
    try {
        // Convert input to searchable string
        const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

        // Define SSH key patterns to detect
        const sshKeyPatterns = [
            /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
            /ssh-rsa [A-Za-z0-9+\/=]+/,
            /ssh-ed25519 [A-Za-z0-9+\/=]+/,
            /ssh-dss [A-Za-z0-9+\/=]+/,
            /ecdsa-sha2-nistp[0-9]+ [A-Za-z0-9+\/=]+/
        ];

        // Check for SSH key patterns
        const detectedPattern = sshKeyPatterns.find(pattern => pattern.test(inputStr));

        if (detectedPattern) {
            return {
                allowed: false,
                reason: `SSH private key pattern detected in tool input`
            };
        }

        return {
            allowed: true,
            reason: 'No SSH key patterns found'
        };

    } catch (error) {
        return {
            allowed: false,
            reason: `SSH key detection error: ${error.message}`
        };
    }
}

module.exports = detectSSHKeys; 