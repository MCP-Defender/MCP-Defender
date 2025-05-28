import { app, BrowserWindow, ipcMain } from 'electron';
import { createSecurityAlertWindow } from '../ipc-handlers/ui-manager';
import { SignatureVerification, SignatureVerificationMap, ScanResult } from '../services/scans/types';
import { createLogger, LogLevel } from './logger';
import { v4 as uuidv4 } from 'uuid';
import { ServiceManager } from '../services/service-manager';

// Create a logger for security alerts
const logger = createLogger('SecurityAlert', LogLevel.INFO);

// Store allowed overrides to avoid showing the same alert repeatedly
const userOverrides: Map<string, boolean> = new Map();

// Track active security alerts by scanId
const activeSecurityAlerts: Map<string, {
    resolve: (allowed: boolean) => void,
    scanResult: ScanResult,
    window: BrowserWindow,
    timerId: NodeJS.Timeout | null
}> = new Map();

// Generate a unique key for a verification result to use for overrides
function generateOverrideKey(scanResult: ScanResult): string {
    return `${scanResult.appName}:${scanResult.serverName}:${scanResult.toolName}`;
}

// Extract the failed signature verifications from the result
function getFailedVerifications(verificationMap: SignatureVerificationMap): SignatureVerification[] {
    const failedVerifications: SignatureVerification[] = [];

    Object.keys(verificationMap).forEach(signatureId => {
        const sigVerifications = verificationMap[signatureId];
        Object.keys(sigVerifications).forEach(modelName => {
            const verification = sigVerifications[modelName];
            if (!verification.allowed) {
                failedVerifications.push(verification);
            }
        });
    });

    return failedVerifications;
}

/**
 * Shows a security violation alert dialog to the user using a custom window
 * Returns true if the user chooses to allow the request, false otherwise
 * 
 * @param scanResult The scan result that triggered the alert
 * @returns Promise resolving to true if allowed by user, false otherwise
 */
export async function showSecurityViolationAlert(scanResult: ScanResult): Promise<boolean> {
    // Generate override key based on the scan info
    const overrideKey = generateOverrideKey(scanResult);

    // Check if user already made a decision for this type of alert
    if (userOverrides.has(overrideKey)) {
        const isAllowed = userOverrides.get(overrideKey) || false;
        logger.info(`Using existing override for ${overrideKey}: ${isAllowed ? 'ALLOWED' : 'BLOCKED'}`);
        return isAllowed;
    }

    logger.info(`Showing security alert for ${overrideKey}`, {
        app: scanResult.appName,
        server: scanResult.serverName,
        tool: scanResult.toolName,
        failedSignatures: getFailedVerifications(scanResult.signatureVerifications).map(v => v.signatureName)
    });

    // Store the scan result for the window to retrieve
    const scanId = uuidv4();

    // Store the scan result in the service manager for the window to retrieve
    ServiceManager.getInstance().scanService.addTemporaryScan(scanId, scanResult);

    // Create a promise that will be resolved when the user makes a decision
    return new Promise<boolean>((resolve) => {
        // Create the security alert window
        const securityAlertWindow = createSecurityAlertWindow(scanId);

        // Set up a timer to auto-close after 30 seconds (default to block)
        const timerId = setTimeout(() => {
            logger.info(`Security alert for ${overrideKey} timed out, blocking by default`);
            cleanupAlert(scanId, false);
        }, 30000); // 30 seconds

        // Store the alert info
        activeSecurityAlerts.set(scanId, {
            resolve,
            scanResult,
            window: securityAlertWindow,
            timerId
        });

        // Register IPC handlers for user decisions if not already registered
        if (!ipcMain.listenerCount('security-alert-decision')) {
            ipcMain.on('security-alert-decision', (event, { scanId, allowed, remember }) => {
                // Handle the user's decision
                handleUserDecision(scanId, allowed, remember);
            });
        }
    });
}

/**
 * Handles the user's decision from the security alert window
 */
function handleUserDecision(scanId: string, allowed: boolean, remember: boolean): void {
    const alert = activeSecurityAlerts.get(scanId);
    if (!alert) return;

    const { scanResult, resolve } = alert;
    const overrideKey = generateOverrideKey(scanResult);

    // Log the decision
    logger.info(`User ${allowed ? 'allowed' : 'blocked'} operation ${remember ? 'permanently' : 'once'}: ${overrideKey}`);

    // Store the decision if requested
    if (remember) {
        userOverrides.set(overrideKey, allowed);
    }

    // Resolve the promise with the user's decision
    cleanupAlert(scanId, allowed);
}

/**
 * Cleans up an active security alert
 */
function cleanupAlert(scanId: string, allowed: boolean): void {
    const alert = activeSecurityAlerts.get(scanId);
    if (!alert) return;

    const { resolve, window, timerId } = alert;

    // Clear the timeout if it exists
    if (timerId) {
        clearTimeout(timerId);
    }

    // Close the window
    if (!window.isDestroyed()) {
        // window.close();
        window.destroy();
    }

    // Remove the temporary scan
    ServiceManager.getInstance().scanService.removeTemporaryScan(scanId);

    // Remove from active alerts
    activeSecurityAlerts.delete(scanId);

    // Resolve the promise with the user's decision
    resolve(allowed);
}

/**
 * Creates a test security alert with mock data for development/testing
 * @returns Promise resolving to the user's decision
 */
export function createTestSecurityAlert(): Promise<boolean> {
    // Generate a unique ID for our test alert
    const scanId = uuidv4();

    // Create a mock scan result with realistic test data
    const mockScan: ScanResult = {
        id: scanId,
        date: new Date(),
        appName: "VSCode",
        serverName: "github-mcp-server",
        serverVersion: "1.0.0",
        toolName: "mcp_github-mcp-server_create_repository",
        toolArgs: JSON.stringify({
            name: "test-repo",
            private: false,
            description: "A test repository created via MCP tool"
        }, null, 2),
        allowed: false,
        isResponse: false,
        scanTime: 345,
        state: "completed",
        signatureVerifications: {
            "sig_prevent_repo_creation": {
                "gpt-4o": {
                    signatureId: "sig_prevent_repo_creation",
                    signatureName: "Prevent Repository Creation",
                    modelName: "gpt-4o",
                    allowed: false,
                    reason: "This operation would create a new GitHub repository, which is not allowed by security policy. Repository creation could lead to data exfiltration or unauthorized code hosting."
                }
            },
            "sig_assess_risk": {
                "gpt-4o": {
                    signatureId: "sig_assess_risk",
                    signatureName: "Risk Assessment",
                    modelName: "gpt-4o",
                    allowed: false,
                    reason: "Creating public repositories poses a security risk as it could lead to accidental exposure of sensitive information or intellectual property."
                }
            }
        }
    };

    // Return the result of showing the security alert with our mock data
    return showSecurityViolationAlert(mockScan);
}
