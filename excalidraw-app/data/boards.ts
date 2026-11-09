/**
 * Browser-side storage for whiteboards ("boards").
 *
 * The app keeps up to `MAX_BOARDS` drawings around so the user can switch
 * between them, and so that a drawing survives a browser restart.
 *
 * Storage layout:
 *
 *  - every board is stored as two records — a lightweight `meta` record
 *    (id/name/timestamps) and a `scene` record (elements + appState) — so
 *    that rendering the board list doesn't have to load every scene;
 *  - the records live in IndexedDB, which has enough room for drawings with
 *    embedded images. If IndexedDB is not available (private browsing modes,
 *    hardened browser settings, …) we transparently fall back to
 *    localStorage, and if that is unavailable too, to cookies.
 *  - the id of the currently open board is stored in a cookie (mirrored into
 *    localStorage) so the last opened board can be restored.
 *
 * Images are not duplicated per board: binary files are shared through the
 * app-wide file store (`LocalData.fileStorage`) and referenced by `fileId`,
 * exactly like the legacy single-scene storage does.
 */

import { createStore, del, entries, get, set } from "idb-keyval";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { COOKIES, STORAGE_KEYS } from "../app_constants";

/** maximum number of boards we keep around in the browser */
export const MAX_BOARDS = 20;

const BOARDS_DB_NAME = "excalidraw-boards-db";
const BOARDS_STORE_NAME = "excalidraw-boards-store";

const boardsStore = createStore(BOARDS_DB_NAME, BOARDS_STORE_NAME);

const META_KEY_PREFIX = "meta:";
const SCENE_KEY_PREFIX = "scene:";

const LOCAL_STORAGE_META_PREFIX = "excalidraw-board-meta-";
const LOCAL_STORAGE_SCENE_PREFIX = "excalidraw-board-scene-";

const COOKIE_BOARDS_PREFIX = "excalidraw-boards-";
const COOKIE_BOARDS_SHARDS = `${COOKIE_BOARDS_PREFIX}shards`;

/** cookies are limited to ~4KB each, we stay well below that */
const COOKIE_SHARD_MAX_BYTES = 3800;
/** how many shards we're willing to write (≈15KB of board data) */
const COOKIE_MAX_SHARDS = 4;

export type BoardMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type BoardScene = {
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
};

export type BoardRecord = BoardMeta & BoardScene;

// ---------------------------------------------------------------------------
// low-level helpers
// ---------------------------------------------------------------------------

const generateBoardId = () => {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch (error: any) {
    // fall through to the manual id below
  }
  return `board-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const setCookie = (name: string, value: string, maxAgeDays = 365) => {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${
      maxAgeDays * 24 * 60 * 60
    }; SameSite=Lax`;
  } catch (error: any) {
    console.error(error);
  }
};

const getCookie = (name: string): string | null => {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch (error: any) {
    return null;
  }
};

const removeCookie = (name: string) => {
  try {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  } catch (error: any) {
    console.error(error);
  }
};

const toBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
};

// ---------------------------------------------------------------------------
// storage drivers
// ---------------------------------------------------------------------------

type BoardStorageDriver = {
  readonly kind: "indexedDB" | "localStorage" | "cookie";
  /** metadata of every stored board, most recently updated first */
  list(): Promise<BoardMeta[]>;
  get(id: string): Promise<BoardRecord | null>;
  set(record: BoardRecord): Promise<void>;
  remove(id: string): Promise<void>;
};

const idbDriver: BoardStorageDriver = {
  kind: "indexedDB",
  async list() {
    const all = await entries(boardsStore);
    const metas: BoardMeta[] = [];
    for (const [key, value] of all as [string, BoardMeta][]) {
      if (key.startsWith(META_KEY_PREFIX) && value) {
        metas.push(value);
      }
    }
    return metas;
  },
  async get(id) {
    const [meta, scene] = await Promise.all([
      get<BoardMeta>(`${META_KEY_PREFIX}${id}`, boardsStore),
      get<BoardScene>(`${SCENE_KEY_PREFIX}${id}`, boardsStore),
    ]);
    if (!meta || !scene) {
      return null;
    }
    return { ...meta, ...scene };
  },
  async set(record) {
    const { id, name, createdAt, updatedAt, elements, appState } = record;
    await Promise.all([
      set(
        `${META_KEY_PREFIX}${id}`,
        { id, name, createdAt, updatedAt },
        boardsStore,
      ),
      set(`${SCENE_KEY_PREFIX}${id}`, { elements, appState }, boardsStore),
    ]);
  },
  async remove(id) {
    await Promise.all([
      del(`${META_KEY_PREFIX}${id}`, boardsStore),
      del(`${SCENE_KEY_PREFIX}${id}`, boardsStore),
    ]);
  },
};

