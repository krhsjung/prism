-- Kakao 소셜 로그인 추가: core.users.provider 허용 집합에 'kakao'를 더한다.
-- 002에서 인라인 CHECK로 만든 제약은 Postgres가 users_provider_check로 자동 명명한다 —
-- 그 제약을 걷어내고 kakao를 포함한 새 제약으로 교체한다(기존 행에는 영향 없음).
ALTER TABLE core.users
  DROP CONSTRAINT IF EXISTS users_provider_check;

ALTER TABLE core.users
  ADD CONSTRAINT users_provider_check
  CHECK (provider IN ('google', 'apple', 'kakao', 'demo'));
