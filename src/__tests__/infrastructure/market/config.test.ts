import { describe, it, expect, afterEach } from 'vitest';
import {
    readAlpacaConfig,
    readMarketProviderType,
    readWorkerConfig,
    tryReadWorkerConfig,
} from '@/infrastructure/market/config';

describe('readAlpacaConfig', () => {
    afterEach(() => {
        delete process.env.ALPACA_API_KEY;
        delete process.env.ALPACA_API_SECRET;
        delete process.env.ALPACA_SECRET_KEY;
    });

    describe('ALPACA_API_KEY가 없을 때', () => {
        it('에러를 던진다', () => {
            process.env.ALPACA_API_SECRET = 'secret';
            expect(() => readAlpacaConfig()).toThrow(
                'ALPACA_API_KEY and (ALPACA_API_SECRET or ALPACA_SECRET_KEY) must be set'
            );
        });
    });

    describe('시크릿 키가 모두 없을 때', () => {
        it('에러를 던진다', () => {
            process.env.ALPACA_API_KEY = 'key';
            expect(() => readAlpacaConfig()).toThrow(
                'ALPACA_API_KEY and (ALPACA_API_SECRET or ALPACA_SECRET_KEY) must be set'
            );
        });
    });

    describe('ALPACA_API_SECRET이 설정된 경우', () => {
        it('apiKey와 secretKey를 반환한다', () => {
            process.env.ALPACA_API_KEY = 'key';
            process.env.ALPACA_API_SECRET = 'secret';
            expect(readAlpacaConfig()).toEqual({
                apiKey: 'key',
                secretKey: 'secret',
            });
        });
    });

    describe('ALPACA_API_SECRET이 없고 ALPACA_SECRET_KEY가 있는 경우', () => {
        it('ALPACA_SECRET_KEY를 secretKey로 반환한다', () => {
            process.env.ALPACA_API_KEY = 'key';
            process.env.ALPACA_SECRET_KEY = 'legacy-secret';
            expect(readAlpacaConfig()).toEqual({
                apiKey: 'key',
                secretKey: 'legacy-secret',
            });
        });
    });
});

describe('readMarketProviderType', () => {
    afterEach(() => {
        delete process.env.MARKET_DATA_PROVIDER;
    });

    describe('환경 변수가 설정되지 않은 경우', () => {
        it('fmp를 반환한다', () => {
            expect(readMarketProviderType()).toBe('fmp');
        });
    });

    describe('MARKET_DATA_PROVIDER=fmp인 경우', () => {
        it('fmp를 반환한다', () => {
            process.env.MARKET_DATA_PROVIDER = 'fmp';
            expect(readMarketProviderType()).toBe('fmp');
        });
    });

    describe('MARKET_DATA_PROVIDER=alpaca인 경우', () => {
        it('alpaca를 반환한다', () => {
            process.env.MARKET_DATA_PROVIDER = 'alpaca';
            expect(readMarketProviderType()).toBe('alpaca');
        });
    });

    describe('MARKET_DATA_PROVIDER가 알 수 없는 값인 경우', () => {
        it('fmp를 기본값으로 반환한다', () => {
            process.env.MARKET_DATA_PROVIDER = 'unknown';
            expect(readMarketProviderType()).toBe('fmp');
        });
    });
});

describe('readWorkerConfig', () => {
    afterEach(() => {
        delete process.env.WORKER_URL;
        delete process.env.WORKER_SECRET;
    });

    describe('WORKER_URL이 없을 때', () => {
        it('에러를 던진다', () => {
            process.env.WORKER_SECRET = 'secret';
            expect(() => readWorkerConfig()).toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });
    });

    describe('WORKER_SECRET이 없을 때', () => {
        it('에러를 던진다', () => {
            process.env.WORKER_URL = 'https://worker.example.com';
            expect(() => readWorkerConfig()).toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });
    });

    describe('두 환경 변수가 모두 없을 때', () => {
        it('에러를 던진다', () => {
            expect(() => readWorkerConfig()).toThrow(
                'WORKER_URL and WORKER_SECRET environment variables are required'
            );
        });
    });

    describe('두 환경 변수가 모두 설정된 경우', () => {
        it('workerUrl과 workerSecret을 반환한다', () => {
            process.env.WORKER_URL = 'https://worker.example.com';
            process.env.WORKER_SECRET = 'secret';
            expect(readWorkerConfig()).toEqual({
                workerUrl: 'https://worker.example.com',
                workerSecret: 'secret',
            });
        });
    });
});

describe('tryReadWorkerConfig', () => {
    afterEach(() => {
        delete process.env.WORKER_URL;
        delete process.env.WORKER_SECRET;
    });

    describe('WORKER_URL이 없을 때', () => {
        it('null을 반환한다', () => {
            process.env.WORKER_SECRET = 'secret';
            expect(tryReadWorkerConfig()).toBeNull();
        });
    });

    describe('WORKER_SECRET이 없을 때', () => {
        it('null을 반환한다', () => {
            process.env.WORKER_URL = 'https://worker.example.com';
            expect(tryReadWorkerConfig()).toBeNull();
        });
    });

    describe('두 환경 변수가 모두 없을 때', () => {
        it('null을 반환한다', () => {
            expect(tryReadWorkerConfig()).toBeNull();
        });
    });

    describe('두 환경 변수가 모두 설정된 경우', () => {
        it('workerUrl과 workerSecret을 반환한다', () => {
            process.env.WORKER_URL = 'https://worker.example.com';
            process.env.WORKER_SECRET = 'secret';
            expect(tryReadWorkerConfig()).toEqual({
                workerUrl: 'https://worker.example.com',
                workerSecret: 'secret',
            });
        });
    });
});
