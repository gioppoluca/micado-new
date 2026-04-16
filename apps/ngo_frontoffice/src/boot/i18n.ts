import { defineBoot } from '#q-app/wrappers';
import { createI18n } from 'vue-i18n';

import messages from 'src/i18n';

export type MessageLanguages = keyof typeof messages;
// Type-define 'en-US' as the master schema for the resource
export type MessageSchema = (typeof messages)['en-US'];

// See https://vue-i18n.intlify.dev/guide/advanced/typescript.html#global-resource-schema-type-definition
/* eslint-disable @typescript-eslint/no-empty-object-type */
declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema { }
  export interface DefineDateTimeFormat { }
  export interface DefineNumberFormat { }
}
/* eslint-enable @typescript-eslint/no-empty-object-type */

// Export the instance so non-component code (boot files, stores) can import
// it directly.  With legacy: false, vue-i18n does NOT register $i18n on
// globalProperties, so importing this named export is the correct pattern.
//
// No explicit generics are passed to createI18n.  The return type of
// createI18n is resolved via a conditional: `(typeof options)['legacy'] extends
// false`.  When explicit generics are supplied they can force an overload
// whose Legacy parameter defaults to `true`, causing i18n.global to be typed
// as VueI18n (legacy) instead of Composer — and Composer.locale is
// WritableComputedRef<string>, whereas VueI18n.locale is a plain string.
// Passing no generics lets TypeScript infer Legacy=false from the options
// literal and correctly type global.locale as WritableComputedRef<string>.
export const i18n = createI18n({
  locale: 'en-US',
  legacy: false,
  messages,
});

export default defineBoot(({ app }) => {
  app.use(i18n);
});