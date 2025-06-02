import * as path from 'path';
import { app, BrowserWindow, utilityProcess } from 'electron';
import { BaseService, ServiceEvent, ServiceEventBus } from '../base-service';
import {
    DefenderServiceEvent,
    DefenderState,
    DefenderStatus,
    SecurityAlertRequest,
    SecurityAlertResponse,
    ToolsUpdateData
} from './types';
import { showSecurityViolationAlert } from '../../utils/security-alert-handler';
import { DefenderServerEvent } from './types';
import { showCriticalErrorDialog } from '../../ipc-handlers/ui-manager';
import { ServiceManager } from '../service-manager';
import * as crypto from 'crypto';
import { ScanResult as ScanServiceResult } from '../scans/types';

/**
 * Defender Service
 * 
 * Manages the defender utility process which monitors MCP communications
 * and applies security policies.
 */
export class DefenderService extends BaseService {
    // Defender state
    private state: DefenderState = {
        status: DefenderStatus.starting,
        error: null
    };

    // The utility process instance
    private process: Electron.UtilityProcess | null = null;

    // The main window reference
    private mainWindow: BrowserWindow | null = null;

    /**
     * Create a new defender service
     */
    constructor() {
        super('Defender');

        // Subscribe to events from other services
        this.subscribeToServiceEvents();
    }

    /**
     * Subscribe to events from other services
     */
    private subscribeToServiceEvents(): void {
        // Settings updates
        this.subscribeToEvent(ServiceEvent.SETTINGS_UPDATED, (settings) => {
            this.logger.info('Received settings update via event bus');
            this.sendMessage(DefenderServiceEvent.UPDATE_SETTINGS, settings);
        });

        // Signatures updates
        this.subscribeToEvent(ServiceEvent.SIGNATURES_UPDATED, (signatures) => {
            this.logger.info(`Received ${signatures.length} signatures via event bus`);
            this.sendMessage(DefenderServiceEvent.UPDATE_SIGNATURES, { signatures });
        });

        // Configuration updates
        this.subscribeToEvent(ServiceEvent.CONFIGURATIONS_UPDATED, (applications) => {
            this.logger.info(`Received ${applications.length} applications via event bus`);
            this.sendMessage(DefenderServiceEvent.UPDATE_CONFIGURATIONS, { applications });
        });
    }

    /**
     * Start the defender service
     */
    start(): boolean {
        if (!super.start()) return false;

        this.logger.info('Starting defender service');
        this.startProcess();

        // State will be updated when process starts
        return true;
    }

    /**
     * Stop the defender service
     */
    stop(): boolean {
        if (!super.stop()) return false;

        this.logger.info('Stopping defender service');
        this.shutdownProcess();

        // Unsubscribe from all events
        ServiceEventBus.removeAllListeners();

        return true;
    }

    /**
     * Get the current defender state
     */
    getState(): DefenderState {
        return { ...this.state };
    }

    /**
     * Set the main window reference
     */
    setMainWindow(window: BrowserWindow): void {
        this.mainWindow = window;
    }

