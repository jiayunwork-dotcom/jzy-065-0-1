-- 工况档表（PostgreSQL 16）
CREATE TABLE IF NOT EXISTS scenarios (
  name        TEXT PRIMARY KEY,
  description TEXT,
  lost_time   DOUBLE PRECISION NOT NULL,
  phases      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT phases_must_be_array CHECK (jsonb_typeof(phases) = 'array')
);

-- 预置四相位算例（幂等；不覆盖用户对同名档的修改）
INSERT INTO scenarios (name, description, lost_time, phases, created_at, updated_at)
VALUES (
  'demo-four-phase',
  '四相位城市干道示例：Y≈0.70，L=12s，C0≈76.7s。流量比 0.20/0.25/0.15/0.10。',
  12,
  '[{"name":"东西直行","q":360,"s":1800},
    {"name":"东西左转","q":450,"s":1800},
    {"name":"南北直行","q":255,"s":1700},
    {"name":"南北左转","q":170,"s":1700}]'::jsonb,
  TIMESTAMP '2026-01-01 00:00:00 UTC',
  TIMESTAMP '2026-01-01 00:00:00 UTC'
)
ON CONFLICT (name) DO NOTHING;
