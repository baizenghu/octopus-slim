import { describe, it, expect } from 'vitest';
import { OctopusBridge } from '../OctopusBridge';

describe('OctopusBridge', () => {
  describe('userAgentId', () => {
    it('should generate namespaced agent ID', () => {
      const id = OctopusBridge.userAgentId('zhangsan', 'default');
      expect(id).toBe('ent_zhangsan_default');
    });

    it('should sanitize special characters', () => {
      const id = OctopusBridge.userAgentId('user@corp', 'Data Bot');
      expect(id).toBe('ent_user_corp_data_bot');
    });

    it('should lowercase the result', () => {
      const id = OctopusBridge.userAgentId('Zhang', 'MyAgent');
      expect(id).toBe('ent_zhang_myagent');
    });
  });

  describe('userSessionKey', () => {
    it('should generate namespaced session key', () => {
      const key = OctopusBridge.userSessionKey('zhangsan', 'default', 'sess-001');
      expect(key).toBe('agent:ent_zhangsan_default:session:sess-001');
    });
  });

  describe('parseSessionKeyUserId', () => {
    it('should extract userId from session key', () => {
      const userId = OctopusBridge.parseSessionKeyUserId('agent:ent_zhangsan_default:session:xxx');
      expect(userId).toBe('zhangsan');
    });

    it('should extract non user-prefix ids from session key', () => {
      const userId = OctopusBridge.parseSessionKeyUserId('agent:ent_1234567890_default:session:xxx');
      expect(userId).toBe('1234567890');
    });

    it('should return null for non-enterprise session key', () => {
      const userId = OctopusBridge.parseSessionKeyUserId('agent:main:session:xxx');
      expect(userId).toBeNull();
    });

    it('should return null for empty string', () => {
      const userId = OctopusBridge.parseSessionKeyUserId('');
      expect(userId).toBeNull();
    });
  });
});
