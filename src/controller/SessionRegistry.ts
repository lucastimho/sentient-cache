export interface TaskChange {
  changed: boolean;
  previous?: string;
  current: string;
  at: number;
}

export class SessionRegistry {
  private readonly tasks = new Map<string, { task: string; updatedAt: number }>();

  setTask(sessionId: string, task: string): TaskChange {
    const prev = this.tasks.get(sessionId);
    const changed = !prev || prev.task !== task;
    const now = Date.now();
    this.tasks.set(sessionId, { task, updatedAt: now });
    return { changed, previous: prev?.task, current: task, at: now };
  }

  getTask(sessionId: string): string | undefined {
    return this.tasks.get(sessionId)?.task;
  }

  clear(sessionId: string): void {
    this.tasks.delete(sessionId);
  }

  size(): number {
    return this.tasks.size;
  }
}
