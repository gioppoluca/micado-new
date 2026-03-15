// src/features/feature-flipping/service.ts
//
// Plain module — no Vue dependency, no Pinia.
// Holds the runtime list of enabled flag keys loaded at boot.

let enabledFeatures: string[] = [];

/**
 * Returns true if the given flag key is currently enabled.
 * @param key      The flag key, e.g. 'CHATBOT'
 * @param fallback Value returned before setEnabledFeatures() has been called
 */
export function isEnabled(key: string, fallback = false): boolean {
    return enabledFeatures.length === 0 ? fallback : enabledFeatures.includes(key);
}

export function setEnabledFeatures(features: string[]): void {
    enabledFeatures = features ?? [];
}