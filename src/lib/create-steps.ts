/** The Create a New Site wizard's steps, in order. Shared by the wizard and the AI suggester. */
export const CREATE_STEP_IDS = [
  "domain",
  "business_name",
  "industry",
  "location",
  "existing_site",
  "emulate",
  "goal",
  "customers",
  "services",
  "pages",
  "style",
  "contact",
  "features",
  "files",
] as const;

export type CreateStepId = (typeof CREATE_STEP_IDS)[number];

export const stepIndex = (id: CreateStepId): number => CREATE_STEP_IDS.indexOf(id);
