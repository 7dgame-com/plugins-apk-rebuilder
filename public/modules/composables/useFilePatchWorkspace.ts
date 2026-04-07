import { createPatchId, formatBytes, TASK_STATUS } from '../state';
import { t } from '../i18n';
import type { AppState, FilePatchDraft, FilePatchStringField, FilePatchTask, FilePatchWorkspaceApi } from '../types';

type EditableFileResponse = {
  path?: string;
  content?: string;
  size?: number;
  editable?: boolean;
  replaceable?: boolean;
};

type QueuedFilePatchInput =
  | { path: string; mode: 'file_replace'; replacementBase64: string; replacementFileName: string }
  | { path: string; mode: 'text_replace'; matchText: string; replaceText: string; regex: boolean }
  | { path: string; mode: 'direct_edit'; content: string };

type FilePatchWorkspaceDeps = {
  state: AppState;
  api: (url: string, options?: RequestInit) => Promise<unknown>;
};

function createFilePatchTask(): FilePatchTask {
  return {
    id: createPatchId(),
    enabled: true,
    collapsed: false,
    path: '',
    method: 'edit',
    loadStatusText: t('patch.loadStatus.notLoaded'),
    loadStatusKind: '',
    originalContent: '',
    modifiedContent: '',
    matchText: '',
    replaceText: '',
    matchRegex: false,
    replaceFile: null,
    replaceFileName: t('patch.noReplaceFile'),
  };
}

function getSupportedModeLabel(editable: boolean, replaceable: boolean): string {
  if (editable && replaceable) return t('patch.method.editableReplaceable');
  if (editable) return t('patch.method.editable');
  if (replaceable) return t('patch.method.replaceable');
  return t('patch.method.readonly');
}

