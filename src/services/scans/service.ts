import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { BaseService, ServiceEvent } from '../base-service';
import { ScanResult, ScanEventType } from './types';

// Constants
const MAX_SCAN_RESULTS = 500;
const SCAN_RESULTS_FILE = path.join(app.getPath('userData'), 'scan-results.json');

/**
 * Scan Service
 * 
 * Manages storage and retrieval of scan results, handling persistence to disk
 * and providing an API for accessing and adding scan results.
 */
export class ScanService extends BaseService {
    // In-memory cache of scan results
    private scanResults: ScanResult[] = [];

    // Storage for temporary scan results (e.g., for security alerts)
    private temporaryScans: Map<string, ScanResult> = new Map();

    // Flag to track if scan results have been loaded
    private isInitialized: boolean = false;

    /**
     * Create a new scan service
     */
    constructor() {
        super('ScanService');
    }

    /**
     * Start the scan service
     * Loads scan results from disk
     */
    start(): boolean {
        if (!super.start()) return false;

        this.logger.info('Starting scan service');

        // Initialize scan results
        this.initScanResults().catch(error => {
            this.logger.error('Failed to initialize scan results', error);
        });

        return true;
    }

    /**
     * Initialize scan results by loading from disk
     */
    private async initScanResults(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            if (fs.existsSync(SCAN_RESULTS_FILE)) {
                const data = fs.readFileSync(SCAN_RESULTS_FILE, 'utf8');
                this.scanResults = JSON.parse(data);
                this.logger.info(`Loaded ${this.scanResults.length} scan results from ${SCAN_RESULTS_FILE}`);

                // Convert string dates back to Date objects
                this.scanResults.forEach(result => {
                    if (typeof result.date === 'string') {
                        result.date = new Date(result.date);
                    }
                });
            } else {
                this.logger.info('No scan results file found. Starting with empty scan history.');
                this.scanResults = [];
            }
        } catch (error) {
            this.logger.error('Failed to load scan results:', error);
            this.scanResults = [];
        }

        this.isInitialized = true;
    }

    /**
     * Get the current scan results
     */
    getScanResults(): ScanResult[] {
        // Ensure results are initialized
        if (!this.isInitialized) {
            this.logger.warn('Accessing scan results before initialization. Results may be incomplete.');
        }
        return [...this.scanResults]; // Return a copy to prevent direct modification
    }

    /**
     * Get a scan result by ID
     * @param id The ID of the scan to retrieve
     * @returns The scan result or null if not found
     */
    getScanById(id: string): ScanResult | null {
        // Ensure results are initialized
        if (!this.isInitialized) {
            this.logger.warn('Accessing scan by ID before initialization. Results may be incomplete.');
        }
        const scan = this.scanResults.find(scan => scan.id === id);
        return scan || null;
    }

    /**
     * Add a new scan result
     * @param result The scan result to add
     */
    addScanResult(result: ScanResult): ScanResult[] {
        // Ensure initialization
        if (!this.isInitialized) {
            this.logger.warn('Adding scan result before initialization.');
        }

        // If the result has an ID, check if it's an update to an existing result
        if (result.id) {
            const existingIndex = this.scanResults.findIndex(scan => scan.id === result.id);
            if (existingIndex !== -1) {
                // Update the existing scan result
                this.logger.info(`Updating existing scan result with ID: ${result.id}`);
                this.scanResults[existingIndex] = result;

                // Emit update event
                this.emit(ScanEventType.SCAN_RESULT_UPDATED, result);

                // Save to disk asynchronously
                this.saveScanResultsAsync().catch(error => {
                    this.logger.error('Failed to save scan results:', error);
                });

                return [...this.scanResults]; // Return a copy of the updated results
            }
        }

        // Add new result at the beginning (most recent first)
        this.scanResults.unshift(result);

        // Emit add event
        this.emit(ScanEventType.SCAN_RESULT_ADDED, result);

        // Limit to MAX_SCAN_RESULTS
        if (this.scanResults.length > MAX_SCAN_RESULTS) {
            this.scanResults = this.scanResults.slice(0, MAX_SCAN_RESULTS);
        }

        // Save to disk asynchronously
        this.saveScanResultsAsync().catch(error => {
            this.logger.error('Failed to save scan results:', error);
        });

        return [...this.scanResults]; // Return a copy of the updated results
    }

    /**
     * Save scan results to disk asynchronously
     */
    private async saveScanResultsAsync(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                fs.writeFile(
                    SCAN_RESULTS_FILE,
                    JSON.stringify(this.scanResults, null, 2),
                    'utf8',
                    (err) => {
                        if (err) {
                            this.logger.error('Error writing scan results file:', err);
                            reject(err);
                        } else {
                            this.logger.info(`Saved ${this.scanResults.length} scan results to file`);
                            resolve();
                        }
                    }
                );
            } catch (error) {
                this.logger.error('Failed to save scan results:', error);
                reject(error);
            }
        });
    }

    /**
     * Add a temporary scan result (used for security alerts)
     * @param scanId Unique ID for the scan
     * @param scanResult The scan result to store temporarily
     */
    public addTemporaryScan(scanId: string, scanResult: ScanResult): void {
        this.temporaryScans.set(scanId, scanResult);
        this.logger.info(`Added temporary scan with ID: ${scanId}`);
    }

    /**
     * Get a temporary scan result by ID
     * @param scanId ID of the scan to retrieve
     * @returns The scan result or null if not found
     */
    public getTemporaryScanById(scanId: string): ScanResult | null {
        return this.temporaryScans.get(scanId) || null;
    }

    /**
     * Remove a temporary scan result
     * @param scanId ID of the scan to remove
     */
    public removeTemporaryScan(scanId: string): void {
        this.temporaryScans.delete(scanId);
        this.logger.info(`Removed temporary scan with ID: ${scanId}`);
    }
}