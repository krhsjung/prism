import { AppController } from './app.controller';

describe('AppController', () => {
  it('healthz가 ok를 반환한다', () => {
    expect(new AppController().health()).toEqual({ status: 'ok' });
  });
});
