import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";
import ConfirmDialog from "@excalidraw/excalidraw/components/ConfirmDialog";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { IconButton } from "@excalidraw/excalidraw/components/IconButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import {
  copyIcon,
  downloadIcon,
  DuplicateIcon,
  exportToFileIcon,
  pencilIcon,
  PlusIcon,
  share as shareIcon,
  TrashIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { useCopyStatus } from "@excalidraw/excalidraw/hooks/useCopiedIndicator";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { saveAsJSON } from "@excalidraw/excalidraw/data";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { isInitializedImageElement } from "@excalidraw/element";

import { useCallback, useEffect, useState } from "react";

import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { atom, useAtom, useAtomValue } from "../app-jotai";
import {
  createBoard,
  deleteBoard,
  duplicateBoard,
  getBoard,
  listBoards,
  MAX_BOARDS,
  renameBoard,
} from "../data/boards";
import { createBoardShareLink } from "../data/boardShare";
import { LocalData } from "../data/LocalData";

import "./BoardsDialog.scss";

import type { BoardMeta } from "../data/boards";

export const boardsDialogStateAtom = atom<{ isOpen: boolean }>({
  isOpen: false,
});

export const currentBoardIdAtom = atom<string | null>(null);

export const currentBoardNameAtom = atom<string>("");

const formatTime = (timestamp: number) => {
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error: any) {
    return new Date(timestamp).toISOString();
  }
};

const BoardRow = ({
  board,
  isCurrent,
  onOpen,
  onRename,
  onDuplicate,
  onExport,
  onShare,
  onDelete,
  renaming,
  renameValue,
  setRenameValue,
  onRenameSubmit,
  onRenameCancel,
  shareLink,
  shareError,
  onCopyLink,
}: {
  board: BoardMeta;
  isCurrent: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onShare: () => void;
  onDelete: () => void;
  renaming: boolean;
  renameValue: string;
  setRenameValue: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  shareLink: string | null;
  shareError: string | null;
  onCopyLink: () => void;
}) => {
  const { t } = useI18n();
  const { onCopy, copyStatus } = useCopyStatus();

  return (
    <div className="BoardsDialog__board">
      <div className="BoardsDialog__board__header">
        {renaming ? (
          <TextField
            className="BoardsDialog__board__rename"
            value={renameValue}
            onChange={setRenameValue}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onRenameSubmit();
              } else if (event.key === "Escape") {
                onRenameCancel();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="BoardsDialog__board__name"
            onClick={onOpen}
            title={board.name || t("boards.unnamed")}
          >
            {board.name || t("boards.unnamed")}
            {isCurrent && (
              <span className="BoardsDialog__board__badge">
                {t("boards.current")}
              </span>
            )}
          </button>
        )}
        <div className="BoardsDialog__board__meta">
          {t("boards.updatedAt", { time: formatTime(board.updatedAt) })}
        </div>
      </div>

      <div className="BoardsDialog__board__actions">
        <IconButton
          type="button"
          size="small"
          icon={exportToFileIcon}
          title={t("boards.open")}
          aria-label={t("boards.open")}
          onClick={onOpen}
        />
        <IconButton
          type="button"
          size="small"
          icon={pencilIcon}
          title={t("boards.rename")}
          aria-label={t("boards.rename")}
          onClick={onRename}
        />
        <IconButton
          type="button"
          size="small"
          icon={DuplicateIcon}
          title={t("boards.duplicate")}
          aria-label={t("boards.duplicate")}
          onClick={onDuplicate}
        />
        <IconButton
          type="button"
          size="small"
          icon={downloadIcon}
          title={t("boards.export")}
          aria-label={t("boards.export")}
          onClick={onExport}
        />
        <IconButton
          type="button"
          size="small"
          icon={shareIcon}
          title={t("boards.share")}
          aria-label={t("boards.share")}
          onClick={onShare}
        />
        <IconButton
          type="button"
          size="small"
          icon={TrashIcon}
          title={t("boards.delete")}
          aria-label={t("boards.delete")}
          onClick={onDelete}
        />
      </div>

      {shareLink && (
        <div className="BoardsDialog__board__share">
          <div className="BoardsDialog__board__shareDescription">
            {t("boards.shareLinkDescription")}
          </div>
          <TextField readonly fullWidth value={shareLink} />
          <FilledButton
            size="large"
            label={
              copyStatus === "success"
                ? t("boards.linkCopied")
                : t("boards.copyLink")
            }
            icon={copyIcon}
            status={copyStatus}
            onClick={() => {
              onCopyLink();
              onCopy();
            }}
          />
        </div>
      )}

      {shareError && (
        <div className="BoardsDialog__board__error">{shareError}</div>
      )}
    </div>
  );
};

