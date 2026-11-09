import { LibraryIcon } from "@excalidraw/excalidraw/components/icons";
import { useI18n } from "@excalidraw/excalidraw/i18n";

import { useAtomValue, useSetAtom } from "../app-jotai";

import { boardsDialogStateAtom, currentBoardNameAtom } from "./BoardsDialog";

import "./BoardSwitcher.scss";

/**
 * Top-right button showing the board that's currently open. Clicking it
 * opens the board list, where the user can create / switch / rename /
 * duplicate / export / share / delete boards.
 */
export const BoardSwitcher = () => {
  const { t } = useI18n();
  const setDialogState = useSetAtom(boardsDialogStateAtom);
  const boardName = useAtomValue(currentBoardNameAtom);

  return (
    <button
      type="button"
      className="BoardSwitcher"
      data-testid="board-switcher"
      title={t("boards.title")}
      aria-label={t("boards.title")}
      onClick={() => setDialogState({ isOpen: true })}
    >
      {LibraryIcon}
      <span className="BoardSwitcher__name">
        {boardName || t("boards.title")}
      </span>
    </button>
  );
};
