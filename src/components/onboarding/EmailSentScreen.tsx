import { Mail, ArrowLeft, RefreshCw, Link, CheckCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { useState, useEffect } from "react";
import { toast } from "sonner";

interface EmailSentScreenProps {
    email: string;
    verificationLink?: string;
    onEmailSubmit?: (email: string) => void;
    onBack?: () => void;
    onResendEmail: () => void;
    onVerificationSuccess?: () => void;
}

export function EmailSentScreen({
    email,
    verificationLink,
    onEmailSubmit,
    onBack,
    onResendEmail,
    onVerificationSuccess
}: EmailSentScreenProps) {
    const [canResend, setCanResend] = useState(false);
    const [countdown, setCountdown] = useState(30);
    const [isResending, setIsResending] = useState(false);
    const [isCheckingVerification, setIsCheckingVerification] = useState(false);
    const [isDevelopment, setIsDevelopment] = useState(false);

    // Check if we're in development mode
    useEffect(() => {
        // In development, we'll show the manual check button
        // We can detect this by checking if we're in a dev environment
        setIsDevelopment(process.env.NODE_ENV === 'development');
    }, []);

    // Set up countdown timer when component mounts
    useEffect(() => {
        let timer: NodeJS.Timeout | null = null;

        if (!canResend) {
            timer = setInterval(() => {
                setCountdown((prevCountdown) => {
                    if (prevCountdown <= 1) {
                        setCanResend(true);
                        if (timer) clearInterval(timer);
                        return 0;
                    }
                    return prevCountdown - 1;
                });
            }, 1000);
        }

        // Cleanup
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [canResend]);

    // Manual verification check function
    const handleManualVerificationCheck = async () => {
        if (isCheckingVerification) return;

        try {
            setIsCheckingVerification(true);
            toast.info("Checking verification status...");

            const result = await window.accountAPI.verifyLogin();

            if (result.success) {
                // Verification succeeded
                console.log('Manual verification check successful!');
                toast.success('Login verified successfully');

                // Call success handler if provided
                if (onVerificationSuccess) {
                    onVerificationSuccess();
                }
            } else {
                toast.info("Email not verified yet. Please check your email and click the verification link.");
            }
        } catch (error) {
            console.error('Manual verification check error:', error);
            toast.error("Failed to check verification status");
        } finally {
            setIsCheckingVerification(false);
        }
    };

    const handleResend = async () => {
        if (!canResend || isResending) return;

        setIsResending(true);
        toast.info("Resending verification email...");

        try {
            await onResendEmail();
            // Reset the countdown and disable resend button
            setCanResend(false);
            setCountdown(30);
            toast.success("Verification email resent successfully");
        } catch (error) {
            console.error("Failed to resend email:", error);
            toast.error("Failed to resend verification email");
        } finally {
            setIsResending(false);
        }
    };

    // Custom handler for verification link to avoid opening in a new window
    const handleVerificationLink = (e: React.MouseEvent) => {
        e.preventDefault();
        if (verificationLink) {
            // Use the app's protocol handler which will redirect to the app without opening a new window
            window.location.href = verificationLink;
            toast.info("Opening verification link...");
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen max-w-md mx-auto p-6 space-y-8">
            {/* Header Section */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Verify Email</h1>
            </div>

            {/* Email Info */}
            <div className="text-center">
                <p className="leading-relaxed">
                    We've sent a login link to <span className="font-medium">{email}</span>.
                    <br />Click the link in the email to finish setup.
                </p>
            </div>

            {/* Alert */}
            <Alert className="bg-muted/50 border border-border">
                <AlertDescription className="text-sm text-center">
                    If you don't see the email, check your spam folder.
                </AlertDescription>
            </Alert>

            {/* Action Buttons */}
            <div className="space-y-3 pt-2">
                {/* Manual verification check button (development only) */}
                {isDevelopment && (
                    <Button
                        variant="default"
                        className="w-full"
                        onClick={handleManualVerificationCheck}
                        disabled={isCheckingVerification}
                    >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        {isCheckingVerification ? "Checking..." : "Check Verification Status"}
                    </Button>
                )}

                <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleResend}
                    disabled={!canResend || isResending}
                >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {isResending
                        ? "Sending..."
                        : canResend
                            ? "Resend Email"
                            : `Resend Email (${countdown}s)`}
                </Button>

                {onBack && (
                    <div className="flex justify-center pt-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground flex items-center"
                            onClick={() => {
                                toast.info("Going back to email entry");
                                onBack();
                            }}
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
} 