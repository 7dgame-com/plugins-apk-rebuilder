import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { TASK_INDEX_PATH, WORK_DIR_ROOT } from './config';
import { Task } from './types';
import { normalizeSafeSegment } from './validators';

function readTasks(): Task[] {
  try {
    const raw = JSON.parse(fs.readFileSync(TASK_INDEX_PATH, 'utf8'));
    return Array.isArray(raw) ? (raw as Task[]) : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]): void {
  fs.writeFileSync(TASK_INDEX_PATH, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
}

export function nowIso(): string {
  return new Date().toISOString();
}

function saveTask(nextTask: Task): Task {
  const tasks = readTasks();
  const index = tasks.findIndex(task => task.id === nextTask.id);
  if (index >= 0) {
    tasks[index] = nextTask;
  } else {
    tasks.push(nextTask);
  }
  writeTasks(tasks);
  return nextTask;
}

export function createTask(
  filePath: string,
  originalName: string,
  libraryItemId?: string | null,
  tenantId?: string,
  userId?: string | null,
): Task {
  const now = nowIso();
  const taskId = randomUUID();
  const safeTenantId = normalizeSafeSegment(tenantId || 'default');
  const task: Task = {
    id: taskId,
    status: 'queued',
    filePath,
    sourceName: originalName,
    workDir: path.join(WORK_DIR_ROOT, safeTenantId, taskId),
    createdAt: now,
    updatedAt: now,
    logs: [],
    libraryItemId: libraryItemId || null,
    tenantId: safeTenantId,
    userId: userId || null,
    errorCode: null,
    outputArtifactId: null,
    outputArtifactName: null,
  };
  return saveTask(task);
}

export function getTask(taskId: string): Task | undefined {
  return readTasks().find(task => task.id === taskId);
}

export function getTaskForTenant(taskId: string, tenantId?: string | null): Task | undefined {
  const safeTenantId = normalizeSafeSegment(tenantId || 'default');
  return readTasks().find(task => task.id === taskId && (task.tenantId || 'default') === safeTenantId);
}

export function listTasks(): Task[] {
  return readTasks().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateTask(task: Task): Task {
  task.updatedAt = nowIso();
  return saveTask(task);
}

export function logTask(task: Task, message: string): Task {
  const entry = `[${nowIso()}] ${message}`;
  // also echo to console for easier debugging during development
  console.log(`task ${task.id}: ${message}`);
  task.logs.push(entry);
  return updateTask(task);
}

export function setTaskError(task: Task, error: unknown, prefix: string, code?: string): Task {
  task.status = 'failed';
  task.error = `${prefix}: ${String(error).replace(/[^\x09\x0A\x0D\x20-\uFFFF]/g, '')}`;
  task.errorCode = code || task.errorCode || 'TASK_FAILED';
  return logTask(task, task.error);
}