    /**
     * Start the defender utility process
     */
    startProcess(): boolean {
        if (this.process) {
            this.logger.warn('Defender process already exists');
            return false;
        }

        // Update state to starting
        this.updateState({
            status: DefenderStatus.starting
        });

        // Always enable debugging for utility process in development
        // This debug port 9229 is critical for attaching the debugger
        const debugArgs = process.env.NODE_ENV === 'development'
            ? ['--inspect=9229']
            : [];

        // Create the utility process with the correct path
        const defenderServerPath = path.join(__dirname, './defender-controller.js');
        this.logger.info('Loading defender server from:', defenderServerPath);

        try {
            this.process = utilityProcess.fork(defenderServerPath, [], {
                stdio: 'pipe',
                execArgv: debugArgs,
                env: {
                    ...process.env,
                }
            });

            // Handle stdout/stderr
            this.process.stdout?.on('data', (data) => {
                this.logger.info(`[DEFENDER SERVER] stdout: ${data.toString().trim()}`);
            });

            this.process.stderr?.on('data', (data) => {
                this.logger.error(`[DEFENDER SERVER] stderr: ${data.toString().trim()}`);
            });

            this.process.on('spawn', () => {
                this.logger.info('[DEFENDER SERVER]: Defender process spawned with PID:', this.process?.pid);

                // Post a message to the defender process to start it
                this.process.postMessage({
                    type: DefenderServiceEvent.START_SERVER,
                });

            });

            this.process.on('error', (error) => {
                this.logger.error('[DEFENDER SERVER]: Defender process error:', error);
                this.updateState({
                    status: DefenderStatus.error,
                    error: String(error)
                });
            });

            this.process.on('exit', (code) => {
                this.logger.info('[DEFENDER SERVER]: Defender process exited with code:', code);
                this.process = null;
                this.updateState({
                    status: DefenderStatus.stopped
                });
            });

            // this.process.on('message', (message) => {
            //     this.logger.info('[DEFENDER SERVER]: Received message from defender process:', message);
            // });

            // Set up message handlers
            this.setupProcessHandlers();


            return true;
        } catch (error) {
            const errorMessage = typeof error === 'object' && error !== null && 'message' in error
                ? error.message as string
                : String(error);

            this.logger.error('Failed to start defender process:', errorMessage);
            this.updateState({
                status: DefenderStatus.error,
                error: errorMessage
            });
            return false;
        }
    }

    /**
     * Shut down the defender utility process
     */
    shutdownProcess(): void {
        if (this.process) {
            this.logger.info('Shutting down defender process');
            this.process.kill();
            this.process = null;
            this.updateState({
                status: DefenderStatus.stopped
            });
        }
    }

    /**
     * Send a message to the defender process
     */
    sendMessage(messageType: string, data: any): void {
        if (!this.process) {
            this.logger.warn(`Cannot send message ${messageType}, defender process not available`);
            return;
        }

        try {
            this.process.postMessage({ type: messageType, data });
            this.logger.debug(`Sent message to defender process: ${messageType}`);
        } catch (error) {
            this.logger.error(`Failed to send message ${messageType} to defender process:`, error);
        }
    }

    /**
     * Discover tools for an SSE server by querying the server directly
     * @param appName Application name
     * @param serverName Server name
     * @param targetUrl Original server URL to query for tools
     */
    discoverServerTools(appName: string, serverName: string, targetUrl: string): void {
        this.logger.info(`Initiating tool discovery for ${appName}/${serverName} at ${targetUrl}`);

        if (!this.process) {
            this.logger.error(`Cannot discover tools: Defender process not available`);
            return;
        }

        // Send message to defender process to perform discovery
        this.sendMessage('defender-server:discover-tools', {
            appName,
            serverName,
            targetUrl
        });
    }

    /**
     * Handle a security alert request from the defender process
     */
    private async handleSecurityAlert(request: SecurityAlertRequest): Promise<void> {
        try {
            this.logger.info(`Received security alert request: ${request.requestId}`);

            // Show the security alert dialog to the user
            const allowed = await showSecurityViolationAlert(request.scanResult);

            // Send the response back to the defender process
            const response: SecurityAlertResponse = {
                requestId: request.requestId,
                allowed
            };

            // Send the response back to the defender process
            if (this.process) {
                this.process.postMessage({
                    type: DefenderServiceEvent.SECURITY_ALERT_RESPONSE,
                    data: response
                });
                this.logger.info(`Sent security alert response: ${request.requestId}, allowed=${allowed}`);
            } else {
                this.logger.error('Cannot respond to security alert: Defender process not available');
            }
        } catch (error) {
            this.logger.error('Error handling security alert:', error);

            // Send a default 'block' response in case of error
            if (this.process) {
                this.process.postMessage({
                    type: DefenderServiceEvent.SECURITY_ALERT_RESPONSE,
                    data: {
                        requestId: request.requestId,
                        allowed: false
                    } as SecurityAlertResponse
                });
            }
        }
    }

