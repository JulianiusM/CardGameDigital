"""Built-in help available before a server has been selected."""

from __future__ import annotations

from . import strings


LOCAL_HELP_TOPICS = (
    ("getting-started", strings.HELP_GETTING_STARTED, strings.HELP_GETTING_STARTED_BODY),
    ("servers", strings.HELP_SERVERS, strings.HELP_SERVERS_BODY),
    ("navigation", strings.HELP_NAVIGATION, strings.HELP_NAVIGATION_BODY),
    ("gameplay", strings.HELP_GAMEPLAY, strings.HELP_GAMEPLAY_BODY),
)


def local_help_topic(slug: str):
    return next((topic for topic in LOCAL_HELP_TOPICS if topic[0] == slug), None)
