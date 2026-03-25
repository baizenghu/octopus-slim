-- Migration: Convert Agent.toolsFilter from old tool names to engine-native names
-- Old: ["list_files","read_file","write_file","execute_command","search_files"]
-- New: ["read","write","exec"]
--
-- Run: mysql -u <user> -p <db> < prisma/migrate-tools-filter.sql

UPDATE agents
SET tools_filter = CASE
  -- 全量旧格式 → 全量新格式
  WHEN tools_filter = '["list_files","read_file","write_file","execute_command","search_files"]'
    THEN '["read","write","exec"]'
  ELSE
    -- 逐个替换旧名 → 新名
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(tools_filter,
              '"search_files"', '"exec"'),
            '"execute_command"', '"exec"'),
          '"write_file"', '"write"'),
        '"read_file"', '"read"'),
      '"list_files"', '"read"')
END
WHERE tools_filter IS NOT NULL
  AND (tools_filter LIKE '%list_files%'
    OR tools_filter LIKE '%read_file%'
    OR tools_filter LIKE '%write_file%'
    OR tools_filter LIKE '%execute_command%'
    OR tools_filter LIKE '%search_files%');

-- 去重：REPLACE 可能产生重复项，如 ["read","read","write","exec","exec"]
-- MySQL JSON 函数去重
UPDATE agents
SET tools_filter = (
  SELECT CONCAT('[', GROUP_CONCAT(DISTINCT val ORDER BY val SEPARATOR ','), ']')
  FROM JSON_TABLE(
    tools_filter,
    '$[*]' COLUMNS (val VARCHAR(64) PATH '$')
  ) AS jt
)
WHERE tools_filter IS NOT NULL
  AND JSON_LENGTH(tools_filter) > 0;
