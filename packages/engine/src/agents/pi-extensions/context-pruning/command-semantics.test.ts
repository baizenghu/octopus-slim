import { describe, expect, it } from "vitest";
import { getCommandSemantic } from "./command-semantics.js";

describe("getCommandSemantic", () => {
  describe("default semantics", () => {
    it("exit 0 is not an error", () => {
      const result = getCommandSemantic("echo hello", 0, "hello\n", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBeUndefined();
    });

    it("exit 1 is an error for unknown commands", () => {
      const result = getCommandSemantic("somecommand", 1, "", "fail");
      expect(result.isError).toBe(true);
      expect(result.message).toContain("exit code 1");
    });

    it("exit 127 is an error", () => {
      const result = getCommandSemantic("notfound", 127, "", "command not found");
      expect(result.isError).toBe(true);
    });
  });

  describe("grep semantics", () => {
    it("exit 0 = matches found", () => {
      const result = getCommandSemantic("grep foo bar.txt", 0, "foo\n", "");
      expect(result.isError).toBe(false);
    });

    it("exit 1 = no matches (not an error)", () => {
      const result = getCommandSemantic("grep foo bar.txt", 1, "", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("No matches found");
    });

    it("exit 2 = real error", () => {
      const result = getCommandSemantic("grep foo", 2, "", "No such file");
      expect(result.isError).toBe(true);
    });
  });

  describe("rg semantics (same as grep)", () => {
    it("exit 1 = no matches (not an error)", () => {
      const result = getCommandSemantic("rg pattern", 1, "", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("No matches found");
    });
  });

  describe("diff semantics", () => {
    it("exit 0 = no differences", () => {
      const result = getCommandSemantic("diff a.txt b.txt", 0, "", "");
      expect(result.isError).toBe(false);
    });

    it("exit 1 = files differ (not an error)", () => {
      const result = getCommandSemantic("diff a.txt b.txt", 1, "1c1\n", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("Files differ");
    });

    it("exit 2 = real error", () => {
      const result = getCommandSemantic("diff a.txt", 2, "", "missing operand");
      expect(result.isError).toBe(true);
    });
  });

  describe("find semantics", () => {
    it("exit 1 = partial success (not an error)", () => {
      const result = getCommandSemantic("find / -name foo", 1, "/tmp/foo\n", "Permission denied");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("Some directories were inaccessible");
    });
  });

  describe("test/[ semantics", () => {
    it("exit 1 = condition false (not an error)", () => {
      const result = getCommandSemantic("test -f nofile", 1, "", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("Condition is false");
    });

    it("[ also works", () => {
      const result = getCommandSemantic("[ -f nofile ]", 1, "", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("Condition is false");
    });
  });

  describe("piped commands (last segment determines exit code)", () => {
    it("uses grep semantics when grep is the last command", () => {
      const result = getCommandSemantic("cat file.txt | grep pattern", 1, "", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("No matches found");
    });

    it("uses default semantics for unknown last command in pipe", () => {
      const result = getCommandSemantic("grep pattern | wc -l", 1, "", "");
      expect(result.isError).toBe(true);
    });
  });

  describe("chained commands", () => {
    it("handles && chains (last segment)", () => {
      const result = getCommandSemantic("cd dir && grep foo *.txt", 1, "", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("No matches found");
    });

    it("handles ; chains (last segment)", () => {
      const result = getCommandSemantic("echo start; diff a b", 1, "1c1\n", "");
      expect(result.isError).toBe(false);
      expect(result.message).toBe("Files differ");
    });
  });

  describe("edge cases", () => {
    it("handles empty command", () => {
      const result = getCommandSemantic("", 0, "", "");
      expect(result.isError).toBe(false);
    });

    it("handles command with quoted pipes", () => {
      // Quoted pipe should not split — "echo 'a|b'" last segment is the whole thing
      const result = getCommandSemantic("echo 'a|b'", 0, "a|b\n", "");
      expect(result.isError).toBe(false);
    });
  });
});
