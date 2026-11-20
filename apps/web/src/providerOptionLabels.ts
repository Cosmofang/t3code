import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { msg } from "gt-react";

import type { MessageResolver } from "./i18n/messages";

// Providers send their model options with English labels. The common ones show in the UI
// language; model-specific names (Ultrathink, Ultracode, 1M) stay as sent. "Fast" and
// "Ultrafast" stay too, because the trait summary finds Codex speed tiers by those labels.
const OPTION_NAMES: Readonly<Record<string, string>> = {
  Reasoning: msg("Reasoning", { $context: "model option name" }),
  Effort: msg("Effort", { $context: "model option name" }),
  Thinking: msg("Thinking", { $context: "model option name" }),
  "Fast Mode": msg("Fast Mode", { $context: "model option name" }),
  "Context Window": msg("Context Window", { $context: "model option name" }),
  "Service Tier": msg("Service Tier", { $context: "model option name" }),
  Speed: msg("Speed", { $context: "model option name" }),
  Agent: msg("Agent", { $context: "model option name" }),
  Mode: msg("Mode", { $context: "model option name" }),
};

const OPTION_CHOICES: Readonly<Record<string, string>> = {
  Default: msg("Default", { $context: "the default option in a list" }),
  Off: msg("Off", { $context: "reasoning level" }),
  Minimal: msg("Minimal", { $context: "reasoning level" }),
  Low: msg("Low", { $context: "reasoning level" }),
  Medium: msg("Medium", { $context: "reasoning level" }),
  High: msg("High", { $context: "reasoning level" }),
  "Extra High": msg("Extra High", { $context: "reasoning level" }),
  Max: msg("Max", { $context: "reasoning level" }),
  Standard: msg("Standard", { $context: "speed tier" }),
  Build: msg("Build", { $context: "OpenCode agent name" }),
  Plan: msg("Plan", { $context: "OpenCode agent name" }),
};

const OPTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "xhigh effort plus multi-agent workflow orchestration": msg(
    "xhigh effort plus multi-agent workflow orchestration",
    { $context: "description of Claude's Ultracode option" },
  ),
  "Even faster, more expensive": msg("Even faster, more expensive", {
    $context: "description of the Ultrafast speed tier",
  }),
};

function lookup(
  table: Readonly<Record<string, string>>,
  text: string,
  resolve: MessageResolver,
): string {
  return Object.hasOwn(table, text) ? resolve(table[text]!) : text;
}

function withDescription<T extends { readonly description?: string | undefined }>(
  entry: T,
  resolve: MessageResolver,
): T {
  return entry.description === undefined
    ? entry
    : { ...entry, description: lookup(OPTION_DESCRIPTIONS, entry.description, resolve) };
}

/** Shows the provider's option labels in the UI language; ids and values are untouched. */
export function localizeProviderOptionDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  resolve: MessageResolver,
): Array<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) => {
    const label = lookup(OPTION_NAMES, descriptor.label, resolve);
    if (descriptor.type === "boolean") return withDescription({ ...descriptor, label }, resolve);
    return withDescription(
      {
        ...descriptor,
        label,
        options: descriptor.options.map((option) =>
          withDescription(
            { ...option, label: lookup(OPTION_CHOICES, option.label, resolve) },
            resolve,
          ),
        ),
      },
      resolve,
    );
  });
}
