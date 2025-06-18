# Deterministic Signature Protocol

## Overview
Deterministic signatures are JavaScript functions that provide fast, rule-based security checks for MCP tool calls. This document defines the protocol that all deterministic signature functions must follow.

## Function Interface

### Required Export
All deterministic signature functions must export a single function as the default export:

```javascript
/**
 * @param {any} toolInput - The tool input/arguments to analyze
 * @param {SignatureContext} context - Additional context information
 * @returns {SignatureResult} - The verification result
 */
function signatureName(toolInput, context) {
    // Implementation here
    return { allowed: boolean, reason: string };
}

module.exports = signatureName;
```

### Input Parameters

#### `toolInput` (any)
- The raw input/arguments passed to the MCP tool
- Can be any type: string, object, array, etc.
- Should be treated as potentially malicious data

#### `context` (SignatureContext)
```javascript
{
    toolName: string,           // Name of the tool being called
    userIntent?: string,        // Optional user-provided intent
    toolDescription?: string,   // Optional tool description
    // Helper functions (see below)
}
```

### Return Value (SignatureResult)
```javascript
{
    allowed: boolean,    // true = allow, false = block
    reason: string      // Human-readable explanation
}
```

### Alternative Return Formats
For convenience, functions may also return:
- `boolean` - Will be converted to `{allowed: boolean, reason: "..."}`

## Available Helper Functions

The context object includes these helper functions:

```javascript
// Type checking
isString(value)         // typeof value === 'string'
isObject(value)         // typeof value === 'object' && value !== null
isArray(value)          // Array.isArray(value)
hasProperty(obj, prop)  // Safe property checking

// Pattern matching
matchesRegex(str, pattern, flags?) // Safe regex testing
containsKeywords(text, keywords)   // Case-insensitive keyword search
```

## Best Practices

### 1. Input Sanitization
Always convert input to string for pattern matching:
```javascript
const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
```

### 2. Error Handling
Functions should be defensive and handle errors gracefully:
```javascript
try {
    // Your logic here
    return { allowed: true, reason: 'Check passed' };
} catch (error) {
    return { allowed: false, reason: `Check failed: ${error.message}` };
}
```

### 3. Clear Reasons
Provide specific, actionable reasons for blocking:
```javascript
// Good
return { allowed: false, reason: 'SSH private key pattern detected in file path argument' };

// Bad  
return { allowed: false, reason: 'Blocked' };
```

### 4. Performance
Keep functions fast - they execute on every tool call:
- Avoid complex operations
- Use efficient regex patterns
- Cache results when possible

## Example Implementation

```javascript
/**
 * SSH Key Pattern Detector
 * Detects SSH private key patterns in tool input
 */
function detectSSHKeys(toolInput, context) {
    // Convert input to searchable string
    const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
    
    // Define patterns to detect
    const sshKeyPatterns = [
        /-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/,
        /ssh-rsa [A-Za-z0-9+\/=]+/,
        /ssh-ed25519 [A-Za-z0-9+\/=]+/
    ];
    
    // Check for matches
    const hasSSHKey = sshKeyPatterns.some(pattern => pattern.test(inputStr));
    
    return {
        allowed: !hasSSHKey,
        reason: hasSSHKey 
            ? 'SSH private key pattern detected in tool input'
            : 'No SSH key patterns found'
    };
}

module.exports = detectSSHKeys;
```

## Testing Your Function

You can test your function locally:
```javascript
const myFunction = require('./my-signature.js');

// Test cases
console.log(myFunction('normal input', {}));
console.log(myFunction('-----BEGIN RSA PRIVATE KEY-----', {}));
``` 