    /**
     * Set up message handlers for the defender process
     */
    private setupProcessHandlers(): void {
        if (!this.process) return;

        // Handle messages from the utility process
        this.process.on('message', (message) => {
            if (!message || !message.type) {
                this.logger.warn('Received invalid message from defender process:', message);
                return;
            }

            this.logger.debug('Received message from defender process:', message.type);

            switch (message.type) {
                case DefenderServerEvent.TOOLS_UPDATE:
                    // Forward
                    this.logger.info('Received tools update from defender-server:', message.data);
                    this.emit(DefenderServiceEvent.TOOLS_UPDATE, message.data);
                    break;

                case DefenderServerEvent.TOOLS_DISCOVERY_COMPLETE:
                    // Forward discovery completion event
                    this.logger.info('Tool discovery completed:', message.data);
                    this.emit(DefenderServiceEvent.TOOLS_DISCOVERY_COMPLETE, message.data);
                    break;

                case DefenderServerEvent.STATUS:
                    const previousStatus = this.state.status;
                    this.updateState({
                        status: message.data.status,
                        error: message.data.error
                    });

                    // If defender has just started successfully, notify listeners
                    if (previousStatus === DefenderStatus.starting &&
                        this.state.status === DefenderStatus.running) {

                        this.logger.info('Defender process started successfully');

                        this.emit(DefenderServiceEvent.READY, this.state);
                    } else if (this.state.status === DefenderStatus.error) {
                        this.logger.error('Defender process failed to start');

                    }
                    break;

                case DefenderServerEvent.SCAN_RESULT:
                    this.logger.info('Received scan result from defender-server');

                    // Convert defender scan result to the format expected by scan service
                    const defenderScanResult = message.data as ScanServiceResult;


                    // Add to scan service
                    const serviceManager = ServiceManager.getInstance();
                    serviceManager.scanService.addScanResult(defenderScanResult);
                    break;

                case 'defender-process:tools-update':
                    const toolsData = message.data;
                    this.logger.info(`Received tools update for ${toolsData.appName}/${toolsData.serverName}`);
                    this.emit(DefenderServiceEvent.TOOLS_UPDATE, toolsData);
                    break;

                case DefenderServerEvent.SHOW_SECURITY_ALERT:
                    this.handleSecurityAlert(message.data);
                    break;

                default:
                    this.logger.warn('Unhandled message type from defender process:', message.type);
            }
        });
    }

    /**
     * Update the defender state and emit events
     */
    private updateState(newState: Partial<DefenderState>): void {
        const previousState = { ...this.state };
        this.state = { ...this.state, ...newState };

        // Log state changes
        if (previousState.status !== this.state.status) {
            this.logger.info(`Defender state changed: ${previousState.status} -> ${this.state.status}`);
        }

        // Emit state change event
        this.emit(DefenderServiceEvent.STATUS, this.state);

        // Forward state update to all windows
        const windows = BrowserWindow.getAllWindows();
        for (const window of windows) {
            if (window.webContents) {
                window.webContents.send(DefenderServiceEvent.STATUS, this.state);
            }
        }
    }

    async showDefenderErrorDialog(errorMessage: string) {
        await showCriticalErrorDialog(
            'Defender Error',
            'Failed to start protection',
            `Please re-try starting the defender. If the problem persists, contact support. Error: ${errorMessage}`,
            {
                buttons: ['Retry', 'Quit'],
                actions: [
                    // Retry action
                    () => {
                        console.log('User chose to retry starting defender');
                        this.shutdownProcess();
                        this.startProcess();
                    },
                    // Quit action
                    () => {
                        console.log('User chose to quit the application');
                        app.quit();
                    }
                ]
            }
        );
    }

}