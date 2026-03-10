/**
 * Tests for MCP tool input validation schemas.
 */

import { describe, test, expect } from "bun:test";
import { validateToolInput } from "../validation";

describe("validateToolInput", () => {
  describe("mem_status", () => {
    test("accepts empty args", () => {
      expect(() => validateToolInput("mem_status", {})).not.toThrow();
    });
  });

  describe("mem_semantic_search", () => {
    test("accepts valid input", () => {
      const result = validateToolInput("mem_semantic_search", {
        q: "test query",
        limit: 10,
        mode: "hybrid",
      });
      expect(result.q).toBe("test query");
    });

    test("rejects empty query", () => {
      expect(() => validateToolInput("mem_semantic_search", { q: "" })).toThrow(
        "Invalid input",
      );
    });

    test("rejects missing query", () => {
      expect(() => validateToolInput("mem_semantic_search", {})).toThrow(
        "Invalid input",
      );
    });

    test("coerces string limit to number", () => {
      const result = validateToolInput("mem_semantic_search", {
        q: "test",
        limit: "5",
      });
      expect(result.limit).toBe(5);
    });

    test("rejects limit > 50", () => {
      expect(() =>
        validateToolInput("mem_semantic_search", { q: "test", limit: 100 }),
      ).toThrow("Invalid input");
    });

    test("rejects invalid mode", () => {
      expect(() =>
        validateToolInput("mem_semantic_search", {
          q: "test",
          mode: "invalid",
        }),
      ).toThrow("Invalid input");
    });

    test("validates dateStart format", () => {
      expect(() =>
        validateToolInput("mem_semantic_search", {
          q: "test",
          dateStart: "not-a-date",
        }),
      ).toThrow("YYYY-MM-DD");
    });

    test("accepts valid dateStart", () => {
      const result = validateToolInput("mem_semantic_search", {
        q: "test",
        dateStart: "2026-01-15",
      });
      expect(result.dateStart).toBe("2026-01-15");
    });

    test("validates tz format", () => {
      expect(() =>
        validateToolInput("mem_semantic_search", {
          q: "test",
          tz: "Bangkok",
        }),
      ).toThrow("timezone offset");
    });

    test("accepts valid tz offsets", () => {
      expect(
        validateToolInput("mem_semantic_search", { q: "test", tz: "+07:00" }),
      ).toBeDefined();
      expect(
        validateToolInput("mem_semantic_search", { q: "test", tz: "-05:00" }),
      ).toBeDefined();
      expect(
        validateToolInput("mem_semantic_search", { q: "test", tz: "Z" }),
      ).toBeDefined();
    });
  });

  describe("mem_semantic_get", () => {
    test("accepts valid id", () => {
      const result = validateToolInput("mem_semantic_get", { id: 42 });
      expect(result.id).toBe(42);
    });

    test("coerces string id", () => {
      const result = validateToolInput("mem_semantic_get", { id: "42" });
      expect(result.id).toBe(42);
    });

    test("rejects id < 1", () => {
      expect(() => validateToolInput("mem_semantic_get", { id: 0 })).toThrow(
        "Invalid input",
      );
    });
  });

  describe("mem_get_observations", () => {
    test("accepts valid ids array", () => {
      const result = validateToolInput("mem_get_observations", {
        ids: [1, 2, 3],
      });
      expect(result.ids).toEqual([1, 2, 3]);
    });

    test("rejects empty ids", () => {
      expect(() =>
        validateToolInput("mem_get_observations", { ids: [] }),
      ).toThrow("Invalid input");
    });

    test("rejects > 200 ids", () => {
      const ids = Array.from({ length: 201 }, (_, i) => i + 1);
      expect(() => validateToolInput("mem_get_observations", { ids })).toThrow(
        "Invalid input",
      );
    });
  });

  describe("mem_timeline", () => {
    test("accepts anchor", () => {
      const result = validateToolInput("mem_timeline", { anchor: 5 });
      expect(result.anchor).toBe(5);
    });

    test("accepts query", () => {
      const result = validateToolInput("mem_timeline", {
        query: "some query",
      });
      expect(result.query).toBe("some query");
    });

    test("rejects when neither anchor nor query provided", () => {
      expect(() => validateToolInput("mem_timeline", {})).toThrow(
        "Either anchor or query must be provided",
      );
    });
  });

  describe("mem_entity_lookup", () => {
    test("accepts valid name", () => {
      const result = validateToolInput("mem_entity_lookup", {
        name: "bugfix",
      });
      expect(result.name).toBe("bugfix");
    });

    test("rejects empty name", () => {
      expect(() =>
        validateToolInput("mem_entity_lookup", { name: "" }),
      ).toThrow("Invalid input");
    });
  });

  describe("mem_triplets_query", () => {
    test("accepts valid predicate", () => {
      const result = validateToolInput("mem_triplets_query", {
        predicate: "is_type",
      });
      expect(result.predicate).toBe("is_type");
    });

    test("rejects invalid predicate", () => {
      expect(() =>
        validateToolInput("mem_triplets_query", { predicate: "unknown" }),
      ).toThrow("Invalid input");
    });
  });

  describe("mem_ingest", () => {
    test("accepts single item", () => {
      const result = validateToolInput("mem_ingest", {
        provider: "cursor",
        item: { title: "Test observation", content: "Some content" },
      });
      expect(result.provider).toBe("cursor");
    });

    test("accepts batch items", () => {
      const result = validateToolInput("mem_ingest", {
        items: [{ title: "Item 1" }, { title: "Item 2", content: "Content 2" }],
      });
      expect(result.provider).toBe("generic"); // default
    });

    test("rejects when neither item nor items provided", () => {
      expect(() =>
        validateToolInput("mem_ingest", { provider: "generic" }),
      ).toThrow("Either item or items must be provided");
    });

    test("rejects batch > 100 items", () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        title: `Item ${i}`,
      }));
      expect(() => validateToolInput("mem_ingest", { items })).toThrow(
        "Invalid input",
      );
    });

    test("rejects item without title", () => {
      expect(() =>
        validateToolInput("mem_ingest", {
          item: { content: "no title" },
        }),
      ).toThrow("Invalid input");
    });
  });

  describe("mem_workflow_suggest", () => {
    test("accepts empty args", () => {
      const result = validateToolInput("mem_workflow_suggest", {});
      expect(result.limit).toBe(5); // default
    });

    test("accepts query", () => {
      const result = validateToolInput("mem_workflow_suggest", {
        query: "deploy",
      });
      expect(result.query).toBe("deploy");
    });
  });

  describe("unknown tool", () => {
    test("passes through args for unknown tool", () => {
      const args = { foo: "bar" };
      expect(validateToolInput("unknown_tool", args)).toBe(args);
    });
  });
});
