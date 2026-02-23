import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const candidateTs = path.join(root, "src", `${relative}.ts`);
    const candidateTsx = path.join(root, "src", `${relative}.tsx`);
    const candidateIndexTs = path.join(root, "src", relative, "index.ts");
    const candidateIndexTsx = path.join(root, "src", relative, "index.tsx");

    if (existsSync(candidateTs)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidateTs).href,
      };
    }

    if (existsSync(candidateTsx)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidateTsx).href,
      };
    }

    if (existsSync(candidateIndexTs)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidateIndexTs).href,
      };
    }

    if (existsSync(candidateIndexTsx)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidateIndexTsx).href,
      };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
