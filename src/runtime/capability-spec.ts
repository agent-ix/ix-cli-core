/**
 * Built-in capability ids known to v1 of the runtime. Plugins MAY
 * introduce additional capability ids by passing custom providers to
 * `createCapabilityResolver`; the type parameter is intentionally
 * widened to `string` in those positions.
 */
export type BuiltInCapabilityId = "github" | "ix-api" | "review-service";

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
