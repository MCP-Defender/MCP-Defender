import React, { useState, useEffect } from 'react';
import { getAppIconPath, getAppInitials } from '@/utils/icons';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface AppIconProps {
    appName: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

/**
 * Component for displaying application icons consistently
 * Handles fallbacks and different icon sources
 */
export function AppIcon({
    appName,
    size = 'md',
    className = ''
}: AppIconProps) {
    const [iconPath, setIconPath] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);

    // Size mapping
    const sizeClass = {
        'sm': 'h-6 w-6',
        'md': 'h-8 w-8',
        'lg': 'h-10 w-10'
    }[size];

    // Get initials for fallback
    const initials = getAppInitials(appName);

    // Load the icon path asynchronously
    useEffect(() => {
        let mounted = true;

        const loadIconPath = async () => {
            try {
                const resolvedPath = await getAppIconPath(appName);
                if (mounted) {
                    setIconPath(resolvedPath);
                    setIsLoading(false);
                }
            } catch (error) {
                console.error('Failed to load icon path for', appName, error);
                if (mounted) {
                    setIconPath(undefined);
                    setIsLoading(false);
                }
            }
        };

        loadIconPath();

        return () => {
            mounted = false;
        };
    }, [appName]);

    return (
        <Avatar className={`${sizeClass} ${className}`}>
            {/* Show icon if loaded and available, otherwise show fallback */}
            {!isLoading && iconPath ? (
                <AvatarImage src={iconPath} alt={`${appName} icon`} />
            ) : (
                <AvatarFallback>{initials}</AvatarFallback>
            )}
        </Avatar>
    );
} 