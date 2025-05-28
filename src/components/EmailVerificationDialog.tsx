import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Mail, RefreshCw } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { toast } from "sonner";

interface EmailVerificationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    email: string;
    onResendEmail: () => void;
}

export function EmailVerificationDialog({
    open,
    onOpenChange,
    email,
    onResendEmail,
}: EmailVerificationDialogProps) {
    const [canResend, setCanResend] = useState(false);
    const [countdown, setCountdown] = useState(30);
    const [isResending, setIsResending] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);

    // Set up countdown timer when dialog opens
    useEffect(() => {
        let timer: NodeJS.Timeout | null = null;

        if (open && !canResend) {
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

        // Reset state when dialog closes
        if (!open) {
            setCanResend(false);
            setCountdown(30);
            if (timer) clearInterval(timer);
        }

        // Cleanup
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [open, canResend]);

    // Set up periodic verification check
    useEffect(() => {
        let verificationTimer: NodeJS.Timeout | null = null;

        // Only check when dialog is open
        if (open) {
            // Initial check
            checkVerification();

            // Set up interval for periodic checks
            verificationTimer = setInterval(() => {
                checkVerification();
            }, 5000); // Check every 5 seconds
        }

        // Cleanup
        return () => {
            if (verificationTimer) clearInterval(verificationTimer);
        };
    }, [open]);

    // Function to check verification status
    const checkVerification = async () => {
        if (!open || isVerifying) return;

        try {
            setIsVerifying(true);
            const result = await window.accountAPI.verifyLogin();

            if (result.success) {
                // Verification succeeded, user has clicked the link
                console.log('Verification successful through polling!');
                toast.success('Login verified successfully');

                // Update local settings and close dialog
                const updatedSettings = await window.settingsAPI.getAll();

                // Close the dialog
                onOpenChange(false);
            }
        } catch (error) {
            console.error('Verification check error:', error);
        } finally {
            setIsVerifying(false);
        }
    };

    const handleResend = async () => {
        if (!canResend || isResending) return;

        setIsResending(true);
        try {
            await onResendEmail();
            toast.success("Verification email resent");
            // Reset the countdown and disable resend button
            setCanResend(false);
            setCountdown(30);
        } finally {
            setIsResending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Check Your Email</DialogTitle>
                    <DialogDescription>
                        We've sent a verification link to your email address
                    </DialogDescription>
                </DialogHeader>

                <div className="flex justify-center py-6">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/10 rounded-full blur-lg"></div>
                        <div className="relative bg-gradient-to-b from-background to-background/80 p-6 rounded-full border border-border">
                            <Mail className="h-12 w-12 text-primary" />
                        </div>
                    </div>
                </div>

                <div className="text-center mb-4">
                    <p className="leading-relaxed">
                        We've sent a login link to <span className="font-medium">{email}</span>.
                        <br />Click the link in the email to continue.
                    </p>
                </div>

                <Alert className="bg-muted/50 border border-border">
                    <AlertDescription className="text-sm">
                        The login link will expire in 15 minutes. If you don't see the email,
                        check your spam folder.
                    </AlertDescription>
                </Alert>

                <DialogFooter className="mt-4">
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
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
} 