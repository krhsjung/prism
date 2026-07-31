import {
  DynamicModule,
  Module,
  type InjectionToken,
  type ModuleMetadata,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';
import {
  DATABASE,
  POSTGRES_CONFIG,
  type DatabaseClient,
  type PostgresConfig,
} from './database.types';
import { PostgresService } from './postgres';

// NestJS 관례(forRootAsync) 타입. useFactory만 지원한다 —
// useExisting/useClass는 실제 수요가 생길 때 추가한다(YAGNI).
export interface DatabaseModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  isGlobal?: boolean;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  // 팩토리 인자 타입은 inject 목록에 달려 있어 정적으로 알 수 없다.
  // never[]는 어떤 파라미터 시그니처의 팩토리든 받아들인다(any 없이).
  useFactory: (...args: never[]) => PostgresConfig | Promise<PostgresConfig>;
}

// 독립 라이브러리 모듈. 사용처가 forRoot(정적) 또는 forRootAsync(설정 서비스 주입)로
// PostgresConfig를 넘기면 PostgresService를 DATABASE 토큰에 바인딩한다.
// (새 엔진이 실제로 생기면 여기 팩토리에서 구현체 선택을 분기한다)
@Module({})
export class DatabaseModule {
  static forRoot(config: PostgresConfig, isGlobal = true): DynamicModule {
    return this.build(
      { provide: POSTGRES_CONFIG, useValue: config },
      isGlobal,
      [],
    );
  }

  static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
    const configProvider: Provider = {
      provide: POSTGRES_CONFIG,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    return this.build(
      configProvider,
      options.isGlobal ?? true,
      options.imports ?? [],
    );
  }

  private static build(
    configProvider: Provider,
    global: boolean,
    imports: ModuleMetadata['imports'],
  ): DynamicModule {
    return {
      module: DatabaseModule,
      global,
      imports,
      providers: [
        configProvider,
        PostgresService,
        {
          provide: DATABASE,
          // connect()는 풀 생성 + 연결 확인(SELECT 1)까지 수행한다.
          useFactory: async (
            postgres: PostgresService,
          ): Promise<DatabaseClient> => {
            await postgres.connect();
            return postgres;
          },
          inject: [PostgresService],
        },
      ],
      exports: [DATABASE],
    };
  }
}
