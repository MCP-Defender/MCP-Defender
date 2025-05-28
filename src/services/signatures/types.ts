/**
 * Represents a signature used to verify MCP tool calls
 */
export interface Signature {
    /** Unique identifier for the signature */
    id: string;

    /** Human-readable name */
    name: string;

    /** Description of what this signature verifies */
    description: string;

    /** The prompt given to the LLM for evaluation */
    prompt: string;

    /** Category of the signature */
    category: string;

    /** Optional metadata for the signature */
    metadata?: Record<string, any>;
}
