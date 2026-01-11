import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoringUtil } from 'src/common/utils/monitoring.util';

export interface WebhookQueueItem {
  id: string;
  payload: any;
  projectId: string;
  attempts: number;
  createdAt: Date;
  lastAttemptAt?: Date;
}

export interface QueueMetrics {
  queueDepth: number;
  activeWorkers: number;
  totalProcessed: number;
  totalFailed: number;
  totalRetries: number;
  averageProcessingTimeMs: number;
}

@Injectable()
export class WebhookQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookQueueService.name);
  private readonly queue: WebhookQueueItem[] = [];
  private readonly processingSet = new Set<string>();
  private readonly metrics = {
    totalProcessed: 0,
    totalFailed: 0,
    totalRetries: 0,
    processingTimes: [] as number[],
  };
  
  private workers: Promise<void>[] = [];
  private isShuttingDown = false;
  private processingWorker: any = null;
  private metricsLoggerInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Idempotency tracking: Map of deduplicationId -> timestamp
  private readonly processedEvents = new Map<string, number>();
  private readonly IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Configuration
  private readonly concurrency: number;
  private readonly maxQueueSize: number;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly config: ConfigService,
  ) {
    this.concurrency = this.config.get<number>('WEBHOOK_QUEUE_CONCURRENCY') || 10;
    this.maxQueueSize = this.config.get<number>('WEBHOOK_QUEUE_MAX_SIZE') || 10000;
    this.retryAttempts = this.config.get<number>('WEBHOOK_RETRY_ATTEMPTS') || 3;
    this.retryDelayMs = this.config.get<number>('WEBHOOK_RETRY_DELAY_MS') || 1000;

    this.logger.log(`WebhookQueueService initialized with concurrency: ${this.concurrency}, maxSize: ${this.maxQueueSize}`);
  }

  onModuleInit() {
    this.startWorkers();
    this.startMetricsLogger();
    this.startIdempotencyCleanup();
  }

  /**
   * Start periodic metrics logging
   */
  private startMetricsLogger() {
    // Log metrics every 5 minutes
    this.metricsLoggerInterval = setInterval(() => {
      const metrics = this.getMetrics();
      MonitoringUtil.logWebhookQueueMetrics(metrics);
    }, 5 * 60 * 1000); // 5 minutes

    this.logger.log('Started periodic queue metrics logging (every 5 minutes)');
  }

  /**
   * Start periodic cleanup of old idempotency entries
   */
  private startIdempotencyCleanup() {
    // Cleanup every 15 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupProcessedEvents();
    }, 15 * 60 * 1000); // 15 minutes

    this.logger.log('Started periodic idempotency cleanup (every 15 minutes)');
  }

  /**
   * Remove old entries from processedEvents map to prevent memory leaks
   */
  private cleanupProcessedEvents() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, timestamp] of this.processedEvents.entries()) {
      if (now - timestamp > this.IDEMPOTENCY_TTL_MS) {
        this.processedEvents.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} old idempotency entries`);
    }
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    
    // Clear metrics logger interval
    if (this.metricsLoggerInterval) {
      clearInterval(this.metricsLoggerInterval);
      this.metricsLoggerInterval = null;
    }
    
    // Clear idempotency cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.logger.log('Shutting down webhook queue workers...');
    // Wait for all workers to finish processing
    return Promise.all(this.workers);
  }

  /**
   * Enqueue a webhook event for processing
   * @param payload - The webhook payload
   * @param projectId - The project ID
   * @param deduplicationId - Optional unique ID for idempotency checking
   * @returns true if enqueued, false if duplicate or queue full
   */
  async enqueue(payload: any, projectId: string, deduplicationId?: string): Promise<boolean> {
    // Check for duplicate if deduplicationId is provided
    if (deduplicationId) {
      const now = Date.now();
      
      // Check if we've seen this event recently
      if (this.processedEvents.has(deduplicationId)) {
        const previousTimestamp = this.processedEvents.get(deduplicationId)!;
        const age = now - previousTimestamp;
        
        // If within TTL, it's a duplicate
        if (age < this.IDEMPOTENCY_TTL_MS) {
          this.logger.debug(`Duplicate webhook event detected and skipped: ${deduplicationId} (age: ${age}ms)`);
          return true; // Return true to indicate "handled" (even though we skipped it)
        } else {
          // Entry is old, remove it and continue
          this.processedEvents.delete(deduplicationId);
        }
      }
      
      // Mark as processed
      this.processedEvents.set(deduplicationId, now);
    }

    // Check if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.logger.error(`Webhook queue is full (${this.queue.length}/${this.maxQueueSize}). Rejecting new event.`);
      return false;
    }

    const item: WebhookQueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      payload,
      projectId,
      attempts: 0,
      createdAt: new Date(),
    };

    this.queue.push(item);
    this.logger.debug(`Enqueued webhook event: ${item.id}, queue depth: ${this.queue.length}${deduplicationId ? `, dedupId: ${deduplicationId}` : ''}`);
    
    return true;
  }

  /**
   * Start worker pool to process queue items
   */
  private startWorkers() {
    for (let i = 0; i < this.concurrency; i++) {
      const worker = this.createWorker(i);
      this.workers.push(worker);
    }
    this.logger.log(`Started ${this.concurrency} webhook queue workers`);
  }

  /**
   * Create a worker that processes items from the queue
   */
  private async createWorker(workerId: number): Promise<void> {
    while (!this.isShuttingDown) {
      try {
        const item = await this.dequeue();
        if (item) {
          await this.processItem(item, workerId);
        } else {
          // No items in queue, wait a bit before checking again
          await this.sleep(100);
        }
      } catch (error) {
        this.logger.error(`Worker ${workerId} error:`, error);
        // Continue processing even if one item fails
        await this.sleep(100);
      }
    }
    this.logger.log(`Worker ${workerId} stopped`);
  }

  /**
   * Dequeue an item from the queue (thread-safe)
   */
  private async dequeue(): Promise<WebhookQueueItem | null> {
    if (this.queue.length === 0) {
      return null;
    }

    const item = this.queue.shift();
    if (item && !this.processingSet.has(item.id)) {
      this.processingSet.add(item.id);
      return item;
    }

    return null;
  }

  /**
   * Process a queue item with retry logic
   */
  private async processItem(item: WebhookQueueItem, workerId: number): Promise<void> {
    const startTime = Date.now();
    item.attempts++;
    item.lastAttemptAt = new Date();

    try {
      this.logger.debug(`Worker ${workerId} processing webhook event: ${item.id}, attempt: ${item.attempts}`);

      // Call the processing function (will be injected)
      if (!this.processingWorker) {
        throw new Error('Processing worker not set');
      }

      await this.processingWorker(item.payload, item.projectId);

      // Success - remove from processing set and update metrics
      this.processingSet.delete(item.id);
      const processingTime = Date.now() - startTime;
      this.metrics.totalProcessed++;
      this.metrics.processingTimes.push(processingTime);
      
      // Keep only last 1000 processing times for average calculation
      if (this.metrics.processingTimes.length > 1000) {
        this.metrics.processingTimes.shift();
      }

      this.logger.debug(`Worker ${workerId} successfully processed webhook event: ${item.id} in ${processingTime}ms`);
    } catch (error) {
      this.logger.error(`Worker ${workerId} failed to process webhook event: ${item.id}`, {
        error: error.message,
        attempt: item.attempts,
        stack: error.stack,
      });

      // Check if we should retry
      if (item.attempts < this.retryAttempts) {
        this.metrics.totalRetries++;
        const delay = this.retryDelayMs * Math.pow(2, item.attempts - 1); // Exponential backoff
        this.logger.debug(`Retrying webhook event: ${item.id} after ${delay}ms (attempt ${item.attempts}/${this.retryAttempts})`);
        
        // Remove from processing set temporarily
        this.processingSet.delete(item.id);
        
        // Wait before retrying
        await this.sleep(delay);
        
        // Re-enqueue for retry
        this.queue.push(item);
      } else {
        // Max retries reached - move to dead letter
        this.processingSet.delete(item.id);
        this.metrics.totalFailed++;
        this.logger.error(`Webhook event ${item.id} failed after ${item.attempts} attempts. Moving to dead letter.`, {
          payload: item.payload,
          projectId: item.projectId,
        });
      }
    }
  }

  /**
   * Set the processing worker function
   */
  setProcessingWorker(worker: (payload: any, projectId: string) => Promise<void>) {
    this.processingWorker = worker;
    this.logger.log('Processing worker set');
  }

  /**
   * Get current queue metrics
   */
  getMetrics(): QueueMetrics {
    const averageProcessingTime = this.metrics.processingTimes.length > 0
      ? this.metrics.processingTimes.reduce((a, b) => a + b, 0) / this.metrics.processingTimes.length
      : 0;

    return {
      queueDepth: this.queue.length,
      activeWorkers: this.processingSet.size,
      totalProcessed: this.metrics.totalProcessed,
      totalFailed: this.metrics.totalFailed,
      totalRetries: this.metrics.totalRetries,
      averageProcessingTimeMs: Math.round(averageProcessingTime),
    };
  }

  /**
   * Get queue health status
   */
  getHealthStatus(): { healthy: boolean; queueDepth: number; maxSize: number; utilizationPercent: number } {
    const utilizationPercent = (this.queue.length / this.maxQueueSize) * 100;
    const healthy = utilizationPercent < 90; // Healthy if less than 90% full

    return {
      healthy,
      queueDepth: this.queue.length,
      maxSize: this.maxQueueSize,
      utilizationPercent: Math.round(utilizationPercent * 100) / 100,
    };
  }

  /**
   * Utility: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

