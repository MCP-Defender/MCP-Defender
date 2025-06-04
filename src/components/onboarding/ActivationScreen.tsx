import React from "react";
import { CheckCircle, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ActivationScreenProps {
    email: string;
    onActivate: () => void;
    isLoading?: boolean;
}

export function ActivationScreen({ email, onActivate, isLoading = false }: ActivationScreenProps) {
    const handleActivate = () => {
        if (isLoading) return;
        toast.info("Completing setup...");
        onActivate();
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen max-w-md mx-auto p-6 space-y-8">
            {/* Header Section */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Email Verified</h1>
            </div>

            {/* Main Icon */}
            <div className="flex justify-center py-8">
                <div className="relative">
                    <div className="absolute inset-0 bg-green-500/10 rounded-full blur-lg"></div>
                    <div className="relative bg-gradient-to-b from-background to-background/80 p-6 rounded-full border border-border">
                        <CheckCircle className="h-16 w-16 text-green-500" />
                    </div>
                </div>
            </div>

            {/* Message */}
            <div className="text-center">
                <p className="leading-relaxed">
                    Your email has been verified successfully.
                </p>
            </div>

            {/* Continue Button */}
            <Button
                size="lg"
                className="w-full mt-6"
                onClick={handleActivate}
                disabled={isLoading}
            >
                {isLoading ? (
                    <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Setting up...
                    </>
                ) : (
                    <>
                        Start MCP Defender
                        <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                )}
            </Button>
        </div>
    );
} 