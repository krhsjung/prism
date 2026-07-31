import { bootstrapHttpApp } from '@app/config';
import { AuthModule } from './auth.module';

void bootstrapHttpApp(AuthModule, (config) => config.authPort);
