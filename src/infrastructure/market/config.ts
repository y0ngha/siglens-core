import type { WorkerConfig } from '@/infrastructure/market/types';

export function readWorkerConfig(): WorkerConfig {
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) {
        throw new Error(
            'WORKER_URL and WORKER_SECRET environment variables are required'
        );
    }
    return { workerUrl, workerSecret };
}

export function tryReadWorkerConfig(): WorkerConfig | null {
    const workerUrl = process.env.WORKER_URL;
    const workerSecret = process.env.WORKER_SECRET;
    if (!workerUrl || !workerSecret) return null;
    return { workerUrl, workerSecret };
}
