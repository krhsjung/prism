-- 개인정보 미저장 정책: 이름/이메일 등 PII는 DB에 보관하지 않는다.
-- 저장하는 것은 provider 종류와 가명 식별자(provider_id, OAuth sub)뿐이며,
-- 표시 이름은 로그인 시 소셜 토큰에서 추출해 JWT 세션에만 담고 영구 저장하지 않는다.
CREATE TABLE IF NOT EXISTS core.users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  provider      text NOT NULL CHECK (provider IN ('google', 'apple', 'demo')),
  provider_id   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON core.users
  FOR EACH ROW
  EXECUTE FUNCTION core.set_updated_at();

-- SNS 계정 연동 없이 원클릭으로 체험할 수 있도록 고정 데모 계정을 시드한다.
-- provider='demo', provider_id='demo-001' 은 영구 고정 식별자.
-- POST /auth/demo 엔드포인트가 이 계정으로 세션(JWT)을 발급한다.
INSERT INTO core.users (provider, provider_id)
VALUES ('demo', 'demo-001')
ON CONFLICT (provider, provider_id) DO NOTHING;
