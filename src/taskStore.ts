import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { TASK_INDEX_PATH, WORK_DIR_ROOT } from './config';
import { StandardPackageSnapshot, Task, TaskStage } from './types';

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
  userId?: string | null,
  options: {
    standardPackageSnapshot?: StandardPackageSnapshot | null;
    cacheHit?: boolean;
  } = {},
): Task {
  const now = nowIso();
  const taskId = randomUUID();
  const task: Task = {
    id: taskId,
    status: 'queued',
    stage: 'queued',
    stageMessage: 'Queued',
    filePath,
    sourceName: originalName,
    workDir: path.join(WORK_DIR_ROOT, taskId),
    createdAt: now,
    updatedAt: now,
    logs: [],
    libraryItemId: libraryItemId || null,
    standardPackageSnapshot: options.standardPackageSnapshot || null,
    cacheHit: Boolean(options.cacheHit),
    queueJobId: null,
    startedAt: null,
    finishedAt: null,
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

export function listTasks(): Task[] {
  return readTasks().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function replaceTasks(tasks: Task[]): Task[] {
  writeTasks(tasks);
  return tasks;
}

export function updateTask(task: Task): Task {
  task.updatedAt = nowIso();
  return saveTask(task);
}

export function setTaskStage(task: Task, stage: TaskStage, message?: string): Task {
  task.stage = stage;
  task.stageMessage = message || stage;
  if (stage !== 'queued' && stage !== 'success' && stage !== 'failed' && !task.startedAt) {
    task.startedAt = nowIso();
  }
  if (stage === 'success' || stage === 'failed') {
    task.finishedAt = nowIso();
  }
  return updateTask(task);
}

export function logTask(task: Task, message: string): Task {
  const entry = `[${nowIso()}] ${message}`;
  task.logs.push(entry);
  return updateTask(task);
}

export function setTaskError(task: Task, error: unknown, prefix: string, code?: string): Task {
  task.status = 'failed';
  task.stage = 'failed';
  task.stageMessage = prefix;
  task.finishedAt = nowIso();
  task.error = `${prefix}: ${String(error).replace(/[^\x09\x0A\x0D\x20-\uFFFF]/g, '')}`;
  task.errorCode = code || task.errorCode || 'TASK_FAILED';
  return logTask(task, task.error);
}