export function useFilePatchWorkspace({ state, api }: FilePatchWorkspaceDeps): FilePatchWorkspaceApi {
  function getFilePatchTask(taskId: string): FilePatchTask | undefined {
    return state.filePatchTasks.find((task) => task.id === taskId);
  }

  function getTaskIndex(taskId: string): number {
    return state.filePatchTasks.findIndex((task) => task.id === taskId);
  }

  function updateTask(taskId: string, updater: (task: FilePatchTask) => void): FilePatchTask | null {
    const task = getFilePatchTask(taskId);
    if (!task) return null;
    updater(task);
    return task;
  }

  function setTaskLoadStatus(task: FilePatchTask, text: string, kind = ''): void {
    task.loadStatusText = text;
    task.loadStatusKind = kind;
  }

  function swapTask(orderFrom: number, orderTo: number): void {
    const temp = state.filePatchTasks[orderTo];
    state.filePatchTasks[orderTo] = state.filePatchTasks[orderFrom];
    state.filePatchTasks[orderFrom] = temp;
  }

  function removeTask(taskId: string): void {
    state.filePatchTasks = state.filePatchTasks.filter((task) => task.id !== taskId);
  }

  function canCreateTask(): boolean {
    if (!state.id) {
      alert(t('patch.selectFileToEdit'));
      return false;
    }
    if (state.status !== TASK_STATUS.SUCCESS) {
      alert(t('patch.notReady'));
      return false;
    }
    return true;
  }

  async function fetchEditableFile(taskId: string, editPath: string): Promise<EditableFileResponse> {
    return (await api(`/api/edit-file/${taskId}?path=${encodeURIComponent(editPath)}`)) as EditableFileResponse;
  }

  function createTask(): void {
    if (!canCreateTask()) return;
    state.filePatchTasks.push(createFilePatchTask());
  }

  function clearTasks(): boolean {
    if (!state.filePatchTasks.length) return false;
    if (!confirm(t('patch.confirmClear'))) return false;
    state.filePatchTasks = [];
    return true;
  }

  async function loadTaskFile(taskId: string, silent = false): Promise<void> {
    const task = getFilePatchTask(taskId);
    if (!task) return;
    if (!state.id) {
      if (!silent) alert(t('upload.needUpload'));
      return;
    }
    const editPath = String(task.path || '').trim();
    if (!editPath) {
      setTaskLoadStatus(task, t('patch.pathUnset'), 'fail');
      if (!silent) alert(t('patch.pathUnset'));
      return;
    }
    try {
      const data = await fetchEditableFile(state.id, editPath);
      const normalizedPath = data.path || editPath;
      task.path = normalizedPath;
      task.originalContent = data.content || '';
      task.modifiedContent = data.content || '';
      if (!data.editable) {
        task.method = 'replace';
      }
      setTaskLoadStatus(
        task,
        `${t('patch.loadFile')}: ${normalizedPath} | ${formatBytes(Number(data.size || 0))} | ${getSupportedModeLabel(Boolean(data.editable), Boolean(data.replaceable ?? true))}`,
        'ok'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTaskLoadStatus(task, `${t('patch.loadFileFailed')}: ${errorMessage}`, 'fail');
      if (!silent) throw error;
    }
  }

  function collectTaskDraftPatches(task: FilePatchTask): FilePatchDraft[] {
    const path = String(task.path || '').trim();
    if (!path) return [];

    if (task.method === 'replace') {
      if (!task.replaceFile) return [];
      return [
        {
          path,
          mode: 'file_replace',
          replacementFile: task.replaceFile,
          replacementFileName: task.replaceFileName || task.replaceFile.name || 'replacement.bin',
        },
      ];
    }

    const drafts: FilePatchDraft[] = [];
    const matchText = String(task.matchText || '');
    const replaceText = String(task.replaceText || '');
    if (matchText) {
      drafts.push({ path, mode: 'text_replace', matchText, replaceText, regex: Boolean(task.matchRegex) });
    }

    const original = String(task.originalContent || '');
    const modified = String(task.modifiedContent || '');
    if ((original || modified) && original !== modified) {
      drafts.push({ path, mode: 'direct_edit', content: modified });
    }
    return drafts;
  }

  async function buildQueuedFilePatchesInput(
    fileToBase64: (file: File) => Promise<string>
  ): Promise<QueuedFilePatchInput[]> {
    const result: QueuedFilePatchInput[] = [];
    for (const task of state.filePatchTasks) {
      if (!task.enabled) continue;
      const drafts = collectTaskDraftPatches(task);
      if (!drafts.length) continue;
      for (const patch of drafts) {
        if (patch.mode === 'file_replace') {
          const file = patch.replacementFile;
          if (!file) {
            throw new Error(t('patch.replaceMissing', { path: patch.path }));
          }
          result.push({
            path: patch.path,
            mode: 'file_replace',
            replacementBase64: await fileToBase64(file),
            replacementFileName: patch.replacementFileName || file.name || 'replacement.bin',
          });
          continue;
        }
        if (patch.mode === 'text_replace') {
          result.push({
            path: patch.path,
            mode: 'text_replace',
            matchText: patch.matchText || '',
            replaceText: patch.replaceText || '',
            regex: Boolean(patch.regex),
          });
          continue;
        }
        if (patch.mode === 'direct_edit') {
          result.push({
            path: patch.path,
            mode: 'direct_edit',
            content: patch.content || '',
          });
        }
      }
    }
    return result;
  }

  function handleToggleEnable(taskId: string, enabled: boolean): void {
    updateTask(taskId, (task) => {
      task.enabled = enabled;
    });
  }

  function handleReplaceFile(taskId: string, file: File | null): void {
    updateTask(taskId, (task) => {
      task.replaceFile = file;
      task.replaceFileName = file ? file.name || '已选文件' : '未选择任何文件';
    });
  }

  function handleRegexChange(taskId: string, checked: boolean): void {
    updateTask(taskId, (task) => {
      task.matchRegex = checked;
    });
  }

  function handleTextField(taskId: string, field: FilePatchStringField, value: string): void {
    updateTask(taskId, (task) => {
      task[field] = value;
    });
  }

  function toggleCollapse(taskId: string): void {
    updateTask(taskId, (task) => {
      task.collapsed = !task.collapsed;
    });
  }

  function moveUp(taskId: string): void {
    const idx = getTaskIndex(taskId);
    if (idx > 0) {
      swapTask(idx, idx - 1);
    }
  }

  function moveDown(taskId: string): void {
    const idx = getTaskIndex(taskId);
    if (idx >= 0 && idx < state.filePatchTasks.length - 1) {
      swapTask(idx, idx + 1);
    }
  }

  function setMethod(taskId: string, method: 'edit' | 'replace'): void {
    updateTask(taskId, (task) => {
      task.method = method;
    });
  }

  return {
    state,
    createTask,
    clearTasks,
    getFilePatchTask,
    updateTask,
    removeTask,
    loadTaskFile,
    buildQueuedFilePatchesInput,
    handleToggleEnable,
    handleReplaceFile,
    handleRegexChange,
    handleTextField,
    toggleCollapse,
    moveUp,
    moveDown,
    setMethod,
  };
}
