import { resolve } from "node:path";

export interface RuntimeContext {
  configNamespace: string;
  configRoot?: string;
  projectConfigRoot?: string;
  projectConfigEnabled: boolean;
}

const defaultContext: RuntimeContext = {
  configNamespace: "ix",
  projectConfigEnabled: true,
};

let context: RuntimeContext = { ...defaultContext };

export function configureRuntimeContext(next: Partial<RuntimeContext>): void {
  context = {
    ...context,
    ...next,
    configRoot: next.configRoot ? resolve(next.configRoot) : next.configRoot,
    projectConfigRoot: next.projectConfigRoot
      ? resolve(next.projectConfigRoot)
      : next.projectConfigRoot,
  };
}

export function getRuntimeContext(): RuntimeContext {
  return { ...context };
}

export function resetRuntimeContext(): void {
  context = { ...defaultContext };
}
