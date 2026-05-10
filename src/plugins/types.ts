import type { ZodObject, ZodRawShape } from "zod";

import type { SecretDeclaration } from "../secrets/types.js";

export type IxCapabilityMode = "required" | "optional";

export interface IxCapabilityDeclaration {
  id: string;
  mode: IxCapabilityMode;
  description?: string;
}

export interface IxCommandRegistration {
  id: string;
  topic: string[];
  summary: string;
  requiredCapabilities?: string[];
}

export interface IxPlugin {
  id: string;
  configSchema?: ZodObject<ZodRawShape>;
  envBindings?: Record<string, string>;
  secretsSchema?: SecretDeclaration[];
  commands?: IxCommandRegistration[];
  capabilities?: IxCapabilityDeclaration[];
}

export interface RegisteredIxPlugin {
  id: string;
  commands: IxCommandRegistration[];
  capabilities: IxCapabilityDeclaration[];
}
