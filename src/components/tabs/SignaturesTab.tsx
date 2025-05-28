import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FolderOpen, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { SignaturesTable } from "../signatures/SignaturesTable"
import { toast } from "sonner"

export default function SignaturesTab() {
    // Handle opening signatures directory
    const handleOpenSignaturesDirectory = async () => {
        try {
            await window.settingsAPI.openSignaturesDirectory();
            toast.info("Signatures directory opened");
        } catch (error) {
            console.error('Failed to open signatures directory:', error);
            toast.error("Failed to open signatures directory");
        }
    };

    return (
        <div className="p-4">
            {/* Signatures Card */}
            <Card>
                <CardHeader>
                    <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                            <ShieldCheck className="h-6 w-6 text-primary mt-0.5" />
                            <div>
                                <CardTitle>Security Signatures</CardTitle>
                                <CardDescription>Manage and activate security signatures for MCP verification</CardDescription>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleOpenSignaturesDirectory}
                            className="flex items-center gap-2"
                        >
                            <FolderOpen size={16} />
                            Open Directory
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                        Select which signatures to use for tool call verification. All selected signatures will be
                        checked against tool calls and responses based on your verification mode.
                    </p>
                    <SignaturesTable />
                </CardContent>
            </Card>
        </div>
    )
} 