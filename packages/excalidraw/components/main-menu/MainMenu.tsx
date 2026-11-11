import React from "react";

import { composeEventHandlers } from "@excalidraw/common";

import { useTunnels } from "../../context/tunnels";
import { useUIAppState } from "../../context/ui-appState";
import { useExcalidrawSetAppState } from "../App";
import DropdownMenu from "../dropdownMenu/DropdownMenu";
import DropdownMenuSub from "../dropdownMenu/DropdownMenuSub";
import { withInternalFallback } from "../hoc/withInternalFallback";
import { HamburgerMenuIcon } from "../icons";

import * as DefaultItems from "./DefaultItems";

const MainMenu = Object.assign(
  withInternalFallback(
    "MainMenu",
    ({
      children,
      onSelect,
    }: {
      children?: React.ReactNode;
      /**
       * Called when any menu item is selected (clicked on).
       */
      onSelect?: (event: Event) => void;
    }) => {
      const { MainMenuTunnel } = useTunnels();
      const appState = useUIAppState();
      const setAppState = useExcalidrawSetAppState();

      return (
        <MainMenuTunnel.In>
          <DropdownMenu open={appState.openMenu === "canvas"}>
            <DropdownMenu.Trigger
              onToggle={() => {
                setAppState({
                  openMenu: appState.openMenu === "canvas" ? null : "canvas",
                  openPopup: null,
                  openDialog: null,
                });
              }}
              data-testid="main-menu-trigger"
              className="main-menu-trigger"
            >
              {HamburgerMenuIcon}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              onClickOutside={() => setAppState({ openMenu: null })}
              onSelect={composeEventHandlers(onSelect, () => {
                setAppState({ openMenu: null });
              })}
              className="main-menu"
              align="start"
            >
              {children}
            </DropdownMenu.Content>
          </DropdownMenu>
        </MainMenuTunnel.In>
      );
    },
  ),
  {
    Trigger: DropdownMenu.Trigger,
    Item: DropdownMenu.Item,
    ItemLink: DropdownMenu.ItemLink,
    ItemCustom: DropdownMenu.ItemCustom,
    Group: DropdownMenu.Group,
    Separator: DropdownMenu.Separator,
    Sub: DropdownMenuSub,
    DefaultItems,
  },
);

export default MainMenu;
