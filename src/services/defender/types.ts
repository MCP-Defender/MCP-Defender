import { ServerTool } from '../configurations/types';
import { ScanResult } from '../scans/types';

/**
 * Defender process status
 */
export enum DefenderStatus {
    stopped = 'stopped',
    starting = 'starting',
    running = 'running',
    error = 'error'
}

/**
 * Defender process state
 */
export interface DefenderState {
    status: DefenderStatus;
    error?: string;
}

/**
 * Security alert request from the defender process
 */
export interface SecurityAlertRequest {
    requestId: string;
    scanResult: ScanResult;
}

/**
 * Security alert response to the defender process
 */
export interface SecurityAlertResponse {
    requestId: string;
    allowed: boolean;
}

/**
 * Tools update data
 */
export interface ToolsUpdateData {
    tools: ServerTool[];
    appName: string;
    serverName: string;
}

/**
 * Messages from the defender service
 */
export enum DefenderServiceEvent {
    START_SERVER = 'defender-service:start-server',
    UPDATE_SETTINGS = 'defender-service:update-settings',
    UPDATE_SIGNATURES = 'defender-service:update-signatures',
    UPDATE_CONFIGURATIONS = 'defender-service:update-configurations',
    UPDATE_APP_METADATA = 'defender-service:update-app-metadata',
    STATUS = 'defender-service:status',
    READY = 'defender-service:ready',
    SECURITY_ALERT_RESPONSE = 'defender-service:security-alert-response',
    TOOLS_UPDATE = 'defender-service:tools-update',
    TOOLS_DISCOVERY_COMPLETE = 'defender-service:tools-discovery-complete'
}

/**
 * Messages from the defender server
 */
export enum DefenderServerEvent {
    SCAN_RESULT = 'defender-server:scan-result',
    STATUS = 'defender-server:status',
    TOOLS_UPDATE = 'defender-server:tools-update',
    SHOW_SECURITY_ALERT = 'defender-server:security-alert',
    TOOLS_DISCOVERY_COMPLETE = 'defender-server:tools-discovery-complete'
}