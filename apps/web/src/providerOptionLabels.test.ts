import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { m, type MessageResolver } from "./i18n/messages";
import { localizeProviderOptionDescriptors } from "./providerOptionLabels";

// Marks every string that went through the catalog.
const resolve = ((message: string) => `«${m(message)}»`) as MessageResolver;

describe("localizeProviderOptionDescriptors", () => {
  it("translates known labels and leaves ids, values and model-specific names alone", () => {
    const descriptors: ReadonlyArray<ProviderOptionDescriptor> = [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        currentValue: "xhigh",
        options: [
          { id: "high", label: "High", isDefault: true },
          { id: "xhigh", label: "Extra High" },
          {
            id: "ultracode",
            label: "Ultracode",
            description: "xhigh effort plus multi-agent workflow orchestration",
          },
        ],
      },
      { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: true },
    ];
    expect(localizeProviderOptionDescriptors(descriptors, resolve)).toEqual([
      {
        id: "effort",
        label: "«Reasoning»",
        type: "select",
        currentValue: "xhigh",
        options: [
          { id: "high", label: "«High»", isDefault: true },
          { id: "xhigh", label: "«Extra High»" },
          {
            id: "ultracode",
            label: "Ultracode",
            description: "«xhigh effort plus multi-agent workflow orchestration»",
          },
        ],
      },
      { id: "fastMode", label: "«Fast Mode»", type: "boolean", currentValue: true },
    ]);
  });

  it("keeps the speed tier labels the trait summary matches on", () => {
    const [serviceTier] = localizeProviderOptionDescriptors(
      [
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [
            { id: "default", label: "Standard", isDefault: true },
            { id: "fast", label: "Fast" },
            { id: "ultrafast", label: "Ultrafast" },
          ],
        },
      ],
      resolve,
    );
    expect(
      serviceTier?.type === "select" && serviceTier.options.map((option) => option.label),
    ).toEqual(["«Standard»", "Fast", "Ultrafast"]);
  });
});
