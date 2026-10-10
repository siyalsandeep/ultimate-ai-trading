import { AuditLogEntry } from '../../src/types/trading';

class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private readonly maxEntries = 1000;

  constructor() {
    this.record({
      category: 'HEALTH_CHECK',
      level: 'INFO',
      action: 'AUDIT_SYSTEM_INITIALIZED',
      details: { timestamp: new Date().toISOString(), status: 'ONLINE' },
      actor: 'OPERATOR',
    });
  }

  public record(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: Date.now(),
      ...entry,
    };

    this.logs.unshift(fullEntry);
    if (this.logs.length > this.maxEntries) {
      this.logs.pop();
    }

    return fullEntry;
  }

  public getRecentLogs(limit: number = 100, category?: string): AuditLogEntry[] {
    if (category) {
      return this.logs.filter(l => l.category === category).slice(0, limit);
    }
    return this.logs.slice(0, limit);
  }

  public getCount(): number {
    return this.logs.length;
  }
}

export const auditLogger = new AuditLogger();
