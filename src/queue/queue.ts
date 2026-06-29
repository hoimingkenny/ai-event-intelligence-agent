import { Queue, Worker, type JobsOptions, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { env } from '../config/env.js';
import { QUEUE_NAMES, type PipelineJob, type QueueName } from './jobs.js';

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};

export function redisConnection() {
  return {
    host: env.redisHost,
    port: env.redisPort,
  };
}

export function createPipelineQueue(name: QueueName, options: Partial<QueueOptions> = {}): Queue<PipelineJob> {
  return new Queue<PipelineJob>(name, {
    defaultJobOptions,
    ...options,
    connection: options.connection ?? redisConnection(),
  });
}

export function createAllPipelineQueues(): Record<QueueName, Queue<PipelineJob>> {
  return Object.fromEntries(
    QUEUE_NAMES.map((queueName) => [queueName, createPipelineQueue(queueName)])
  ) as Record<QueueName, Queue<PipelineJob>>;
}

export function createPipelineWorker(
  name: QueueName,
  processor: Processor<PipelineJob>,
  options: Partial<WorkerOptions> = {}
): Worker<PipelineJob> {
  return new Worker<PipelineJob>(name, processor, {
    concurrency: 1,
    ...options,
    connection: options.connection ?? redisConnection(),
  });
}
