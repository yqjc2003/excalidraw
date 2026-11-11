import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import {
  clearAppStateForLocalStorage,
  getDefaultAppState,
} from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";

import {
  usersIcon,
  LibraryIcon,
  share,
} from "@excalidraw/excalidraw/components/icons";
import { getNonDeletedElements, isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
  userToFollowAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { BoardSwitcher } from "./components/BoardSwitcher";
import {
  BoardsDialog,
  boardsDialogStateAtom,
  currentBoardIdAtom,
  currentBoardNameAtom,
} from "./components/BoardsDialog";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import {
  isAIBackendConfigured,
  isCollabBackendConfigured,
  isShareBackendConfigured,
} from "./backends";
import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import {
  createBoard,
  getAllBoardFileIds,
  getBoard,
  getCurrentBoardId,
  listBoards,
  saveBoard,
  setCurrentBoardId,
} from "./data/boards";
import {
  boardIdFromShareLink,
  importBoardFromShareLink,
} from "./data/boardShare";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { useSimulatedCollaborators } from "./debugCollaborators";
import { AIComponents } from "./components/AI";

import "./index.scss";

import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

type BoardScenePayload = {
  id: string;
  name: string;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
};

/**
 * whether the current url points at a scene that lives outside of the
 * browser storage (a shared board, a backend scene or a collab room)
 */
const isExternalSceneUrl = () => {
  const searchParams = new URLSearchParams(window.location.search);
  if (isShareBackendConfigured && searchParams.get("id")) {
    return true;
  }
  const hash = window.location.hash;
  return (
    (isShareBackendConfigured &&
      /^#json=[a-zA-Z0-9_-]+,[a-zA-Z0-9_-]+$/.test(hash)) ||
    /^#board=[a-zA-Z0-9_-]+,[a-zA-Z0-9_-]*$/.test(hash) ||
    (isCollabBackendConfigured &&
      /^#room=[a-zA-Z0-9_-]+,[a-zA-Z0-9_-]+$/.test(hash))
  );
};

/**
 * Loads a board and returns it in the shape needed to restore it into the
 * canvas.
 */
const getBoardPayload = async (
  id: string | null,
): Promise<BoardScenePayload | null> => {
  if (!id) {
    return null;
  }
  const record = await getBoard(id);
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    elements: record.elements,
    appState: record.appState,
  };
};

/**
 * Resolves the board that should be opened when the app loads. If the user
 * doesn't have any boards yet, we seed the first one with whatever is
 * currently in localStorage, so that existing drawings aren't lost.
 */
const resolveCurrentBoard = async (): Promise<BoardScenePayload | null> => {
  try {
    const boards = await listBoards();

    if (boards.length === 0) {
      const localDataState = importFromLocalStorage();
      const board = await createBoard({
        name: localDataState?.appState?.name?.trim() || t("boards.defaultName"),
        elements: localDataState?.elements ?? [],
        appState: localDataState?.appState ?? {},
      });
      return {
        id: board.id,
        name: board.name,
        elements: board.elements,
        appState: board.appState,
      };
    }

    const currentId = getCurrentBoardId();
    const board =
      (currentId ? boards.find((meta) => meta.id === currentId) : null) ??
      boards[0];

    return await getBoardPayload(board.id);
  } catch (error: any) {
    console.error(error);
    return null;
  }
};

/** autosaves the currently open scene into its board */
const saveBoardScene = debounce(
  async (
    id: string,
    elements: readonly ExcalidrawElement[],
    appState: AppState,
  ) => {
    try {
      const record = await getBoard(id);
      if (!record) {
        return;
      }
      await saveBoard({
        ...record,
        elements: [...getNonDeletedElements(elements)],
        appState: clearAppStateForLocalStorage(appState),
        updatedAt: Date.now(),
      });
    } catch (error: any) {
      console.error(error);
    }
  },
  SAVE_TO_LOCAL_STORAGE_TIMEOUT,
);

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
  /**
   * the board that should be restored on load (if any). When supplied, the
   * board takes precedence over the legacy single-scene localStorage state.
   */
  boardScene?: BoardScenePayload | null;
  /** called with the board that ended up being opened */
  onBoardScene?: (board: BoardScenePayload | null) => void;
}): Promise<
  { scene: ExcalidrawInitialDataState | null; isBoardShare?: boolean } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendHashMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  // server-side share links are only loaded when a share backend is configured
  const jsonBackendMatch = isShareBackendConfigured
    ? jsonBackendHashMatch
    : null;
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);
  const boardShareMatch = window.location.hash.match(
    /^#board=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]*)$/,
  );

  const localDataState = importFromLocalStorage();

  const boardScene = opts.boardScene ?? null;
  opts.onBoardScene?.(boardScene);

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
    /** files embedded into a shared board link */
    files?: BinaryFiles;
  } = boardScene
    ? {
        elements: restoreElements(boardScene.elements, null, {
          repairBindings: true,
          deleteInvisibleElements: true,
        }),
        appState: restoreAppState(boardScene.appState, null),
      }
    : {
        elements: restoreElements(localDataState?.elements, null, {
          repairBindings: true,
          deleteInvisibleElements: true,
        }),
        appState: restoreAppState(localDataState?.appState, null),
      };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  if (roomLinkData && !opts.collabAPI) {
    // live collaboration isn't available (no websocket server configured)
    window.history.replaceState({}, APP_NAME, window.location.origin);
    window.alert(t("errors.cannotResolveCollabServer"));
    roomLinkData = null;
  }
  const isExternalScene = !!(
    id ||
    jsonBackendMatch ||
    roomLinkData ||
    boardShareMatch
  );
  let isBoardShare = false;
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // a shared board is imported into a board of its own, so there's
      // nothing to overwrite
      boardShareMatch ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      } else if (boardShareMatch) {
        isBoardShare = true;

        const imported = await importBoardFromShareLink(window.location.hash);

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported?.elements ?? [], null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported?.appState ?? {},
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
          files: imported?.files ?? {},
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (jsonBackendHashMatch && !jsonBackendMatch) {
    // the link points at a server-side share link, but the app isn't
    // configured with a share backend to load it from
    window.history.replaceState({}, APP_NAME, window.location.origin);
    window.alert(t("alerts.importBackendFailed"));
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    if (isExternalScene && jsonBackendMatch) {
      return {
        scene,
        isExternalScene,
        id: jsonBackendMatch[1],
        key: jsonBackendMatch[2],
      };
    }
    return { scene, isExternalScene: false, isBoardShare };
  }
  return { scene: null, isExternalScene: false };
};

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  // collaboration needs a websocket server to talk to; without one the app
  // stays fully local (no room links, no live collaboration)
  const isCollabDisabled = isRunningInIframe() || !isCollabBackendConfigured;

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  // boards (whiteboards cached in the browser)
  // ---------------------------------------------------------------------------

  /** the board that's currently open, mirrored into a ref for hot paths */
  const currentBoardIdRef = useRef<string | null>(null);
  const [, setCurrentBoardIdAtom] = useAtom(currentBoardIdAtom);
  const [, setCurrentBoardNameAtom] = useAtom(currentBoardNameAtom);

  /**
   * Opens a board: makes it the current one and loads its scene (and images)
   * into the canvas.
   */
  const openBoard = useCallback(
    async (id: string) => {
      if (!excalidrawAPI) {
        return;
      }

      // make sure the board we're leaving is up to date
      saveBoardScene.flush();

      const record = await getBoard(id);
      if (!record) {
        setErrorMessage(t("boards.openFailed"));
        return;
      }

      currentBoardIdRef.current = id;
      setCurrentBoardId(id);
      setCurrentBoardIdAtom(id);
      setCurrentBoardNameAtom(record.name);

      excalidrawAPI.updateScene({
        elements: restoreElements(record.elements, null, {
          repairBindings: true,
          deleteInvisibleElements: true,
        }),
        appState: restoreAppState(record.appState, excalidrawAPI.getAppState()),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      // load the images referenced by the board
      const fileIds = record.elements
        .filter(isInitializedImageElement)
        .map((element) => element.fileId);

      if (fileIds.length) {
        LocalData.fileStorage
          .getFiles(fileIds)
          .then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
          });
      }
    },
    [excalidrawAPI, setCurrentBoardIdAtom, setCurrentBoardNameAtom],
  );

  /**
   * Stores the currently open scene as a board of its own. Used when the
   * scene comes from an external source (e.g. a shared link), so that we
   * don't overwrite the board the user was working on.
   *
   * When `opts.id` is supplied and a board with that id already exists, the
   * existing board is opened instead of creating a duplicate — this keeps
   * opening the same shared link from piling up boards.
   */
  const adoptSceneAsBoard = useCallback(
    async (scene: ExcalidrawInitialDataState, opts?: { id?: string }) => {
      try {
        if (opts?.id) {
          const existing = await getBoard(opts.id);
          if (existing) {
            await openBoard(existing.id);
            return;
          }
        }

        const board = await createBoard({
          id: opts?.id,
          name: scene.appState?.name?.trim() || t("boards.defaultName"),
          elements: (scene.elements ?? []) as ExcalidrawElement[],
          appState: scene.appState ?? {},
        });
        currentBoardIdRef.current = board.id;
        setCurrentBoardId(board.id);
        setCurrentBoardIdAtom(board.id);
        setCurrentBoardNameAtom(board.name);
      } catch (error: any) {
        console.error(error);
      }
    },
    [openBoard, setCurrentBoardIdAtom, setCurrentBoardNameAtom],
  );

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [, setBoardsDialogState] = useAtom(boardsDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);
  const userToFollow = useAtomValue(userToFollowAtom);

  const viewportStatusFrame = useMemo(
    () =>
      userToFollow
        ? {
            border: "var(--color-primary-hover)",
            label: {
              label: (
                <>
                  Following{" "}
                  <span
                    style={{
                      display: "block",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 100,
                    }}
                    title={userToFollow.username}
                  >
                    {userToFollow.username}
                  </span>
                </>
              ),
              onClose: () => collabAPI?.setUserToFollow(null),
            },
          }
        : null,
    [userToFollow, collabAPI],
  );

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ?collaborators=<N> — populate the canvas with N static fake
  // collaborators for exercising avatar/UserList UI without a real
  // collab room
  useSimulatedCollaborators(excalidrawAPI);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session). Files referenced by other boards are kept around, so
          // that switching boards doesn't lose their images.
          getAllBoardFileIds().then((boardFileIds) => {
            LocalData.fileStorage.clearObsoleteFiles({
              currentFileIds: [...fileIds, ...boardFileIds],
            });
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    (async () => {
      // unless we're loading an external scene (shared link, backend scene,
      // collab room), restore the board that was open last
      const isExternal = isExternalSceneUrl();
      const isCollabLink = isCollaborationLink(window.location.href);
      // the hash is wiped by `initializeScene`, so remember it upfront
      const shareHash = window.location.hash;
      const boardScene = isExternal ? null : await resolveCurrentBoard();

      const data = await initializeScene({
        collabAPI,
        excalidrawAPI,
        boardScene,
        onBoardScene: (board) => {
          if (board) {
            currentBoardIdRef.current = board.id;
            setCurrentBoardId(board.id);
            setCurrentBoardIdAtom(board.id);
            setCurrentBoardNameAtom(board.name);
          }
        },
      });

      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);

      if (isExternal && data.scene && !isCollabLink) {
        // the scene comes from outside of the browser storage — store it in
        // a board of its own, so that we don't overwrite the board the user
        // was working on
        await adoptSceneAsBoard(data.scene, {
          id: data.isBoardShare ? boardIdFromShareLink(shareHash) : undefined,
        });
      }
    })();

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        // make sure the board we're on is up to date before we potentially
        // replace the scene
        saveBoardScene.flush();

        (async () => {
          const isExternal = isExternalSceneUrl();
          const isCollabLink = isCollaborationLink(window.location.href);
          // the hash is wiped by `initializeScene`, so remember it upfront
          const shareHash = window.location.hash;
          const boardScene = isExternal
            ? null
            : await getBoardPayload(currentBoardIdRef.current);

          const data = await initializeScene({
            collabAPI,
            excalidrawAPI,
            boardScene,
            onBoardScene: (board) => {
              if (board) {
                currentBoardIdRef.current = board.id;
                setCurrentBoardId(board.id);
                setCurrentBoardIdAtom(board.id);
                setCurrentBoardNameAtom(board.name);
              }
            },
          });

          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }

          if (isExternal && data.scene && !isCollabLink) {
            await adoptSceneAsBoard(data.scene, {
              id: data.isBoardShare
                ? boardIdFromShareLink(shareHash)
                : undefined,
            });
          }
        })();
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    setLangCode,
    loadImages,
    adoptSceneAsBoard,
    setCurrentBoardIdAtom,
    setCurrentBoardNameAtom,
  ]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // keep the board that's currently open in sync with the canvas
    if (currentBoardIdRef.current && !collabAPI?.isCollaborating()) {
      saveBoardScene(currentBoardIdRef.current, elements, appState);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    if (!isShareBackendConfigured) {
      throw new Error(t("alerts.couldNotCreateShareableLink"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);
  const isCollabAvailable =
    !isCollabDisabled && (!isOffline || isCollaborating);

  useEffect(() => {
    if (!isCollabAvailable) {
      setShareDialogState({ isOpen: false });
    }
  }, [isCollabAvailable, setShareDialogState]);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        viewportStatusFrame={viewportStatusFrame}
        userToFollow={userToFollow}
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        aiEnabled={isAIBackendConfigured}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              ...(isShareBackendConfigured ? { onExportToBackend } : {}),
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              <BoardSwitcher />

              {collabAPI && isCollabAvailable && (
                <>
                  {collabError.message && (
                    <CollabError collabError={collabError} />
                  )}
                  <LiveCollaborationTrigger
                    isCollaborating={isCollaborating}
                    onSelect={() =>
                      setShareDialogState({ isOpen: true, type: "share" })
                    }
                    editorInterface={editorInterface}
                  />
                </>
              )}
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.setViewport({
              target: element.link,
              fit: "scale-down",
              animation: true,
            });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={isCollabAvailable}
          theme={appTheme}
          refresh={() => forceRefresh((prev) => !prev)}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={isCollabAvailable}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && isAIBackendConfigured && (
          <AIComponents excalidrawAPI={excalidrawAPI} />
        )}

        {isAIBackendConfigured && <TTDDialogTrigger />}
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <BoardsDialog onOpenBoard={openBoard} onError={setErrorMessage} />

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("boards.menuItem"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: LibraryIcon,
              keywords: [
                "board",
                "boards",
                "whiteboard",
                "drawings",
                "list",
                "switch",
                "new",
              ],
              perform: () => {
                setBoardsDialogState({ isOpen: true });
              },
            },
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: isCollabAvailable,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
