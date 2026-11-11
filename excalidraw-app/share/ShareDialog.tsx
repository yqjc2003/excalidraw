import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { LinkIcon } from "@excalidraw/excalidraw/components/icons";
import { useUIAppState } from "@excalidraw/excalidraw/context/ui-appState";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { useEffect } from "react";

import { atom, useAtom } from "../app-jotai";
import { isShareBackendConfigured } from "../backends";

import "./ShareDialog.scss";

type OnExportToBackend = () => void;

export const shareDialogStateAtom = atom<{ isOpen: boolean }>({
  isOpen: false,
});

export type ShareDialogProps = {
  handleClose: () => void;
  onExportToBackend: OnExportToBackend;
};

const ShareDialogPicker = (props: ShareDialogProps) => {
  const { t } = useI18n();

  return (
    <>
      <div className="ShareDialog__picker__header">
        {t("exportDialog.link_title")}
      </div>
      <div className="ShareDialog__picker__description">
        {t("exportDialog.link_details")}
      </div>

      <div className="ShareDialog__picker__button">
        <FilledButton
          size="large"
          label={t("exportDialog.link_button")}
          icon={LinkIcon}
          onClick={async () => {
            await props.onExportToBackend();
            props.handleClose();
          }}
        />
      </div>
    </>
  );
};

const ShareDialogInner = (props: ShareDialogProps) => {
  return (
    <Dialog size="small" onCloseRequest={props.handleClose} title={false}>
      <div className="ShareDialog">
        <ShareDialogPicker {...props} />
      </div>
    </Dialog>
  );
};

export const ShareDialog = (props: {
  onExportToBackend: OnExportToBackend;
}) => {
  const [shareDialogState, setShareDialogState] = useAtom(shareDialogStateAtom);

  const { openDialog } = useUIAppState();

  useEffect(() => {
    if (openDialog) {
      setShareDialogState({ isOpen: false });
    }
  }, [openDialog, setShareDialogState]);

  // the dialog only offers a server-side share link, so there's nothing to
  // show unless a share backend is configured
  if (!shareDialogState.isOpen || !isShareBackendConfigured) {
    return null;
  }

  return (
    <ShareDialogInner
      handleClose={() => setShareDialogState({ isOpen: false })}
      onExportToBackend={props.onExportToBackend}
    />
  );
};
