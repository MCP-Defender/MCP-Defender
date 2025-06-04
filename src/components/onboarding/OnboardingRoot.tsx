import React, { useState, useEffect } from 'react';
import { WelcomeScreen } from './WelcomeScreen';
import { EmailScreen } from './EmailScreen';
import { EmailSentScreen } from './EmailSentScreen';
import { ActivationScreen } from './ActivationScreen';
import { toast } from 'sonner';

// Enum for onboarding steps
enum OnboardingStep {
    Welcome,
    Email,
    EmailSent,
    Activation,
    Error
}

// Enum for tracking the onboarding process status
enum ProcessStatus {
    Idle,
    Processing,
    Success,
    Error
}

export function OnboardingRoot() {
    // State
    const [currentStep, setCurrentStep] = useState(OnboardingStep.Welcome);
    const [email, setEmail] = useState("");
    const [error, setError] = useState("");
    const [processStatus, setProcessStatus] = useState<ProcessStatus>(ProcessStatus.Idle);

    // Listen for deep links
    useEffect(() => {
        const unsubscribe = window.accountAPI.onDeepLinkReceived(async (url) => {
            try {
                // Process the deep link
                setProcessStatus(ProcessStatus.Processing);
                const result = await window.accountAPI.processDeepLink(url);

                if (result.success) {
                    // Move to activation screen
                    setCurrentStep(OnboardingStep.Activation);
                    setProcessStatus(ProcessStatus.Success);
                } else {
                    console.error("Login verification failed:", result.error);
                    setError("Login verification failed. Please try again.");
                    setCurrentStep(OnboardingStep.Email);
                    setProcessStatus(ProcessStatus.Error);
                    toast.error("Email verification failed");
                }
            } catch (error) {
                console.error('Deep link processing error:', error);
                setError("An error occurred processing your login link. Please try again.");
                setCurrentStep(OnboardingStep.Email);
                setProcessStatus(ProcessStatus.Error);
                toast.error("Failed to process login link");
            }
        });

        return () => unsubscribe();
    }, []);

    // Handler for email submission
    const handleEmailSubmit = async (email: string) => {
        setEmail(email);
        setCurrentStep(OnboardingStep.EmailSent);
    };

    // Handler for resending email
    const handleResendEmail = async () => {
        if (!email) return;

        try {
            // Call the login API again with the same email
            const result = await window.accountAPI.login(email);

            if (!result.success) {
                console.error("Failed to resend login email", result.error);
                setError("Failed to resend login email. Please try again.");
                // Toast notification will be handled by EmailSentScreen component
            }
            return result.success;
        } catch (error) {
            console.error('Resend email error:', error);
            setError("An error occurred while resending the email. Please try again.");
            return false;
        }
    };

    // Handler for skipping email verification
    const handleSkipEmail = async () => {
        setProcessStatus(ProcessStatus.Processing);
        try {
            const result = await window.onboardingAPI.skipEmailOnboarding();
            if (!result.success) {
                setError("Failed to complete onboarding. Please try again.");
                setProcessStatus(ProcessStatus.Error);
                toast.error("Failed to complete onboarding");
            }
        } catch (error) {
            console.error("Error skipping email onboarding:", error);
            setError("An unexpected error occurred. Please try again.");
            setProcessStatus(ProcessStatus.Error);
            toast.error("An unexpected error occurred");
        }
    };

    // Handler for completing onboarding after email verification
    const handleCompleteOnboarding = async () => {
        setProcessStatus(ProcessStatus.Processing);
        try {
            const result = await window.onboardingAPI.completeLoginOnboarding();
            if (!result.success) {
                setError("Failed to complete onboarding. Please try again.");
                setCurrentStep(OnboardingStep.Email);
                setProcessStatus(ProcessStatus.Error);
                toast.error("Failed to complete onboarding");
            } else {
                setProcessStatus(ProcessStatus.Success);
                toast.success("Onboarding completed successfully");
            }
        } catch (error) {
            console.error("Error completing onboarding:", error);
            setError("An unexpected error occurred. Please try again.");
            setCurrentStep(OnboardingStep.Email);
            setProcessStatus(ProcessStatus.Error);
            toast.error("An unexpected error occurred");
        }
    };

    // Render the current step
    switch (currentStep) {
        case OnboardingStep.Welcome:
            return (
                <WelcomeScreen
                    onContinue={() => setCurrentStep(OnboardingStep.Email)}
                />
            );

        case OnboardingStep.Email:
            return (
                <EmailScreen
                    onEmailSubmit={handleEmailSubmit}
                    onSkipEmail={handleSkipEmail}
                    error={error}
                    email={email}
                    onBack={() => setCurrentStep(OnboardingStep.Welcome)}
                />
            );

        case OnboardingStep.EmailSent:
            return (
                <EmailSentScreen
                    email={email}
                    onBack={() => setCurrentStep(OnboardingStep.Email)}
                    onResendEmail={handleResendEmail}
                    onVerificationSuccess={() => {
                        // Move to activation screen just like when we receive a deep link
                        setCurrentStep(OnboardingStep.Activation);
                        setProcessStatus(ProcessStatus.Success);
                    }}
                />
            );

        case OnboardingStep.Activation:
            return (
                <ActivationScreen
                    email={email}
                    onActivate={handleCompleteOnboarding}
                    isLoading={processStatus === ProcessStatus.Processing}
                />
            );

        case OnboardingStep.Error:
            // This could be a dedicated error screen or handled within other screens
            return (
                <EmailScreen
                    onEmailSubmit={handleEmailSubmit}
                    onSkipEmail={handleSkipEmail}
                    error={error}
                    email={email}
                    onBack={() => setCurrentStep(OnboardingStep.Welcome)}
                />
            );

        default:
            return (
                <WelcomeScreen
                    onContinue={() => setCurrentStep(OnboardingStep.Email)}
                />
            );
    }
} 