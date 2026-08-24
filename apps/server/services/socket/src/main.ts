import { bootstrapHttpApp } from '@app/config';
import { SocketModule } from './socket.module';
import { PrismSocketServer } from './socket.server';

void bootstrapHttpApp(SocketModule, (config) => config.socketPort, {
  // 소켓은 HTTP 서버 위에 얹힌다(같은 포트) — 업그레이드 요청만 우리가 가로챈다.
  onHttpServer: (server, app) => app.get(PrismSocketServer).attach(server),
});
