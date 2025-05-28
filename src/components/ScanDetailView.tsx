import React, { useState, useEffect } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/ui/app-icon";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    ShieldCheck,
    AlertTriangle,
    Clock,
    Check,
    X,
    ArrowUp,
    ArrowDown
} from "lucide-react";
import { ScanResult, SignatureVerification } from "@/services/scans/types";

// Component for the scan detail view in a new window
export default function ScanDetailView() {
    const [scan, setScan] = useState<ScanResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Fetch the scan ID from the URL
        const hash = window.location.hash;
        const scanId = hash.replace(/^#\/scan-detail\//, '');

        if (!scanId) {
            setError("Scan ID not found in URL");
            setIsLoading(false);
            return;
        }

        // Fetch scan details using the scan ID
        if (window.scanAPI) {
            window.scanAPI.getScanById(scanId)
                .then((result: ScanResult | null) => {
                    if (result) {
                        setScan(result);
                    } else {
                        setError(`Scan with ID ${scanId} not found`);
                    }
                    setIsLoading(false);
                })
                .catch((err: Error) => {
                    console.error("Error fetching scan details:", err);
                    setError("Failed to load scan details");
                    setIsLoading(false);
                });
        } else {
            setError("Scan API not available");
            setIsLoading(false);
        }
    }, []);

    // Format date for display (full)
    const formatDate = (date: Date) => {
        if (!(date instanceof Date)) {
            // Convert string date to Date object if needed
            date = new Date(date);
        }

        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }).format(date);
    };

    // Format scan time for display (convert ms to readable format)
    const formatScanTime = (scanTimeMs: number) => {
        if (scanTimeMs < 1000) {
            return `${scanTimeMs}ms`;
        } else {
            return `${(scanTimeMs / 1000).toFixed(2)}s`;
        }
    };

    // Extract all signature verifications from the map for display
    const extractSignatureVerifications = (scan: ScanResult): SignatureVerification[] => {
        if (!scan || !scan.signatureVerifications) return [];

        const verifications: SignatureVerification[] = [];

        // Iterate through each signature ID
        Object.keys(scan.signatureVerifications).forEach(signatureId => {
            // For each signature ID, iterate through model verifications
            const modelVerifications = scan.signatureVerifications[signatureId];
            Object.keys(modelVerifications).forEach(modelName => {
                verifications.push(modelVerifications[modelName]);
            });
        });

        return verifications;
    };

    // Show loading state
    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="animate-spin text-2xl">⟳</div>
                <span className="ml-2">Loading scan details...</span>
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Card className="w-[600px]">
                    <CardHeader>
                        <CardTitle className="text-red-500 flex items-center gap-2">
                            <AlertTriangle />
                            Error Loading Scan
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>{error}</p>
                        <Button
                            className="mt-4"
                            onClick={() => window.close()}
                        >
                            Close Window
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Show scan not found state
    if (!scan) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Card className="w-[600px]">
                    <CardHeader>
                        <CardTitle className="text-yellow-500 flex items-center gap-2">
                            <AlertTriangle />
                            Scan Not Found
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>The requested scan could not be found.</p>
                        <Button
                            className="mt-4"
                            onClick={() => window.close()}
                        >
                            Close Window
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-5xl mx-auto">
            {/* Header with status */}
            <div className="flex items-center gap-3 mb-6">
                {!scan.allowed ? (
                    <AlertTriangle className="h-8 w-8 text-red-500" />
                ) : (
                    <ShieldCheck className="h-8 w-8 text-green-500" />
                )}
                <div>
                    <h1 className="text-2xl font-bold">
                        {scan.allowed ? "Allowed" : "Blocked"} Tool {scan.isResponse ? "Response" : "Call"}
                    </h1>
                    <h2 className="text-xl font-mono text-muted-foreground">
                        {scan.toolName}
                    </h2>
                </div>
            </div>

            {/* Application and server info */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="text-lg">Overview</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <h3 className="font-medium mb-2">Application</h3>
                            <div className="flex items-center gap-2">
                                <AppIcon appName={scan.appName} />
                                <span>{scan.appName}</span>
                            </div>
                        </div>
                        <div>
                            <h3 className="font-medium mb-2">Server</h3>
                            <div>
                                <div>{scan.serverName}</div>
                                {scan.serverVersion && (
                                    <div className="text-sm text-muted-foreground">v{scan.serverVersion}</div>
                                )}
                            </div>
                        </div>
                        <div>
                            <h3 className="font-medium mb-2">Date/Time</h3>
                            <div className="text-sm">{formatDate(scan.date)}</div>
                            {scan.scanTime && (
                                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    <span>Scan time: {formatScanTime(scan.scanTime)}</span>
                                </div>
                            )}
                        </div>
                        <div>
                            <h3 className="font-medium mb-2">Type</h3>
                            <div className="flex items-center gap-1.5">
                                {scan.isResponse ? (
                                    <>
                                        <ArrowDown className="h-4 w-4" />
                                        <span>Response</span>
                                    </>
                                ) : (
                                    <>
                                        <ArrowUp className="h-4 w-4" />
                                        <span>Request</span>
                                    </>
                                )}
                            </div>
                            <div className="mt-1">
                                <Badge variant={scan.allowed ? "success" : "destructive"}>
                                    {scan.allowed ? "Allowed" : "Blocked"}
                                </Badge>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Tool arguments */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="text-lg">Tool Arguments</CardTitle>
                </CardHeader>
                <CardContent>
                    <pre className="text-sm overflow-auto max-h-[300px] bg-muted p-4 rounded-md font-mono whitespace-pre-wrap break-words">
                        {scan.toolArgs}
                    </pre>
                </CardContent>
            </Card>

            {/* Signature verifications */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Signature Verifications</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[200px]">Signature</TableHead>
                                    <TableHead className="w-[120px]">Model</TableHead>
                                    <TableHead className="w-[100px]">Result</TableHead>
                                    <TableHead>Reason</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {extractSignatureVerifications(scan).map((verification, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell className="font-medium">
                                            {verification.signatureName}
                                            <div className="text-xs text-muted-foreground">
                                                ID: {verification.signatureId}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {verification.modelName || "Unknown"}
                                        </TableCell>
                                        <TableCell>
                                            {verification.allowed ? (
                                                <div className="flex items-center gap-1 text-green-500 font-medium">
                                                    <Check className="h-4 w-4" />
                                                    Allowed
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1 text-red-500 font-medium">
                                                    <X className="h-4 w-4" />
                                                    Blocked
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[400px]">
                                            <div className="whitespace-normal break-words">
                                                {verification.reason}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Actions */}
            <div className="mt-6 flex justify-end">
                <Button
                    onClick={() => window.close()}
                    className="mr-2"
                >
                    Close
                </Button>
            </div>
        </div>
    );
} 