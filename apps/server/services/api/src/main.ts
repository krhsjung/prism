import { bootstrapHttpApp } from '@app/config';
import { AppModule } from './app.module';

void bootstrapHttpApp(AppModule, (config) => config.apiPort);
