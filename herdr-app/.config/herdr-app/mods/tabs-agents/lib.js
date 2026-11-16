// cmd-shift-a, in three steps (the list is the agents-view block of the side panel): hidden → show it and focus the list; showing, keyboard elsewhere → focus the list;
// the list holds the keyboard → hide it. The list takes the keyboard when it sees LIST_FOCUS (it clears it) and publishes LIST_HAS_FOCUS for this to read.
export const LIST_FOCUS = "agents-view.focus", LIST_HAS_FOCUS = "agents-view.focused";
export const toggleStep = ({ shown, focused }) => ({ show: !shown, hide: shown && focused, focus: !(shown && focused) });
