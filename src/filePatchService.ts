import fs from 'fs';
import path from 'path';
import { Buffer } from 'node:buffer';
import { logTask } from './taskStore';
import { FilePatch, ModPayload, Task } from './types';
import { normalizeRelPath } from './validators';

const SAFE_TEXT_EXTENSIONS = new Set([
  '.json', '.xml', '.txt', '.yml', '.yaml', '.properties', '.csv', '.md', '.ini', '.cfg', '.conf',
  '.smali', '.gradle', '.pro', '.js', '.ts', '.css', '.html', '.kt', '.java', '.sh', '.toml', '.sql',
  '.tsv', '.log', '.manifest', '.meta', '.bytes',
]);

const BASIC_RESOURCE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.ico', '.mp3', '.wav', '.ogg', '.m4a',
  '.aac', '.flac', '.mp4', '.webm', '.ttf', '.otf', '.woff', '.woff2', '.ttc', '.fnt', '.atlas',
  '.dat', '.bin', '.bytes', '.dex', '.so', '.arsc', '.pak', '.obb', '.assetbundle', '.assets', '.resource', '.unity3d',
]);

const SAFE_REPLACE_EXTENSIONS = new Set([...SAFE_TEXT_EXTENSIONS, ...BASIC_RESOURCE_EXTENSIONS]);
const PATCH_MODES = new Set(['direct_edit', 'text_replace', 'file_replace']);
const MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_REPLACE_FILE_BYTES = 20 * 1024 * 1024;

function safeTarget(decodedDir: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const base = path.resolve(decodedDir);
  const target = path.resolve(base, normalized);
  if (!target.startsWith(base)) {
    throw new Error('Invalid file path');
  }
  return target;
}

function buildPathCandidates(rawPath: string): string[] {
  const normalized = normalizeRelPath(rawPath);
  const candidates = new Set<string>([normalized]);
  const low = normalized.toLowerCase();

  if (low.startsWith('assets/streamingassets/')) {
    const tail = normalized.split('/').slice(2).join('/');
    candidates.add(`Assets/StreamingAssets/${tail}`);
    candidates.add(`assets/StreamingAssets/${tail}`);
    candidates.add(`assets/bin/Data/StreamingAssets/${tail}`);
    candidates.add(`assets/${tail}`);
  } else if (low.startsWith('assets/bin/data/streamingassets/')) {
    const tail = normalized.split('/').slice(4).join('/');
    candidates.add(`Assets/StreamingAssets/${tail}`);
    candidates.add(`assets/StreamingAssets/${tail}`);
    candidates.add(`StreamingAssets/${tail}`);
    candidates.add(`assets/${tail}`);
  } else if (low.startsWith('assets/')) {
    candidates.add(`Assets/${normalized.slice('assets/'.length)}`);
  }

  if (low.startsWith('streamingassets/')) {
    const tail = normalized.slice('streamingassets/'.length);
    candidates.add(`Assets/StreamingAssets/${tail}`);
    candidates.add(`assets/StreamingAssets/${tail}`);
    candidates.add(`assets/bin/Data/StreamingAssets/${tail}`);
    candidates.add(`assets/${tail}`);
  }

  return [...candidates];
}

function resolveExistingTarget(decodedDir: string, rawPath: string): { target: string; relPath: string } {
  for (const candidate of buildPathCandidates(rawPath)) {
    const target = safeTarget(decodedDir, candidate);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return { target, relPath: candidate };
    }
  }
  throw new Error('File not found');
}

function isTextEditable(target: string): boolean {
  return SAFE_TEXT_EXTENSIONS.has(path.extname(target).toLowerCase()) && fs.statSync(target).size <= MAX_EDIT_FILE_BYTES;
}

function ensureReplaceableFile(target: string): void {
  if (!SAFE_REPLACE_EXTENSIONS.has(path.extname(target).toLowerCase())) {
    throw new Error('Unsupported file type for replacement');
  }
}

