/**
 * Suspicious File Path Detector
 * 
 * Detects attempts to access sensitive system files and directories.
 * Helps prevent unauthorized access to system configuration files.
 * 
 * @param {any} toolInput - The tool input/arguments to analyze
 * @param {object} context - Additional context (toolName, userIntent, etc.)
 * @returns {{allowed: boolean, reason: string}} - Verification result
 */
function validateFilePaths(toolInput, context) {
    try {
        // Convert input to searchable string
        const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

        // Define suspicious file paths and patterns
        const suspiciousPaths = [
            // System configuration files
            '/etc/passwd',
            '/etc/shadow',
            '/etc/sudoers',
            '/etc/hosts',
            '/etc/crontab',

            // Sensitive directories
            '/root/',
            '~/.ssh/',
            '/proc/',
            '/sys/',
            '/dev/random',
            '/dev/urandom',

            // Environment and config files
            '/.env',
            '.env',
            '/etc/environment',

            // Windows equivalent paths
            'C:\\Windows\\System32',
            'C:\\Users\\Administrator',
            '%SYSTEMROOT%',

            // Common sensitive files
            'id_rsa',
            'id_ed25519',
            'id_ecdsa',
            'known_hosts',
            'authorized_keys'
        ];

        // Check for suspicious paths (case-insensitive)
        const lowerInput = inputStr.toLowerCase();
        const detectedPath = suspiciousPaths.find(path =>
            lowerInput.includes(path.toLowerCase())
        );

        if (detectedPath) {
            return {
                allowed: false,
                reason: `Suspicious file path detected: ${detectedPath}`
            };
        }

        // Check for directory traversal patterns
        const traversalPatterns = [
            /\.\.[\\/]/,      // ../ or ..\
            /[\\/]\.\.[\\/]/, // /../ or \..\ 
            /\.\.%2[fF]/,     // URL encoded ../
            /\.\.%5[cC]/      // URL encoded ..\
        ];

        const traversalDetected = traversalPatterns.some(pattern =>
            pattern.test(inputStr)
        );

        if (traversalDetected) {
            return {
                allowed: false,
                reason: 'Directory traversal pattern detected in file path'
            };
        }

        return {
            allowed: true,
            reason: 'No suspicious file paths detected'
        };

    } catch (error) {
        return {
            allowed: false,
            reason: `File path validation error: ${error.message}`
        };
    }
}

module.exports = validateFilePaths; 