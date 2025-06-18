/**
 * Large Data Exfiltration Detector
 * 
 * Flags unusually large data requests that could indicate data exfiltration.
 * Monitors for patterns suggesting bulk data access or extraction.
 * 
 * @param {any} toolInput - The tool input/arguments to analyze
 * @param {object} context - Additional context (toolName, userIntent, etc.)
 * @returns {{allowed: boolean, reason: string}} - Verification result
 */
function detectLargeDataExfiltration(toolInput, context) {
    try {
        // Convert input to searchable string
        const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

        // Configuration thresholds
        const MAX_INPUT_SIZE = 10000;        // 10KB input size limit
        const MAX_FILE_READ_COUNT = 5;       // Maximum file reads per request
        const MAX_DIRECTORY_DEPTH = 3;       // Maximum directory traversal depth

        const suspiciousReasons = [];

        // Check 1: Input size limit
        if (inputStr.length > MAX_INPUT_SIZE) {
            suspiciousReasons.push(`Large input size: ${inputStr.length} bytes (limit: ${MAX_INPUT_SIZE})`);
        }

        // Check 2: Multiple file read operations
        const fileReadPatterns = [
            /\breadFile\b/gi,
            /\bread\b.*\bfile\b/gi,
            /\bgetFileContents\b/gi,
            /\bfs\.readFile/gi,
            /\bopen\b.*\bfile\b/gi
        ];

        let totalFileReads = 0;
        fileReadPatterns.forEach(pattern => {
            const matches = inputStr.match(pattern);
            if (matches) {
                totalFileReads += matches.length;
            }
        });

        if (totalFileReads > MAX_FILE_READ_COUNT) {
            suspiciousReasons.push(`Multiple file reads: ${totalFileReads} operations (limit: ${MAX_FILE_READ_COUNT})`);
        }

        // Check 3: Directory traversal depth
        const directoryTraversalPattern = /\.\.[\/\\]/g;
        const traversalMatches = inputStr.match(directoryTraversalPattern);
        if (traversalMatches && traversalMatches.length > MAX_DIRECTORY_DEPTH) {
            suspiciousReasons.push(`Deep directory traversal: ${traversalMatches.length} levels (limit: ${MAX_DIRECTORY_DEPTH})`);
        }

        // Check 4: Bulk data extraction patterns
        const bulkDataPatterns = [
            /\*(\.txt|\.log|\.csv|\.json|\.xml)\b/gi,  // Wildcard file extensions
            /\b(SELECT\s+\*|DUMP|EXPORT|BACKUP)\b/gi,   // Database operations
            /\b(tar|zip|gzip|compress)\b/gi,            // Archive operations
            /\b(grep|find|locate)\b.*\*.*\*/gi,         // Recursive search patterns
            /\brecursive\b.*\btrue\b/gi                 // Recursive flags
        ];

        const detectedBulkPattern = bulkDataPatterns.find(pattern => pattern.test(inputStr));
        if (detectedBulkPattern) {
            suspiciousReasons.push('Bulk data extraction pattern detected');
        }

        // Check 5: Large file or directory operations
        const largeOperationPatterns = [
            /\bsize\b.*[>].*\d{6,}/gi,      // Size comparisons > 100KB
            /\blimit\b.*\d{4,}/gi,          // Large limits (>1000)
            /\bcount\b.*\d{3,}/gi,          // Large counts (>100)
            /\ball\b.*\bfiles\b/gi,         // All files operations
            /\bentire\b.*\b(directory|folder)\b/gi  // Entire directory operations
        ];

        const detectedLargeOp = largeOperationPatterns.find(pattern => pattern.test(inputStr));
        if (detectedLargeOp) {
            suspiciousReasons.push('Large-scale operation pattern detected');
        }

        // Check 6: Network transmission indicators
        const networkPatterns = [
            /\b(upload|download|transfer|send|transmit)\b/gi,
            /\b(http|https|ftp|sftp|scp|rsync)\b.*:/gi,
            /\b(base64|encode|compress|encrypt)\b/gi
        ];

        const hasNetworkPattern = networkPatterns.some(pattern => pattern.test(inputStr));
        const hasLargeData = inputStr.length > 1000 || totalFileReads > 1;

        if (hasNetworkPattern && hasLargeData) {
            suspiciousReasons.push('Network transmission with large data detected');
        }

        // Determine final result
        if (suspiciousReasons.length > 0) {
            return {
                allowed: false,
                reason: `Potential data exfiltration: ${suspiciousReasons.join('; ')}`
            };
        }

        return {
            allowed: true,
            reason: 'Data request appears normal'
        };

    } catch (error) {
        return {
            allowed: false,
            reason: `Data exfiltration detection error: ${error.message}`
        };
    }
}

module.exports = detectLargeDataExfiltration; 