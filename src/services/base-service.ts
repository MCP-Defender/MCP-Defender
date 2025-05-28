import { EventEmitter } from 'events';
import { createLogger, Logger, LogLevel } from '../utils/logger';

/**
 * Global event bus for inter-service communication
 * Services can subscribe to and publish events without direct dependencies
 */
export const ServiceEventBus = new EventEmitter();

/**
 * Event names for service communication
 */
export enum ServiceEvent {
    // Settings events
    SETTINGS_UPDATED = 'settings-updated',

    // Signatures events
    SIGNATURES_UPDATED = 'signatures-updated',

    // Configurations events
    CONFIGURATIONS_UPDATED = 'configurations-updated',

    // Defender events
    DEFENDER_READY = 'defender-ready',
}

/**
 * Base class for all services
 * Provides common functionality for service lifecycle and event handling
 */
export abstract class BaseService extends EventEmitter {
    protected readonly name: string;
    protected logger: Logger;
    protected isRunning: boolean = false;

    /**
     * Create a new service
     * @param name The service name, used for logging and event identification
     */
    constructor(name: string) {
        super();
        this.name = name;
        this.logger = createLogger(name);
    }

    /**
     * Start the service
     * This should be overridden by subclasses to implement service-specific startup logic
     */
    start(): boolean {
        if (this.isRunning) {
            this.logger.warn('Service already running');
            return false;
        }

        this.logger.info('Starting service');
        this.isRunning = true;
        return true;
    }

    /**
     * Stop the service
     * This should be overridden by subclasses to implement service-specific shutdown logic
     * Supports both synchronous and asynchronous implementations
     */
    stop(): Promise<boolean> | boolean {
        if (!this.isRunning) {
            this.logger.warn('Service not running');
            return false;
        }

        this.logger.info('Stopping service');
        this.isRunning = false;
        return true;
    }

    /**
     * Set the log level
     * @param level The minimum log level to display
     */
    setLogLevel(level: LogLevel): void {
        this.logger.setLevel(level);
    }

    /**
     * Publish an event to the service event bus
     * @param eventName The name of the event
     * @param data The data to send with the event
     */
    protected publishEvent(eventName: string, data?: any): void {
        this.logger.debug(`Publishing event: ${eventName}`);
        ServiceEventBus.emit(eventName, data);
    }

    /**
     * Subscribe to an event on the service event bus
     * @param eventName The name of the event
     * @param handler The handler function to call when the event is triggered
     */
    protected subscribeToEvent(eventName: string, handler: (data?: any) => void): void {
        this.logger.debug(`Subscribing to event: ${eventName}`);
        ServiceEventBus.on(eventName, handler);
    }

    /**
     * Unsubscribe from an event on the service event bus
     * @param eventName The name of the event
     * @param handler The handler function to remove
     */
    protected unsubscribeFromEvent(eventName: string, handler: (data?: any) => void): void {
        this.logger.debug(`Unsubscribing from event: ${eventName}`);
        ServiceEventBus.off(eventName, handler);
    }
} 