export function readEditableFile(task: Task, reqPath: string): Record<string, unknown> {
  if (!task.decodedDir || !fs.existsSync(task.decodedDir)) {
    throw new Error('Task is not ready, decompile first');
  }
  const { target, relPath } = resolveExistingTarget(task.decodedDir, reqPath);
  ensureReplaceableFile(target);
  const editable = isTextEditable(target);
  return {
    path: relPath,
    ext: path.extname(target).toLowerCase(),
    size: fs.statSync(target).size,
    editable,
    replaceable: true,
    content: editable ? fs.readFileSync(target, 'utf8') : '',
    safeEditTypes: [...SAFE_TEXT_EXTENSIONS].sort(),
    safeReplaceTypes: [...SAFE_REPLACE_EXTENSIONS].sort(),
  };
}

export function parseFilePatchesInput(raw: unknown): FilePatch[] {
  if (!raw) {
    return [];
  }
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) {
    throw new Error('filePatches must be an array');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`filePatches[${index}] must be an object`);
    }
    const patch = item as Record<string, unknown>;
    const patchPath = String(patch['path'] || '').trim();
    const mode = String(patch['mode'] || '').trim();
    if (!patchPath) {
      throw new Error(`filePatches[${index}].path is required`);
    }
    if (!PATCH_MODES.has(mode)) {
      throw new Error(`filePatches[${index}].mode must be one of: ${[...PATCH_MODES].sort().join(', ')}`);
    }
    const result: FilePatch = {
      path: patchPath,
      mode: mode as FilePatch['mode'],
      content: typeof patch['content'] === 'string' ? patch['content'] : null,
      matchText: typeof patch['matchText'] === 'string' ? patch['matchText'] : null,
      replaceText: typeof patch['replaceText'] === 'string' ? patch['replaceText'] : null,
      regex: Boolean(patch['regex']),
      replacementBase64: typeof patch['replacementBase64'] === 'string' ? patch['replacementBase64'] : null,
      replacementArtifactId: typeof patch['replacementArtifactId'] === 'string' ? patch['replacementArtifactId'] : null,
    };
    if (result.mode === 'direct_edit' && result.content == null) {
      throw new Error(`filePatches[${index}].content is required for direct_edit`);
    }
    if (result.mode === 'text_replace' && (result.matchText == null || result.replaceText == null)) {
      throw new Error(`filePatches[${index}].matchText and replaceText are required for text_replace`);
    }
    if (result.mode === 'file_replace' && !result.replacementBase64 && !result.replacementArtifactId) {
      throw new Error(`filePatches[${index}].replacementBase64 or replacementArtifactId is required for file_replace`);
    }
    return result;
  });
}

export function applyFilePatches(task: Task, payload: ModPayload): Task {
  if (!task.decodedDir || payload.filePatches.length === 0) {
    return task;
  }
  for (const patch of payload.filePatches) {
    const { target, relPath } = resolveExistingTarget(task.decodedDir, patch.path);
    if (patch.mode === 'direct_edit') {
      if (!isTextEditable(target)) {
        throw new Error('File type is not editable by text mode');
      }
      fs.writeFileSync(target, patch.content || '', 'utf8');
    } else if (patch.mode === 'text_replace') {
      if (!isTextEditable(target)) {
        throw new Error('File type is not editable by text mode');
      }
      const text = fs.readFileSync(target, 'utf8');
      let nextText = text;
      let count = 0;
      if (patch.regex) {
        const regex = new RegExp(patch.matchText || '', 'g');
        nextText = text.replace(regex, () => {
          count += 1;
          return patch.replaceText || '';
        });
      } else {
        count = text.split(patch.matchText || '').length - 1;
        nextText = text.split(patch.matchText || '').join(patch.replaceText || '');
      }
      if (count === 0) {
        throw new Error('No matched text found');
      }
      fs.writeFileSync(target, nextText, 'utf8');
    } else if (patch.mode === 'file_replace') {
      ensureReplaceableFile(target);
      const raw = Buffer.from(patch.replacementBase64 || '', 'base64');
      if (raw.byteLength > MAX_REPLACE_FILE_BYTES) {
        throw new Error(`Replacement file too large (> ${MAX_REPLACE_FILE_BYTES} bytes)`);
      }
      fs.writeFileSync(target, raw);
    }
    logTask(task, `File patch applied: ${relPath} (${patch.mode})`);
  }
  return task;
}
