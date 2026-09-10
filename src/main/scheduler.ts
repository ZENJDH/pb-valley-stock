import cron, { type ScheduledTask } from 'node-cron'
import type { StockDatabase } from './database'
import { runExpirationCheck } from './notifications'

export class AlertScheduler {
  private task: ScheduledTask | null = null

  constructor(private readonly db: StockDatabase) {}

  start(): void {
    this.stop()
    const { alertTime, timezone } = this.db.getSettings()
    const [hour, minute] = alertTime.split(':').map(Number)
    this.task = cron.schedule(`${minute} ${hour} * * *`, async () => {
      try {
        await runExpirationCheck(this.db, true)
      } catch (error) {
        console.error('Scheduled expiration check failed:', error)
      }
    }, { timezone })
  }

  restart(): void {
    this.start()
  }

  stop(): void {
    this.task?.stop()
    this.task?.destroy()
    this.task = null
  }
}
