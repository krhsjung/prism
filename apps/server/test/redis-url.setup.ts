// `host.docker.internal`은 **컨테이너 안에서 호스트를 가리키는 이름**이다 — kind에 올린
// 파드가 개발 기기의 Redis에 닿을 때 쓴다(infra/deploy). 테스트는 그 호스트 **위에서**
// 도므로 같은 이름이 여기서는 풀리지 않고(`getaddrinfo ENOTFOUND`), 실제 Redis를 쓰는
// 스펙이 통째로 실패한다 — Redis는 멀쩡히 떠 있는데도.
//
// 실패가 "건너뜀"과 비슷하게 보이는 것이 이 문제의 고약한 점이었다: 26개가 빨갛게
// 떠도 "Redis가 없어서 그렇겠지"로 읽혔다. 실제로는 붙을 수 있었다.
//
// 그래서 **값은 배포용 한 벌로 두고**, 테스트가 읽을 때만 그 이름을 이 프로세스가 도는
// 호스트로 되돌린다. 자격증명·포트·DB 번호는 건드리지 않는다.
//
// ⚠️ 이 파일이 하는 일은 **이름 하나를 바꾸는 것뿐이다.** 값이 없으면 아무것도 하지
// 않는다 — 그때는 스펙이 스스로 건너뛴다(`describeIfRedis`).
const DOCKER_HOST_ALIAS = 'host.docker.internal';
const LOCAL_HOST = '127.0.0.1';

const url = process.env.PRISM_REDIS_URL;
if (url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === DOCKER_HOST_ALIAS) {
      parsed.hostname = LOCAL_HOST;
      process.env.PRISM_REDIS_URL = parsed.toString();
    }
  } catch {
    // 형식이 어긋난 값은 **그대로 둔다** — 여기서 삼키면 무엇이 잘못됐는지 말할 자리가
    // 사라진다. 그 판단은 `app-config`가 하고, 오류 문구도 거기 있다.
  }
}
