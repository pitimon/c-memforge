/**
 * MCP Tool Input Validation
 *
 * Zod schemas for runtime validation of all MCP tool inputs.
 * Addresses Finding #2 (CWE-20): inputSchema is LLM hint only,
 * this module enforces validation before handler execution.
 */

import { z } from "zod";

// Reusable field schemas
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format")
  .optional();
const tzField = z
  .string()
  .regex(/^[+-]\d{2}:\d{2}$|^Z$/, "Expected timezone offset like +07:00 or Z")
  .optional();
const limitField = (max: number, defaultVal?: number) => {
  const base = z.coerce.number().int().min(1).max(max);
  return defaultVal !== undefined
    ? base.optional().default(defaultVal)
    : base.optional();
};

// Tool schemas
const schemas: Record<string, z.ZodType> = {
  mem_status: z.object({}).passthrough(),

  mem_semantic_search: z.object({
    q: z.string().min(1).max(2000),
    limit: limitField(50, 10),
    mode: z.enum(["hybrid", "fts", "vector"]).optional().default("hybrid"),
    vector_weight: z.coerce.number().min(0).max(1).optional(),
    dateStart: dateField,
    dateEnd: dateField,
    tz: tzField,
    offset: z.coerce.number().int().min(0).optional(),
    include_shared: z.boolean().optional(),
  }),

  mem_hybrid_search: z.object({
    q: z.string().min(1).max(2000),
    limit: limitField(50, 10),
    vector_weight: z.coerce.number().min(0).max(1).optional(),
    dateStart: dateField,
    dateEnd: dateField,
    tz: tzField,
    offset: z.coerce.number().int().min(0).optional(),
    include_shared: z.boolean().optional(),
  }),

  mem_vector_search: z.object({
    q: z.string().min(1).max(2000),
    limit: limitField(50, 10),
    dateStart: dateField,
    dateEnd: dateField,
    tz: tzField,
    offset: z.coerce.number().int().min(0).optional(),
    include_shared: z.boolean().optional(),
  }),

  mem_search: z.object({
    query: z.string().min(1).max(2000),
    limit: limitField(50, 10),
    project: z.string().max(200).optional(),
    type: z.string().max(100).optional(),
    dateStart: dateField,
    dateEnd: dateField,
    tz: tzField,
    offset: z.coerce.number().int().min(0).optional(),
    include_shared: z.boolean().optional(),
  }),

  mem_semantic_get: z.object({
    id: z.coerce.number().int().min(1),
  }),

  mem_semantic_recent: z.object({
    limit: limitField(100, 20),
  }),

  mem_timeline: z
    .object({
      anchor: z.coerce.number().int().min(1).optional(),
      query: z.string().max(2000).optional(),
      depth_before: z.coerce.number().int().min(0).max(50).optional(),
      depth_after: z.coerce.number().int().min(0).max(50).optional(),
      project: z.string().max(200).optional(),
    })
    .refine(
      (data) =>
        data.anchor !== undefined ||
        (data.query !== undefined && data.query.length > 0),
      { message: "Either anchor or query must be provided" },
    ),

  mem_get_observations: z.object({
    ids: z.array(z.coerce.number().int().min(1)).min(1).max(200),
  }),

  mem_entity_lookup: z.object({
    name: z.string().min(1).max(200),
  }),

  mem_triplets_query: z.object({
    subject: z.string().max(200).optional(),
    predicate: z
      .enum(["is_type", "belongs_to", "modifies", "relates_to"])
      .optional(),
    object: z.string().max(200).optional(),
    limit: limitField(500, 100),
  }),

  mem_ingest: z
    .object({
      provider: z
        .enum(["cursor", "aider", "codex", "openai", "chatgpt", "generic"])
        .optional()
        .default("generic"),
      item: z
        .object({
          title: z.string().min(1).max(500),
          content: z.string().max(10000).optional(),
          narrative: z.string().max(10000).optional(),
          type: z.string().max(100).optional(),
          project: z.string().max(200).optional(),
          files_read: z.array(z.string().max(500)).max(100).optional(),
          files_modified: z.array(z.string().max(500)).max(100).optional(),
        })
        .optional(),
      items: z
        .array(
          z.object({
            title: z.string().min(1).max(500),
            content: z.string().max(10000).optional(),
            narrative: z.string().max(10000).optional(),
            type: z.string().max(100).optional(),
            project: z.string().max(200).optional(),
          }),
        )
        .max(100)
        .optional(),
    })
    .refine(
      (data) =>
        data.item !== undefined ||
        (data.items !== undefined && data.items.length > 0),
      { message: "Either item or items must be provided" },
    ),

  mem_workflow_suggest: z.object({
    query: z.string().max(2000).optional(),
    limit: limitField(20, 5),
  }),

  mem_skill_search: z.object({
    query: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    tags: z.string().max(500).optional(),
    limit: limitField(100, 10),
  }),

  mem_skill_get: z.object({
    id: z.coerce.number().int().min(1),
  }),

  mem_skill_related: z.object({
    id: z.coerce.number().int().min(1),
    depth: z.coerce.number().int().min(1).max(3).optional(),
    limit: limitField(50, 10),
  }),

  mem_skill_create: z
    .object({
      session_id: z.string().max(500).optional(),
      observation_ids: z
        .array(z.coerce.number().int().min(1))
        .max(50)
        .optional(),
      project: z.string().max(200).optional(),
    })
    .refine(
      (d) =>
        d.session_id || (d.observation_ids && d.observation_ids.length > 0),
      { message: "Either session_id or observation_ids required" },
    ),

  mem_skill_discover: z.object({
    query: z.string().max(2000).optional(),
    category: z.string().max(100).optional(),
    limit: limitField(100, 10),
  }),
};

/**
 * Validate tool input against its Zod schema.
 * Returns the parsed (coerced) args on success, or throws with a descriptive message.
 */
export function validateToolInput(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const schema = schemas[toolName];
  if (!schema) {
    // No schema defined = no validation (shouldn't happen for known tools)
    return args;
  }

  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid input: ${issues}`);
  }

  return result.data as Record<string, unknown>;
}
