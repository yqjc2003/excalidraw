/**
 * Client-side sharing of a board.
 *
 * Instead of uploading the scene to a backend, we compress (and encrypt) it
 * and embed it into the URL fragment. The fragment is never sent to the
 * server, so the scene stays on the client until the link is opened.
 *
 * The link looks like:
 *
 *   https://excalidraw.com/#board=<key>,<payload>
 *
 * where `<key>` is the AES key used to encrypt the payload and `<payload>` is
 * the base64url-encoded, deflated scene.
 */

import {
  compressData,
  decompressData,
} from "@excalidraw/excalidraw/data/encode";
import { generateEncryptionKey } from "@excalidraw/excalidraw/data/encryption";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * Browsers (and intermediate proxies) start to struggle with very long URLs.
 * We refuse to create links bigger than this and let the user export the
 * board to a file instead.
 */
export const MAX_SHARE_LINK_LENGTH = 100 * 1024;

const RE_BOARD_SHARE = /^#board=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]*)$/;

const toBase64Url = (bytes: Uint8Array) => {
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
  return bytes;
};

/** whether the given url fragment points at a shared board */
export const isBoardShareLink = (hash: string) => RE_BOARD_SHARE.test(hash);

/**
 * A stable id for the board a shared link points at. Opening the same link
 * twice therefore reuses the same board instead of piling up duplicates.
 */
export const boardIdFromShareLink = (hash: string) => {
  const match = hash.match(RE_BOARD_SHARE);
  const payload = match ? match[2] : hash;

  // FNV-1a (32 bit) + a second, differently seeded variant, so that
  // collisions are unlikely enough for our purposes
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return `board-share-${h1.toString(36)}-${h2.toString(
    36,
  )}-${payload.length.toString(36)}`;
};

export const createBoardShareLink = async ({
  elements,
  appState,
  files,
  name,
}: {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name?: string;
}): Promise<string> => {
  const serialized = serializeAsJSON(elements, appState, files, "local");

  // the appState is stripped down for export, so we re-add the board name
  // ourselves (the recipient should see the name of the shared board)
  let payload = serialized;
  if (name) {
    try {
      const data = JSON.parse(serialized);
      data.appState = { ...data.appState, name };
      payload = JSON.stringify(data);
    } catch (error: any) {
      console.error(error);
    }
  }

  const encryptionKey = await generateEncryptionKey("string");
  const compressed = await compressData(new TextEncoder().encode(payload), {
    encryptionKey,
  });

  const url = new URL(window.location.href);
  url.hash = `board=${encryptionKey},${toBase64Url(compressed)}`;

  if (url.toString().length > MAX_SHARE_LINK_LENGTH) {
    throw new Error("board-too-large-to-share");
  }

  return url.toString();
};

/**
 * Decodes a shared board link. Returns `null` if the fragment doesn't hold
 * a board, throws if the payload can't be decrypted.
 */
export const importBoardFromShareLink = async (
  hash: string,
): Promise<ImportedDataState | null> => {
  const match = hash.match(RE_BOARD_SHARE);
  if (!match) {
    return null;
  }

  const decryptionKey = match[1];
  const compressed = fromBase64Url(match[2]);

  const { data } = await decompressData(compressed, { decryptionKey });
  const parsed = JSON.parse(new TextDecoder().decode(data));

  return {
    elements: parsed.elements ?? [],
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  } as ImportedDataState;
};