export const BoardsDialog = ({
  onOpenBoard,
  onError,
}: {
  onOpenBoard: (id: string) => Promise<void>;
  onError: (message: string) => void;
}) => {
  const { t } = useI18n();
  const [dialogState, setDialogState] = useAtom(boardsDialogStateAtom);
  const currentBoardId = useAtomValue(currentBoardIdAtom);
  const { openDialog } = useUIAppState();

  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BoardMeta | null>(null);

  const refresh = useCallback(async () => {
    setBoards(await listBoards());
  }, []);

  useEffect(() => {
    if (!dialogState.isOpen) {
      return;
    }
    refresh();
  }, [dialogState.isOpen, refresh]);

  useEffect(() => {
    if (openDialog) {
      setDialogState({ isOpen: false });
    }
  }, [openDialog, setDialogState]);

  const close = () => setDialogState({ isOpen: false });

  const handleCreate = async () => {
    try {
      const board = await createBoard({ name: t("boards.defaultName") });
      await refresh();
      await onOpenBoard(board.id);
      close();
    } catch (error: any) {
      console.error(error);
      onError(t("boards.createFailed"));
    }
  };

  const handleOpen = async (id: string) => {
    await onOpenBoard(id);
    close();
  };

  const handleRenameSubmit = async () => {
    if (!renamingId) {
      return;
    }
    const name = renameValue.trim();
    if (name) {
      await renameBoard(renamingId, name);
    }
    setRenamingId(null);
    setRenameValue("");
    await refresh();
  };

  const handleDuplicate = async (id: string) => {
    const copy = await duplicateBoard(id);
    await refresh();
    if (copy) {
      await onOpenBoard(copy.id);
      close();
    }
  };

  const handleExport = async (id: string) => {
    try {
      const record = await getBoard(id);
      if (!record) {
        return;
      }
      const fileIds = record.elements
        .filter(isInitializedImageElement)
        .map((element) => element.fileId);
      const { loadedFiles } = await LocalData.fileStorage.getFiles(fileIds);
      const files: BinaryFiles = {};
      for (const file of loadedFiles) {
        files[file.id] = file;
      }
      await saveAsJSON({
        data: {
          elements: record.elements,
          appState: {
            ...getDefaultAppState(),
            ...record.appState,
          } as AppState,
          files,
        },
        filename: record.name || t("boards.unnamed"),
        fileHandle: null,
      });
    } catch (error: any) {
      console.error(error);
      onError(t("boards.exportFailed"));
    }
  };

  const handleShare = async (id: string) => {
    setSharingId(id);
    setShareLink(null);
    setShareError(null);
    try {
      const record = await getBoard(id);
      if (!record) {
        throw new Error("board not found");
      }
      const fileIds = record.elements
        .filter(isInitializedImageElement)
        .map((element) => element.fileId);
      const { loadedFiles } = await LocalData.fileStorage.getFiles(fileIds);
      const files: BinaryFiles = {};
      for (const file of loadedFiles) {
        files[file.id] = file;
      }
      const link = await createBoardShareLink({
        elements: record.elements,
        appState: record.appState,
        files,
        name: record.name,
      });
      setShareLink(link);
    } catch (error: any) {
      console.error(error);
      setShareError(
        error?.message === "board-too-large-to-share"
          ? t("boards.shareTooBig")
          : t("boards.shareFailed"),
      );
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) {
      return;
    }
    try {
      await deleteBoard(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (error: any) {
      console.error(error);
      onError(t("boards.openFailed"));
    }
  };

  if (!dialogState.isOpen) {
    return null;
  }

  return (
    <>
      <Dialog size="regular" onCloseRequest={close} title={t("boards.title")}>
        <div className="BoardsDialog">
          <div className="BoardsDialog__description">
            {t("boards.description", { max: MAX_BOARDS })}
          </div>

          <div className="BoardsDialog__toolbar">
            <FilledButton
              size="large"
              label={t("boards.newBoard")}
              icon={PlusIcon}
              onClick={handleCreate}
            />
            <span className="BoardsDialog__count">
              {t("boards.count", { count: boards.length, max: MAX_BOARDS })}
            </span>
          </div>

          <div className="BoardsDialog__list">
            {boards.length === 0 && (
              <div className="BoardsDialog__empty">
                <div className="BoardsDialog__empty__title">
                  {t("boards.empty")}
                </div>
                <div className="BoardsDialog__empty__description">
                  {t("boards.emptyDescription")}
                </div>
              </div>
            )}

            {boards.map((board) => (
              <BoardRow
                key={board.id}
                board={board}
                isCurrent={board.id === currentBoardId}
                onOpen={() => handleOpen(board.id)}
                onRename={() => {
                  setRenamingId(board.id);
                  setRenameValue(board.name);
                }}
                onDuplicate={() => handleDuplicate(board.id)}
                onExport={() => handleExport(board.id)}
                onShare={() => handleShare(board.id)}
                onDelete={() => setPendingDelete(board)}
                renaming={renamingId === board.id}
                renameValue={renameValue}
                setRenameValue={setRenameValue}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingId(null)}
                shareLink={sharingId === board.id ? shareLink : null}
                shareError={sharingId === board.id ? shareError : null}
                onCopyLink={() => {
                  if (shareLink) {
                    copyTextToSystemClipboard(shareLink);
                  }
                }}
              />
            ))}
          </div>
        </div>
      </Dialog>

      {pendingDelete && (
        <ConfirmDialog
          title={t("boards.deleteConfirmTitle")}
          confirmText={t("boards.deleteConfirmButton")}
          onConfirm={handleDelete}
          onCancel={() => setPendingDelete(null)}
        >
          <div className="BoardsDialog__confirm">
            {t("boards.deleteConfirmDescription", {
              name: pendingDelete.name || t("boards.unnamed"),
            })}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
};
