import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_CONNECT_RETRY_DELAY_MS, REDIS_CONNECT_TIMEOUT_MS } from './config';
import { runDecompileTask, runModTask } from './buildService';
import { getTask, setTaskError } from './taskStore';
import { ModPayload } from './types';

const connection = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

const redisState = {
    ready: false,
    lastError: '',
    lastErrorAt: 0,
};

console.info(`[Redis] Connecting to ${REDIS_HOST}:${REDIS_PORT}`);
connection.on('ready', () => {
    console.info('[Redis] Connection ready');
    redisState.ready = true;
    redisState.lastError = '';
    redisState.lastErrorAt = 0;
});
connection.on('error', (err) => {
    console.error('[Redis] Error connecting to Redis:', err.message);
    redisState.ready = false;
    redisState.lastError = err.message || 'unknown';
    redisState.lastErrorAt = Date.now();
});

export const modQueue = new Queue('apk-mod', { connection: connection as any });

export const modWorker = new Worker(
    'apk-mod',
    async (job: Job) => {
        const { type, taskId, payload } = job.data as { type: 'decompile' | 'mod' | 'plugin-run'; taskId: string; payload?: ModPayload };
        const task = getTask(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        try {
            if (type === 'decompile') {
                await runDecompileTask(task);
            } else if (type === 'mod' && payload) {
                await runModTask(task, payload);
            } else if (type === 'plugin-run' && payload) {
                if (!task.decodedDir) {
                    await runDecompileTask(task);
                }
                // Always run mod after ensuring decodedDir is ready.
                await runModTask(task, payload);
            }
        } catch (err) {
            setTaskError(
                task,
                err,
                `${type} failed out of band`,
                type === 'decompile' ? 'APK_DECOMPILE_FAILED' : 'APK_MOD_FAILED',
            );
            throw err;
        }
    },
    {
        connection: connection as any,
        concurrency: 1
    }
);

modWorker.on('completed', (job) => {
    console.log(`[BullMQ] Job ${job.id} has completed!`);
});

modWorker.on('failed', (job, err) => {
    console.error(`[BullMQ] Job ${job?.id} has failed with ${err?.message}`);
});

export function getRedisStatus(): { ready: boolean; lastError: string; lastErrorAt: number } {
    return { ...redisState };
}

export async function ensureRedisReady(timeoutMs = REDIS_CONNECT_TIMEOUT_MS): Promise<void> {
    if (redisState.ready) return;
    const startedAt = Date.now();
    let lastError = '';
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await connection.ping();
            redisState.ready = true;
            redisState.lastError = '';
            redisState.lastErrorAt = 0;
            return;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            lastError = message;
            redisState.ready = false;
            redisState.lastError = message;
            redisState.lastErrorAt = Date.now();
            await new Promise(resolve => setTimeout(resolve, REDIS_CONNECT_RETRY_DELAY_MS));
        }
    }
    throw new Error(`Redis not ready after ${timeoutMs}ms${lastError ? ` (${lastError})` : ''}`);
}
