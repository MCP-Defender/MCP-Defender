import React from 'react';
import { AppNameToIconPath, getAppInitials } from '@/utils/icons';
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
    // Size mapping
    const sizeClass = {
        'sm': 'h-6 w-6',
        'md': 'h-8 w-8',
        'lg': 'h-10 w-10'
    }[size];

    // Determine the icon source
    const iconPath = AppNameToIconPath[appName];

    // Get initials for fallback
    const initials = getAppInitials(appName);

    return (
        <Avatar className={`${sizeClass} ${className}`}>
            {/* Always use either the custom icon or our default/app-specific icon */}

            {iconPath ? (
                <AvatarImage src={iconPath} />
            ) : (
                <AvatarFallback>{initials}</AvatarFallback>
            )}
        </Avatar>
    );
} 