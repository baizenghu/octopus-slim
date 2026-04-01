import { describe, expect, it } from "vitest";
import { detectDestructiveCommand } from "./destructive-command-warning.js";

describe("detectDestructiveCommand", () => {
  describe("git destructive operations", () => {
    it("detects git reset --hard", () => {
      expect(detectDestructiveCommand("git reset --hard HEAD~1")).toContain("discard uncommitted");
    });

    it("detects git push --force", () => {
      expect(detectDestructiveCommand("git push --force origin main")).toContain("overwrite remote");
    });

    it("detects git push -f", () => {
      expect(detectDestructiveCommand("git push -f origin main")).toContain("overwrite remote");
    });

    it("detects git push --force-with-lease", () => {
      expect(detectDestructiveCommand("git push --force-with-lease")).toContain("overwrite remote");
    });

    it("detects git clean -f", () => {
      expect(detectDestructiveCommand("git clean -fd")).toContain("delete untracked");
    });

    it("does not flag git clean --dry-run", () => {
      expect(detectDestructiveCommand("git clean -n -f")).toBeNull();
    });

    it("detects git checkout .", () => {
      expect(detectDestructiveCommand("git checkout .")).toContain("discard all working tree");
    });

    it("detects git restore .", () => {
      expect(detectDestructiveCommand("git restore .")).toContain("discard all working tree");
    });

    it("detects git stash drop", () => {
      expect(detectDestructiveCommand("git stash drop")).toContain("remove stashed");
    });

    it("detects git stash clear", () => {
      expect(detectDestructiveCommand("git stash clear")).toContain("remove stashed");
    });

    it("detects git branch -D", () => {
      expect(detectDestructiveCommand("git branch -D feature")).toContain("force-delete");
    });
  });

  describe("git safety bypass", () => {
    it("detects --no-verify on commit", () => {
      expect(detectDestructiveCommand("git commit --no-verify -m 'msg'")).toContain("skip safety");
    });

    it("detects --no-verify on push", () => {
      expect(detectDestructiveCommand("git push --no-verify")).toContain("skip safety");
    });

    it("detects git commit --amend", () => {
      expect(detectDestructiveCommand("git commit --amend")).toContain("rewrite the last commit");
    });
  });

  describe("file deletion", () => {
    it("detects rm -rf", () => {
      expect(detectDestructiveCommand("rm -rf /tmp/dir")).toContain("recursively force-remove");
    });

    it("detects rm -fr (reversed flags)", () => {
      expect(detectDestructiveCommand("rm -fr /tmp/dir")).toContain("recursively force-remove");
    });

    it("detects rm -r", () => {
      expect(detectDestructiveCommand("rm -r dir")).toContain("recursively remove");
    });

    it("detects rm -f", () => {
      expect(detectDestructiveCommand("rm -f file.txt")).toContain("force-remove");
    });
  });

  describe("database operations", () => {
    it("detects DROP TABLE", () => {
      expect(detectDestructiveCommand("DROP TABLE users;")).toContain("drop or truncate");
    });

    it("detects TRUNCATE TABLE (case insensitive)", () => {
      expect(detectDestructiveCommand("truncate table logs;")).toContain("drop or truncate");
    });

    it("detects DELETE FROM without WHERE", () => {
      expect(detectDestructiveCommand("DELETE FROM users;")).toContain("delete all rows");
    });
  });

  describe("infrastructure", () => {
    it("detects kubectl delete", () => {
      expect(detectDestructiveCommand("kubectl delete pod mypod")).toContain("delete Kubernetes");
    });

    it("detects terraform destroy", () => {
      expect(detectDestructiveCommand("terraform destroy")).toContain("destroy Terraform");
    });
  });

  describe("safe commands", () => {
    it("returns null for safe commands", () => {
      expect(detectDestructiveCommand("git status")).toBeNull();
      expect(detectDestructiveCommand("git log --oneline")).toBeNull();
      expect(detectDestructiveCommand("ls -la")).toBeNull();
      expect(detectDestructiveCommand("npm install")).toBeNull();
      expect(detectDestructiveCommand("echo hello")).toBeNull();
    });
  });
});
