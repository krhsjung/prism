import {
  DynamicModule,
  Module,
  type InjectionToken,
  type ModuleMetadata,
  type OptionalFactoryDependency,
  type Provider,
} from '@nestjs/common';
import {
  REDIS,
  REDIS_CONFIG,
  type RedisClient,
  type RedisConfig,
} from './redis.types';
import { IoredisService } from './ioredis';

// NestJS 관례(forRootAsync) 타입. useFactory만 지원한다(YAGNI — @app/database와 동일).
export interface RedisModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  isGlobal?: boolean;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  // 팩토리 인자 타입은 inject 목록에 달려 있어 정적으로 알 수 없다.
  useFactory: (...args: never[]) => RedisConfig | Promise<RedisConfig>;
}

// 사용처가 RedisConfig를 넘기면 IoredisService를 REDIS 토큰에 바인딩한다.
@Module({})
export class RedisModule {
  static forRoot(config: RedisConfig, isGlobal = true): DynamicModule {
    return this.build(
      { provide: REDIS_CONFIG, useValue: config },
      isGlobal,
      [],
    );
  }

  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const configProvider: Provider = {
      provide: REDIS_CONFIG,
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
      module: RedisModule,
      global,
      imports,
      providers: [
        configProvider,
        IoredisService,
        {
          provide: REDIS,
          // connect()는 연결 수립까지 수행한다(required면 실패 시 부팅 중단).
          useFactory: async (redis: IoredisService): Promise<RedisClient> => {
            await redis.connect();
            return redis;
          },
          inject: [IoredisService],
        },
      ],
      exports: [REDIS],
    };
  }
}
