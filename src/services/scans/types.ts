import { Signature } from '../signatures/types';

/**
 * Result of signature verification
 */
export interface SignatureVerification {
    signatureId: string;
    signatureName: string;
    allowed: boolean;
    reason: string;
    modelName?: string; // The model that performed this verification
}

/**
 * Maps signature ID -> model name -> verification result
 */
export type SignatureVerificationMap = Record<string, Record<string, SignatureVerification>>;

/**
 * Scan result structure
 */
export interface ScanResult {
    id?: string;            // Unique ID for this scan result
    date: Date;            // When the scan occurred
    appName: string;       // The application that made the request
    serverName: string;    // The MCP server that was used
    serverVersion: string; // Version of the MCP server
    toolName: string;      // Name of the tool being called
    toolArgs: string;      // Arguments to the tool (serialized to string)
    allowed: boolean;      // Whether the call was allowed
    signatureVerifications: SignatureVerificationMap; // Results of signature verification
    isResponse?: boolean;  // Whether this was a tool response (vs request)
    scanTime: number;      // Time taken to scan (in ms)
    state: 'in_progress' | 'completed' | 'error'; // The current state of the scan
}

/**
 * Enum for scan-related events
 */
export enum ScanEventType {
    SCAN_RESULT_ADDED = 'scan:result-added',
    SCAN_RESULT_UPDATED = 'scan:result-updated'
} 