/**
 * Base interface for all signature types
 */
interface BaseSignature {
    /** Unique identifier for the signature */
    id: string;

    /** Human-readable name */
    name: string;

    /** Description of what this signature verifies */
    description: string;

    /** Category of the signature */
    category: string;

    /** Optional metadata for the signature */
    metadata?: Record<string, any>;
}

/**
 * LLM-based signature that uses a prompt for AI evaluation
 */
export interface LLMSignature extends BaseSignature {
    /** Signature type discriminator */
    type: 'llm';

    /** The prompt given to the LLM for evaluation */
    prompt: string;
}

/**
 * Deterministic signature that uses a JavaScript function for evaluation
 */
export interface DeterministicSignature extends BaseSignature {
    /** Signature type discriminator */
    type: 'deterministic';

    /** Reference to the JavaScript function file (e.g., "ssh-key-detector.js") */
    functionFile: string;
}

/**
 * Union type representing all possible signature types
 */
export type Signature = LLMSignature | DeterministicSignature;

/**
 * Type guard to check if a signature is an LLM signature
 */
export function isLLMSignature(signature: Signature): signature is LLMSignature {
    return signature.type === 'llm';
}

/**
 * Type guard to check if a signature is a deterministic signature
 */
export function isDeterministicSignature(signature: Signature): signature is DeterministicSignature {
    return signature.type === 'deterministic';
}
