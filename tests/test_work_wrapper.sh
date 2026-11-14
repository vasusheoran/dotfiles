#!/usr/bin/env bash
# `work <script> [args]` runs the productivity plugin's scripts/<script>.sh from wherever installed_plugins.json says it is now.
set -u
here=$(cd "$(dirname "$0")" && pwd); work=$here/../bin/.local/bin/work
tmp=$(mktemp -d); fail=0; export HOME=$tmp
eq(){ [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1 (want '$3', got '$2')"; fail=1; }; }
mkdir -p "$HOME/.claude/plugins" "$tmp/v1/scripts" "$tmp/v2/scripts"
printf '#!/usr/bin/env bash\necho "v1 $*"\n' > "$tmp/v1/scripts/ask.sh"; printf '#!/usr/bin/env bash\necho "v2 $*"; exit 3\n' > "$tmp/v2/scripts/ask.sh"
point(){ jq -n --arg p "$1" '{version:2,plugins:{"productivity@vasusheoran-plugins":[{scope:"user",installPath:$p,version:"x"}],"other@m":[{installPath:"/nope"}]}}' > "$HOME/.claude/plugins/installed_plugins.json"; }
point "$tmp/v1"; eq "runs the installed version, args passed" "$(bash "$work" ask ask o/r#1 --file f)" "v1 ask o/r#1 --file f"
point "$tmp/v2"; out=$(bash "$work" ask x); rc=$?
eq "after an update the same command runs the newer version" "$out" "v2 x"; eq "script exit code passes through" "$rc" 3
bash "$work" nope >/dev/null 2>&1; eq "unknown script: 2" "$?" 2
bash "$work" >/dev/null 2>&1; eq "no script: 2" "$?" 2
bash "$work" ../x >/dev/null 2>&1; eq "path-like script name: 2" "$?" 2
rm "$HOME/.claude/plugins/installed_plugins.json"; bash "$work" ask >/dev/null 2>&1; eq "no installed_plugins.json: 1" "$?" 1
echo '{"plugins":{}}' > "$HOME/.claude/plugins/installed_plugins.json"; bash "$work" ask >/dev/null 2>&1; eq "plugin not installed: 1" "$?" 1
rm -rf "${tmp:?}"; exit $fail
