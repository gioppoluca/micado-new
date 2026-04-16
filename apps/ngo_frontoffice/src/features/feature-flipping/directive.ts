// src/features/feature-flipping/directive.ts
import type { DirectiveBinding } from 'vue';
import { isEnabled } from './service';

export const featureFlippingDirective = {
    mounted(el: HTMLElement, binding: DirectiveBinding) {
        applyDirective(el, binding);
    },
    updated(el: HTMLElement, binding: DirectiveBinding) {
        applyDirective(el, binding);
    },
};

function applyDirective(el: HTMLElement, binding: DirectiveBinding) {
    switch (binding.arg) {
        case 'class': applyClass(el, binding); break;
        case 'style': applyStyle(el, binding); break;
        default: applyDOM(el, binding); break;
    }
}

function applyDOM(el: HTMLElement, binding: DirectiveBinding) {
    const key = binding.value as string;
    const { default: fallback = false, not = false } = binding.modifiers as Record<string, boolean>;

    if (not ? isEnabled(key, fallback) : !isEnabled(key, fallback)) {
        el.remove();
    }
}

function applyClass(el: HTMLElement, binding: DirectiveBinding) {
    const { key, value } = binding.value as { key: string; value: string | string[] };
    const { default: fallback = false, not = false } = binding.modifiers as Record<string, boolean>;

    if (not ? !isEnabled(key, fallback) : isEnabled(key, fallback)) {
        el.classList.add(...parseClasses(value));
    }
}

function applyStyle(el: HTMLElement, binding: DirectiveBinding) {
    const { key, value } = binding.value as { key: string; value: Record<string, string> };
    const { default: fallback = false, not = false } = binding.modifiers as Record<string, boolean>;

    if (not ? !isEnabled(key, fallback) : isEnabled(key, fallback)) {
        for (const [prop, val] of Object.entries(parseStyles(value))) {
            el.style.setProperty(prop, val);
        }
    }
}

function parseClasses(value: string | string[]): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flat();
    return [];
}

function parseStyles(value: Record<string, string> | Record<string, string>[]): Record<string, string> {
    if (Array.isArray(value)) return Object.assign({}, ...value);
    return value;
}