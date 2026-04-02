import { describe, it, expect } from 'vitest';
import { isPathSafe, hasPathTraversal } from '../filesystem-guard.js';

const WS = '/home/baizh/octopus-slim/data/users/u1/agents/default/workspace';

describe('isPathSafe', () => {
  it('允许正常 workspace 路径', () => {
    expect(isPathSafe(`${WS}/outputs/report.md`, WS)).toBe(true);
    expect(isPathSafe(`${WS}/files/photo.png`, WS)).toBe(true);
  });

  it('允许 workspace 根路径本身', () => {
    expect(isPathSafe(WS, WS)).toBe(true);
  });

  it('拒绝路径穿越到其他用户 workspace', () => {
    const otherUser = '/home/baizh/octopus-slim/data/users/u2/agents/default/workspace/file.txt';
    expect(isPathSafe(otherUser, WS)).toBe(false);
  });

  it('拒绝系统路径', () => {
    expect(isPathSafe('/etc/passwd', WS)).toBe(false);
  });

  it('拒绝 .octopus-state 目录', () => {
    expect(isPathSafe(`${WS}/.octopus-state/enterprise.json`, WS)).toBe(false);
  });

  it('拒绝 .env 文件', () => {
    expect(isPathSafe(`${WS}/.env`, WS)).toBe(false);
    expect(isPathSafe(`${WS}/config/.env.local`, WS)).toBe(false);
  });

  it('拒绝 octopus.json', () => {
    expect(isPathSafe(`${WS}/octopus.json`, WS)).toBe(false);
  });

  it('拒绝 enterprise.json', () => {
    expect(isPathSafe(`${WS}/enterprise.json`, WS)).toBe(false);
  });

  it('拒绝 credentials.json', () => {
    expect(isPathSafe(`${WS}/credentials.json`, WS)).toBe(false);
  });

  it('拒绝 node_modules', () => {
    expect(isPathSafe(`${WS}/node_modules/express/index.js`, WS)).toBe(false);
  });

  it('拒绝 .git 目录', () => {
    expect(isPathSafe(`${WS}/.git/config`, WS)).toBe(false);
  });

  it('拒绝 SSH 私钥文件名', () => {
    expect(isPathSafe(`${WS}/id_rsa`, WS)).toBe(false);
    expect(isPathSafe(`${WS}/id_ed25519`, WS)).toBe(false);
  });

  it('大小写绕过防护 — .ENV', () => {
    expect(isPathSafe(`${WS}/.ENV`, WS)).toBe(false);
  });

  it('大小写绕过防护 — NODE_MODULES', () => {
    expect(isPathSafe(`${WS}/NODE_MODULES/pkg/index.js`, WS)).toBe(false);
  });

  it('大小写绕过防护 — Octopus.Json', () => {
    expect(isPathSafe(`${WS}/Octopus.Json`, WS)).toBe(false);
  });

  it('允许深层普通子目录', () => {
    expect(isPathSafe(`${WS}/outputs/2024/01/report.csv`, WS)).toBe(true);
    expect(isPathSafe(`${WS}/files/uploads/img.jpg`, WS)).toBe(true);
  });

  it('拒绝 .. 穿越（path.resolve 处理后）', () => {
    // resolve 后 /WS/../../../etc/passwd => /home/baizh/etc/passwd 之类，不在 WS 内
    const traversed = WS + '/../../../etc/passwd';
    expect(isPathSafe(traversed, WS)).toBe(false);
  });
});

describe('hasPathTraversal', () => {
  it('检测 ..', () => {
    expect(hasPathTraversal('../../../etc/passwd')).toBe(true);
  });

  it('检测相对路径中嵌入 ..', () => {
    expect(hasPathTraversal('outputs/../../../etc/passwd')).toBe(true);
  });

  it('检测小写 URL 编码 %2e%2e', () => {
    expect(hasPathTraversal('%2e%2e/secret')).toBe(true);
  });

  it('检测大写 URL 编码 %2E%2E', () => {
    expect(hasPathTraversal('%2E%2E/secret')).toBe(true);
  });

  it('检测 %2F 斜杠编码', () => {
    expect(hasPathTraversal('outputs%2Freport.md')).toBe(true);
  });

  it('正常相对路径通过', () => {
    expect(hasPathTraversal('outputs/report.md')).toBe(false);
  });

  it('正常文件名通过', () => {
    expect(hasPathTraversal('photo.png')).toBe(false);
  });
});
