// Add a map to store temporary scans
private temporaryScans: Map<string, ScanResult> = new Map();

/**
 * Add a temporary scan result (used for security alerts)
 * @param scanId Unique ID for the scan
 * @param scanResult The scan result to store temporarily
 */
public addTemporaryScan(scanId: string, scanResult: ScanResult): void {
    this.temporaryScans.set(scanId, scanResult);
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
} 