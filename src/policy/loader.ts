import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createAirlockError, type PolicyFile } from "../types/index.js";
import { PolicyFileSchema } from "./schema.js";

const SUPPORTED_EXTENSIONS = new Set([".json", ".yaml", ".yml"]);
const require = createRequire(import.meta.url);

type YamlParser = (documentText: string) => unknown;

let cachedYamlParser: YamlParser | undefined;

const toValidationIssues = (issues: readonly { path: (string | number)[]; code: string; message: string }[]) => {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message
  }));
};

const resolveYamlParser = (policyPath: string): YamlParser => {
  if (cachedYamlParser !== undefined) {
    return cachedYamlParser;
  }

  try {
    const yamlModule = require("yaml") as { parse?: YamlParser };
    if (typeof yamlModule.parse !== "function") {
      throw new Error('The "yaml" package does not export a parse() function.');
    }

    cachedYamlParser = yamlModule.parse;
    return cachedYamlParser;
  } catch (error) {
    throw createAirlockError(
      "INVALID_INPUT",
      'YAML policy parsing requires the "yaml" package to be installed.',
      false,
      {
        path: policyPath,
        message: error instanceof Error ? error.message : String(error)
      }
    );
  }
};

const parsePolicyText = (rawText: string, extension: string, policyPath: string): unknown => {
  try {
    if (extension === ".json") {
      return JSON.parse(rawText) as unknown;
    }

    return resolveYamlParser(policyPath)(rawText);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }

    throw createAirlockError("INVALID_INPUT", `Failed to parse policy file "${policyPath}".`, false, {
      path: policyPath,
      parser: extension === ".json" ? "json" : "yaml",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

export const loadPolicyFile = async (policyPath: string): Promise<PolicyFile> => {
  if (policyPath.length === 0) {
    throw createAirlockError("INVALID_INPUT", "Policy file path cannot be empty.", false);
  }

  const extension = path.extname(policyPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw createAirlockError("INVALID_INPUT", `Unsupported policy file extension "${extension || "<none>"}".`, false, {
      path: policyPath,
      supportedExtensions: [...SUPPORTED_EXTENSIONS]
    });
  }

  const rawText = await readFile(policyPath, "utf8").catch((error: unknown) => {
    throw createAirlockError("INVALID_INPUT", `Unable to read policy file "${policyPath}".`, false, {
      path: policyPath,
      message: error instanceof Error ? error.message : String(error)
    });
  });

  const parsedDocument = parsePolicyText(rawText, extension, policyPath);
  const parsedPolicy = PolicyFileSchema.safeParse(parsedDocument);
  if (!parsedPolicy.success) {
    throw createAirlockError("INVALID_INPUT", `Invalid policy file "${policyPath}".`, false, {
      path: policyPath,
      issues: toValidationIssues(parsedPolicy.error.issues)
    });
  }

  return parsedPolicy.data as PolicyFile;
};