const localStorageDriver: BoardStorageDriver = {
  kind: "localStorage",
  async list() {
    const metas: BoardMeta[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_STORAGE_META_PREFIX)) {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      try {
        metas.push(JSON.parse(raw) as BoardMeta);
      } catch (error: any) {
        console.error(error);
      }
    }
    return metas;
  },
  async get(id) {
    const metaRaw = localStorage.getItem(`${LOCAL_STORAGE_META_PREFIX}${id}`);
    const sceneRaw = localStorage.getItem(`${LOCAL_STORAGE_SCENE_PREFIX}${id}`);
    if (!metaRaw || !sceneRaw) {
      return null;
    }
    try {
      return {
        ...(JSON.parse(metaRaw) as BoardMeta),
        ...(JSON.parse(sceneRaw) as BoardScene),
      };
    } catch (error: any) {
      console.error(error);
      return null;
    }
  },
  async set(record) {
    const { id, name, createdAt, updatedAt, elements, appState } = record;
    localStorage.setItem(
      `${LOCAL_STORAGE_META_PREFIX}${id}`,
      JSON.stringify({ id, name, createdAt, updatedAt }),
    );
    localStorage.setItem(
      `${LOCAL_STORAGE_SCENE_PREFIX}${id}`,
      JSON.stringify({ elements, appState }),
    );
  },
  async remove(id) {
    localStorage.removeItem(`${LOCAL_STORAGE_META_PREFIX}${id}`);
    localStorage.removeItem(`${LOCAL_STORAGE_SCENE_PREFIX}${id}`);
  },
};

/** reads all cookie shards, returning the metadata and the full records */
const readCookieRecords = (): [BoardMeta[], BoardRecord[]] => {
  const shardCount = Number(getCookie(COOKIE_BOARDS_SHARDS) || 0);
  let payload = "";
  for (let i = 0; i < shardCount; i++) {
    const shard = getCookie(`${COOKIE_BOARDS_PREFIX}${i}`);
    if (shard) {
      payload += shard;
    }
  }
  if (!payload) {
    return [[], []];
  }
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as BoardRecord[];
    const metas = parsed.map(({ id, name, createdAt, updatedAt }) => ({
      id,
      name,
      createdAt,
      updatedAt,
    }));
    return [metas, parsed];
  } catch (error: any) {
    console.error(error);
    return [[], []];
  }
};

/** writes the records into (sharded) cookies, dropping the oldest boards
 * that don't fit */
const writeCookieRecords = (records: BoardRecord[]) => {
  const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
  const fitting: BoardRecord[] = [];

  for (const record of sorted) {
    const candidate = [...fitting, record];
    const encoded = toBase64Url(JSON.stringify(candidate));
    if (encoded.length > COOKIE_SHARD_MAX_BYTES * COOKIE_MAX_SHARDS) {
      continue;
    }
    fitting.push(record);
  }

  const encoded = toBase64Url(JSON.stringify(fitting));
  const shards: string[] = [];
  for (let i = 0; i < encoded.length; i += COOKIE_SHARD_MAX_BYTES) {
    shards.push(encoded.slice(i, i + COOKIE_SHARD_MAX_BYTES));
  }

  // remove stale shards from a previous, larger write
  const previousCount = Number(getCookie(COOKIE_BOARDS_SHARDS) || 0);
  for (let i = 0; i < previousCount; i++) {
    removeCookie(`${COOKIE_BOARDS_PREFIX}${i}`);
  }

  shards.forEach((shard, index) => {
    setCookie(`${COOKIE_BOARDS_PREFIX}${index}`, shard);
  });
  setCookie(COOKIE_BOARDS_SHARDS, String(shards.length));
};

const cookieDriver: BoardStorageDriver = {
  kind: "cookie",
  async list() {
    const [metas] = readCookieRecords();
    return metas;
  },
  async get(id) {
    const [, records] = readCookieRecords();
    return records.find((record) => record.id === id) ?? null;
  },
  async set(record) {
    const [, records] = readCookieRecords();
    const next = records.filter((existing) => existing.id !== record.id);
    next.push(record);
    writeCookieRecords(next);
  },
  async remove(id) {
    const [, records] = readCookieRecords();
    writeCookieRecords(records.filter((record) => record.id !== id));
  },
};

let driverPromise: Promise<BoardStorageDriver> | null = null;

const probeIndexedDB = async () => {
  const probeKey = `${META_KEY_PREFIX}__probe__`;
  await set(probeKey, null, boardsStore);
  await del(probeKey, boardsStore);
};

const probeLocalStorage = () => {
  const probeKey = `${LOCAL_STORAGE_META_PREFIX}__probe__`;
  localStorage.setItem(probeKey, "1");
  localStorage.removeItem(probeKey);
};

