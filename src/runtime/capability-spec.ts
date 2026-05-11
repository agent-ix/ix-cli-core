import type { BuiltInCapabilityId } from "./capabilities.js";

/**
 * Type describing a command's capability requirements. Commands extending
 * `BaseCommand` set this as a static field:
 *
 * ```ts
 * static capabilities: CommandCapabilities = {
 *   required: ['github'],
 *   optional: ['ix-api'],
 * };
 * ```
 *
 * See FR-024.
 */
export interface CommandCapabilities {
  required?: readonly BuiltInCapabilityId[];
  optional?: readonly BuiltInCapabilityId[];
}
