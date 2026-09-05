"""Pure, route-aware section navigation for the Kodi WindowXMLDialog shell."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional


ROW_LIST = 50
CARD_ACTION_LIST = 51
CHOICE_LIST = 52
COLLECTION_LIST = 53
HELP_TOPIC_LIST = 54
ROSTER_LIST = 55
ACTION_LIST = 56
SUMMARY_ITEM_LIST = 57
LOBBY_ROSTER_LIST = 58
SETTINGS_LIST = 59
PROFILE_LIST = 60
RESULT_YES_LIST = 61
RESULT_NO_LIST = 62
VOTER_LIST = 63
COUCH_MENU_ACTION_LIST = 64
CONFIRM_CANCEL = 80
CONFIRM_ACCEPT = 81
BACK_BUTTON = 90
HELP_BUTTON = 91
PAGE_PREVIOUS = 92
PAGE_NEXT = 93
GAME_SETTINGS = 94
PRIVATE_VOTE_YES = 96
PRIVATE_VOTE_NO = 97
PRIVATE_VOTE_CANCEL = 98
HOME_CONTROLS = tuple(range(100, 108))
MOVE_UP_ACTION = 3
MOVE_DOWN_ACTION = 4


@dataclass(frozen=True)
class Neighbors:
    up: int
    down: int
    left: int
    right: int


def section_focus_repair_target(
    graph: Dict[int, Neighbors],
    *,
    last_control: int,
    current_control: int,
    action_id: int,
    internal_controls: tuple,
) -> Optional[int]:
    """Return a graph neighbor only when Kodi discarded all focus.

    Kodi applies native navigation before forwarding the action to WindowXML Python.
    Lists therefore remain entirely native: an unchanged list control can represent a
    valid move between its items. A fixed section control has no such internal move,
    so missing focus can be restored from the active route graph.
    """

    if current_control:
        return None
    if last_control in internal_controls:
        return None
    neighbors = graph.get(last_control)
    if neighbors is None:
        return None
    if action_id == MOVE_UP_ACTION:
        expected = neighbors.up
    elif action_id == MOVE_DOWN_ACTION:
        expected = neighbors.down
    else:
        return None
    return expected


def focus_graph(
    *,
    route: str,
    view_mode: str,
    can_go_back: bool,
    help_visible: bool,
    has_items: bool,
    has_actions: bool,
    previous_enabled: bool,
    next_enabled: bool,
    active_stage: bool,
    confirmation_visible: bool,
    has_voters: bool = False,
    private_vote_choice: bool = False,
) -> Dict[int, Neighbors]:
    """Return the active section graph; list controls retain internal item movement."""

    if confirmation_visible:
        return {
            CONFIRM_CANCEL: Neighbors(
                CONFIRM_CANCEL,
                CONFIRM_CANCEL,
                CONFIRM_ACCEPT,
                CONFIRM_ACCEPT,
            ),
            CONFIRM_ACCEPT: Neighbors(
                CONFIRM_ACCEPT,
                CONFIRM_ACCEPT,
                CONFIRM_CANCEL,
                CONFIRM_CANCEL,
            ),
        }
    if view_mode == "home":
        if not help_visible:
            return {}
        # The skin's shared Help header points down at the ordinary collection
        # control, which is hidden on the bespoke Home grid. Override that one
        # transition so returning from Help can always re-enter the main menu.
        return {
            HELP_BUTTON: Neighbors(
                HOME_CONTROLS[0],
                HOME_CONTROLS[0],
                HELP_BUTTON,
                HELP_BUTTON,
            )
        }
    if active_stage:
        return _active_stage_graph(
            has_actions,
            previous_enabled,
            next_enabled,
            has_voters,
            private_vote_choice,
        )
    if route == "HELP" or view_mode == "help":
        return _help_graph(can_go_back, has_items, previous_enabled, next_enabled)

    content = _content_control(view_mode, has_items)
    action_control = _action_control(view_mode, has_actions)
    pagination = _pagination_controls(previous_enabled, next_enabled)
    header = None
    if can_go_back:
        header = BACK_BUTTON
    elif help_visible:
        header = HELP_BUTTON
    sections = tuple(
        control
        for control in (header, content, _primary_pagination(pagination), action_control)
        if control is not None
    )
    if not sections:
        return {}

    graph: Dict[int, Neighbors] = {}
    for index, control in enumerate(sections):
        graph[control] = Neighbors(
            sections[index - 1],
            sections[(index + 1) % len(sections)],
            control,
            control,
        )
    _add_header_pair(graph, can_go_back, help_visible)
    _add_pagination(graph, pagination, content or header, action_control or header)
    return graph


def _active_stage_graph(
    has_actions: bool,
    previous_enabled: bool,
    next_enabled: bool,
    has_voters: bool,
    private_vote_choice: bool,
) -> Dict[int, Neighbors]:
    if private_vote_choice:
        return {
            GAME_SETTINGS: Neighbors(
                PRIVATE_VOTE_YES,
                PRIVATE_VOTE_YES,
                GAME_SETTINGS,
                GAME_SETTINGS,
            ),
            PRIVATE_VOTE_YES: Neighbors(
                GAME_SETTINGS,
                GAME_SETTINGS,
                PRIVATE_VOTE_CANCEL,
                PRIVATE_VOTE_NO,
            ),
            PRIVATE_VOTE_NO: Neighbors(
                GAME_SETTINGS,
                GAME_SETTINGS,
                PRIVATE_VOTE_YES,
                PRIVATE_VOTE_CANCEL,
            ),
            PRIVATE_VOTE_CANCEL: Neighbors(
                GAME_SETTINGS,
                GAME_SETTINGS,
                PRIVATE_VOTE_NO,
                PRIVATE_VOTE_YES,
            ),
        }
    pagination = _pagination_controls(previous_enabled, next_enabled)
    primary_page = _primary_pagination(pagination)
    voters = VOTER_LIST if has_voters else None
    actions = CARD_ACTION_LIST if has_actions else None
    first = primary_page or voters or actions or GAME_SETTINGS
    graph = {
        GAME_SETTINGS: Neighbors(
            actions or voters or primary_page or GAME_SETTINGS,
            first,
            GAME_SETTINGS,
            GAME_SETTINGS,
        )
    }
    if voters is not None:
        graph[voters] = Neighbors(
            primary_page or GAME_SETTINGS,
            GAME_SETTINGS,
            actions or voters,
            actions or voters,
        )
    if actions is not None:
        graph[actions] = Neighbors(
            primary_page or GAME_SETTINGS,
            GAME_SETTINGS,
            voters or actions,
            voters or actions,
        )
    _add_pagination(
        graph,
        pagination,
        GAME_SETTINGS,
        voters or actions or GAME_SETTINGS,
    )
    return graph


def _help_graph(
    can_go_back: bool,
    has_items: bool,
    previous_enabled: bool,
    next_enabled: bool,
) -> Dict[int, Neighbors]:
    graph: Dict[int, Neighbors] = {}
    pagination = _pagination_controls(previous_enabled, next_enabled)
    primary_page = _primary_pagination(pagination)
    header = BACK_BUTTON if can_go_back else None
    topics = HELP_TOPIC_LIST if has_items else None

    if header is not None:
        graph[header] = Neighbors(
            primary_page or topics or header,
            topics or primary_page or header,
            header,
            header,
        )
    _link_help_controls(topics, header, previous_enabled, next_enabled, graph)
    return graph

def _link_help_controls(topics, header, previous_enabled, next_enabled, graph):
    if topics is not None:
        _link_help_topics(topics, header, previous_enabled, next_enabled, graph)
    if previous_enabled:
        graph[PAGE_PREVIOUS] = Neighbors(
            topics or header or PAGE_PREVIOUS,
            header or topics or PAGE_PREVIOUS,
            PAGE_PREVIOUS,
            topics or PAGE_PREVIOUS,
        )
    if next_enabled:
        graph[PAGE_NEXT] = Neighbors(
            topics or header or PAGE_NEXT,
            header or topics or PAGE_NEXT,
            topics or PAGE_NEXT,
            PAGE_NEXT,
        )


def _link_help_topics(topics, header, previous_enabled, next_enabled, graph):
    graph[topics] = Neighbors(
        header or topics,
        topics,
        PAGE_PREVIOUS if previous_enabled else header or topics,
        PAGE_NEXT if next_enabled else header or topics,
    )


def _content_control(view_mode: str, has_items: bool) -> Optional[int]:
    if not has_items:
        return None
    if view_mode == "settings":
        return SETTINGS_LIST
    if view_mode == "profiles":
        return PROFILE_LIST
    if view_mode in {
        "summary",
        "player-profile",
        "card",
        "lobby",
        "home",
        "active-menu",
    }:
        return None
    return COLLECTION_LIST


def _action_control(view_mode: str, has_actions: bool) -> Optional[int]:
    if not has_actions:
        return None
    if view_mode == "card":
        return CARD_ACTION_LIST
    if view_mode == "active-menu":
        return COUCH_MENU_ACTION_LIST
    return ACTION_LIST


def _pagination_controls(previous_enabled: bool, next_enabled: bool) -> tuple:
    controls = []
    if previous_enabled:
        controls.append(PAGE_PREVIOUS)
    if next_enabled:
        controls.append(PAGE_NEXT)
    return tuple(controls)


def _primary_pagination(controls: tuple) -> Optional[int]:
    if PAGE_NEXT in controls:
        return PAGE_NEXT
    if PAGE_PREVIOUS in controls:
        return PAGE_PREVIOUS
    return None


def _add_header_pair(
    graph: Dict[int, Neighbors],
    can_go_back: bool,
    help_visible: bool,
) -> None:
    if not can_go_back or not help_visible:
        return
    back = graph.get(BACK_BUTTON)
    if back is None:
        return
    graph[BACK_BUTTON] = Neighbors(back.up, back.down, HELP_BUTTON, HELP_BUTTON)
    graph[HELP_BUTTON] = Neighbors(back.up, back.down, BACK_BUTTON, BACK_BUTTON)


def _add_pagination(
    graph: Dict[int, Neighbors],
    controls: tuple,
    up_target: Optional[int],
    down_target: Optional[int],
) -> None:
    if not controls:
        return
    up = up_target or controls[0]
    down = down_target or controls[0]
    for control in controls:
        other = next((candidate for candidate in controls if candidate != control), control)
        graph[control] = Neighbors(up, down, other, other)