const resolveDriver = async (): Promise<BoardStorageDriver> => {
  try {
    await probeIndexedDB();
    return idbDriver;
  } catch (error: any) {
    console.warn(
      "IndexedDB is unavailable, falling back to localStorage for boards",
      error,
    );
  }

  try {
    probeLocalStorage();
    return localStorageDriver;
  } catch (error: any) {
    console.warn(
      "localStorage is unavailable, falling back to cookies for boards",
      error,
    );
  }

  return cookieDriver;
};

const getDriver = () => {
  if (!driverPromise) {
    driverPromise = resolveDriver();
  }
  return driverPromise;
};

/** which storage backend is actually in use (for debugging purposes) */
export const getBoardStorageKind = async () => (await getDriver()).kind;

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export const listBoards = async (): Promise<BoardMeta[]> => {
  const driver = await getDriver();
  const metas = await driver.list();
  return metas.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getBoard = async (id: string): Promise<BoardRecord | null> => {
  const driver = await getDriver();
  return driver.get(id);
};

export const saveBoard = async (record: BoardRecord): Promise<void> => {
  const driver = await getDriver();
  await driver.set(record);
};

export const deleteBoard = async (id: string): Promise<void> => {
  const driver = await getDriver();
  await driver.remove(id);
  if (getCurrentBoardId() === id) {
    setCurrentBoardId(null);
  }
};

export const renameBoard = async (id: string, name: string): Promise<void> => {
  const record = await getBoard(id);
  if (!record) {
    return;
  }
  await saveBoard({
    ...record,
    name,
    appState: { ...record.appState, name },
    updatedAt: Date.now(),
  });
};

export type CreateBoardOpts = {
  /** supply a stable id to make the board idempotent (e.g. for shared links) */
  id?: string;
  name?: string;
  elements?: ExcalidrawElement[];
  appState?: Partial<AppState>;
};

export const createBoard = async (
  opts: CreateBoardOpts = {},
): Promise<BoardRecord> => {
  const now = Date.now();
  const record: BoardRecord = {
    id: opts.id || generateBoardId(),
    name: opts.name?.trim() || "",
    createdAt: now,
    updatedAt: now,
    elements: opts.elements ?? [],
    appState: opts.appState ?? {},
  };
  await saveBoard(record);
  await enforceBoardLimit(record.id);
  return record;
};

export const duplicateBoard = async (
  id: string,
  name?: string,
): Promise<BoardRecord | null> => {
  const record = await getBoard(id);
  if (!record) {
    return null;
  }
  return createBoard({
    name: name ?? `${record.name} (copy)`,
    elements: record.elements,
    appState: record.appState,
  });
};

/**
 * Keeps at most `MAX_BOARDS` boards around, evicting the least recently
 * updated ones. The board that was just created/updated is never evicted.
 */
export const enforceBoardLimit = async (keepId?: string) => {
  const metas = await listBoards();
  if (metas.length <= MAX_BOARDS) {
    return;
  }
  const evictable = metas.filter((meta) => meta.id !== keepId);
  const toEvict = metas.length - MAX_BOARDS;
  for (const meta of evictable.slice(0, toEvict)) {
    await deleteBoard(meta.id);
  }
};

/** all file ids referenced by any stored board */
export const getAllBoardFileIds = async (): Promise<FileId[]> => {
  const driver = await getDriver();
  const metas = await driver.list();
  const fileIds = new Set<FileId>();
  for (const meta of metas) {
    const record = await driver.get(meta.id);
    if (!record) {
      continue;
    }
    for (const element of record.elements) {
      if (
        element.type === "image" &&
        "fileId" in element &&
        element.fileId &&
        !element.isDeleted
      ) {
        fileIds.add(element.fileId);
      }
    }
  }
  return [...fileIds];
};

// ---------------------------------------------------------------------------
// currently open board
// ---------------------------------------------------------------------------

export const getCurrentBoardId = (): string | null => {
  // the cookie is the source of truth (it survives a localStorage wipe),
  // localStorage is only a mirror
  const fromCookie = getCookie(COOKIES.CURRENT_BOARD);
  if (fromCookie) {
    return fromCookie;
  }
  try {
    return localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_CURRENT_BOARD);
  } catch (error: any) {
    return null;
  }
};

export const setCurrentBoardId = (id: string | null) => {
  if (id) {
    setCookie(COOKIES.CURRENT_BOARD, id);
    try {
      localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_CURRENT_BOARD, id);
    } catch (error: any) {
      console.error(error);
    }
  } else {
    removeCookie(COOKIES.CURRENT_BOARD);
    try {
      localStorage.removeItem(STORAGE_KEYS.LOCAL_STORAGE_CURRENT_BOARD);
    } catch (error: any) {
      console.error(error);
    }
  }
};
