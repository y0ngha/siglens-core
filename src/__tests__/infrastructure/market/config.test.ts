import { describe, it, expect, afterEach } from 'vitest';
import {
    readWorkerConfig,
    tryReadWorkerConfig,
} from '@/infrastructure/market/config';

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
