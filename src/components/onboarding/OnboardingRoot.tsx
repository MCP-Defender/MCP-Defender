import React, { useState } from 'react';
import { WelcomeScreen } from './WelcomeScreen';
import { toast } from 'sonner';

// Enum for onboarding steps
enum OnboardingStep {
    Welcome,
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
    const [error, setError] = useState("");
    const [processStatus, setProcessStatus] = useState<ProcessStatus>(ProcessStatus.Idle);

    // No deep link listener needed anymore

    // Handler for completing onboarding
    const handleCompleteOnboarding = async () => {
        setProcessStatus(ProcessStatus.Processing);
        try {
            const result = await window.onboardingAPI.skipEmailOnboarding();
            if (!result.success) {
                setError("Failed to complete onboarding. Please try again.");
                setProcessStatus(ProcessStatus.Error);
                toast.error("Failed to complete onboarding");
            } else {
                setProcessStatus(ProcessStatus.Success);
                toast.success("Onboarding completed successfully");
            }
        } catch (error) {
            console.error("Error completing onboarding:", error);
            setError("An unexpected error occurred. Please try again.");
            setProcessStatus(ProcessStatus.Error);
            toast.error("An unexpected error occurred");
        }
    };

    // Render the current step
    switch (currentStep) {
        case OnboardingStep.Welcome:
            return (
                <WelcomeScreen
                    onContinue={handleCompleteOnboarding}
                />
            );

        case OnboardingStep.Error:
            // Show welcome screen with error message
            return (
                <WelcomeScreen
                    onContinue={handleCompleteOnboarding}
                />
            );

        default:
            return (
                <WelcomeScreen
                    onContinue={handleCompleteOnboarding}
                />
            );
    }
} 